//! Host-owned, durable conditions for capture automations. Guests never receive model credentials.
use crate::{
    ai,
    history::{now_ms, HistoryRepository},
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    pub rule_id: String,
    pub condition_question: Option<String>,
    pub order: i64,
    pub application: Option<super::SourceApplication>,
    pub parameters: serde_json::Value,
    pub setup_label: String,
    pub default_view: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleEvaluation {
    pub rule_id: String,
    pub probability: Option<f64>,
    pub matched: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub selected_rule_id: Option<String>,
    pub setup_label: Option<String>,
    pub evaluations: Vec<RuleEvaluation>,
}

pub(crate) fn validate_condition(question: Option<&str>) -> Result<()> {
    if question.is_some_and(|q| q.trim().is_empty() || q.len() > 2048) {
        bail!("invalid_automation_condition");
    }
    Ok(())
}

pub(crate) fn ordered(
    mut candidates: Vec<Candidate>,
    application: Option<&super::SourceApplication>,
) -> Vec<Candidate> {
    candidates.retain(|candidate| {
        candidate.application.as_ref().is_none_or(|scope| {
            application.is_some_and(|app| app.platform == scope.platform && app.id == scope.id)
        })
    });
    candidates.sort_by(|a, b| {
        (a.application.is_none(), a.order, &a.rule_id).cmp(&(
            b.application.is_none(),
            b.order,
            &b.rule_id,
        ))
    });
    candidates
}

pub(crate) struct EventKey<'a> {
    pub event: &'a str,
    pub package: &'a str,
    pub activation: &'a str,
    pub claim: i64,
}

pub(crate) async fn live(repo: &HistoryRepository, key: &EventKey<'_>) -> Result<()> {
    let source: Option<String> = sqlx::query_scalar("SELECT e.source_clip_id FROM extension_activation_events e JOIN clip_items c ON c.id=e.source_clip_id JOIN extension_installs i ON i.package_id=e.package_id JOIN extension_runtime_state s ON s.extension_id=i.id LEFT JOIN extension_package_revisions p ON p.package_id=i.package_id WHERE e.event_id=? AND e.package_id=? AND e.activation_id=? AND e.evaluation_claim=? AND e.status='pending' AND e.lease_until>? AND c.lifecycle_state='ready' AND i.enabled=1 AND s.status='ready' AND i.sha256=e.package_sha256 AND COALESCE(p.grant_revision,0)=e.grant_revision AND EXISTS(SELECT 1 FROM extension_permission_grants g WHERE g.extension_id=i.id AND g.package_sha256=i.sha256 AND g.permission_kind='background_clip_created' AND g.permission_value='clip.created')")
        .bind(key.event).bind(key.package).bind(key.activation).bind(key.claim).bind(now_ms()).fetch_optional(&repo.pool).await?;
    let source = source.context("automation_stale")?;
    if ai::privacy::restricted(repo, &source).await? {
        bail!("automation_privacy_restricted");
    }
    Ok(())
}

async fn checkpoint(
    repo: &HistoryRepository,
    key: &EventKey<'_>,
    answers: &BTreeMap<String, f64>,
    revision: &str,
) -> Result<()> {
    live(repo, key).await?;
    let changed = sqlx::query("UPDATE extension_activation_events SET decision_answers_json=?,decision_revision=?,updated_at=? WHERE event_id=? AND package_id=? AND activation_id=? AND evaluation_claim=? AND status='pending'")
        .bind(serde_json::to_string(answers)?).bind(revision).bind(now_ms()).bind(key.event).bind(key.package).bind(key.activation).bind(key.claim).execute(&repo.pool).await?.rows_affected();
    if changed != 1 {
        bail!("automation_stale");
    }
    Ok(())
}

pub(crate) async fn evaluate(
    repo: &HistoryRepository,
    text: &str,
    candidates: &[Candidate],
    key: Option<&EventKey<'_>>,
) -> Result<TestResult> {
    let document = ai::configuration::export(repo).await?;
    let revision = crate::history::sha256(serde_json::to_string(&document)?.as_bytes());
    let mut answers = BTreeMap::<String, f64>::new();
    if let Some(key) = key {
        live(repo, key).await?;
        let row = sqlx::query("SELECT decision_answers_json,decision_revision FROM extension_activation_events WHERE event_id=? AND package_id=? AND activation_id=?")
            .bind(key.event).bind(key.package).bind(key.activation).fetch_one(&repo.pool).await?;
        if row.get::<Option<String>, _>(1).as_deref() == Some(&revision) {
            answers = serde_json::from_str(&row.get::<String, _>(0))?;
            if answers
                .values()
                .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
            {
                bail!("invalid_automation_answers");
            }
        }
    }
    let mut evaluations = Vec::new();
    let mut index = 0;
    while index < candidates.len() {
        let candidate = &candidates[index];
        if candidate.condition_question.is_some() && !answers.contains_key(&candidate.rule_id) {
            if crate::contributions::contains_secret(text) {
                bail!("automation_privacy_restricted");
            }
            let preset_id = document
                .selections
                .default_decision
                .as_deref()
                .context("missing_decision_preset")?;
            let preset = document
                .presets
                .iter()
                .find(|p| p.id == preset_id)
                .context("missing_decision_preset")?;
            let mut budget = (preset.context_limit as usize).saturating_sub(text.len() + 1024);
            let mut batch = Vec::new();
            for next in &candidates[index..] {
                if next.application.is_none() != candidate.application.is_none()
                    || next.condition_question.is_none()
                {
                    break;
                }
                if answers.contains_key(&next.rule_id) {
                    continue;
                }
                let question = next.condition_question.as_deref().unwrap();
                validate_condition(Some(question))?;
                if question.len() > budget || batch.len() == 33 {
                    break;
                }
                budget -= question.len();
                batch.push(next);
            }
            if batch.is_empty() {
                bail!("decision_input_limit");
            }
            if let Some(key) = key {
                live(repo, key).await?;
            }
            let questions = batch
                .iter()
                .enumerate()
                .map(|(n, c)| (format!("q{n}"), c.condition_question.clone().unwrap()))
                .collect();
            let response = ai::decision::predicates(repo, preset_id, text, &questions).await?;
            if serde_json::to_string(&ai::configuration::export(repo).await?)?
                != serde_json::to_string(&document)?
            {
                bail!("automation_stale");
            }
            for (n, c) in batch.iter().enumerate() {
                answers.insert(c.rule_id.clone(), response[&format!("q{n}")]);
            }
            if let Some(key) = key {
                checkpoint(repo, key, &answers, &revision).await?;
            }
        }
        let probability = candidate
            .condition_question
            .as_ref()
            .map(|_| answers[&candidate.rule_id]);
        let matched = probability.is_none_or(|p| p >= 0.5);
        evaluations.push(RuleEvaluation {
            rule_id: candidate.rule_id.clone(),
            probability,
            matched,
        });
        if matched {
            return Ok(TestResult {
                selected_rule_id: Some(candidate.rule_id.clone()),
                setup_label: Some(candidate.setup_label.clone()),
                evaluations,
            });
        }
        index += 1;
    }
    Ok(TestResult {
        selected_rule_id: None,
        setup_label: None,
        evaluations,
    })
}

pub(crate) async fn select_event(
    repo: &HistoryRepository,
    key: &EventKey<'_>,
    row: &sqlx::sqlite::SqliteRow,
) -> Result<Option<Candidate>> {
    let mut candidates: Vec<Candidate> =
        serde_json::from_str(row.get::<&str, _>("candidates_json"))?;
    if candidates.is_empty() {
        candidates.push(Candidate {
            rule_id: row.get("rule_id"),
            condition_question: None,
            order: 0,
            application: None,
            parameters: serde_json::from_str(row.get::<&str, _>("parameters_json"))?,
            setup_label: row.get("setup_label"),
            default_view: row.get("default_view"),
        });
    }
    let enabled:Vec<String>=sqlx::query_scalar("SELECT rule_id FROM extension_automation_rules WHERE package_id=? AND activation_id=? AND enabled=1 AND (app_platform IS NULL OR (app_platform=? AND app_id=?))")
        .bind(key.package).bind(key.activation).bind(row.get::<Option<String>,_>("app_platform")).bind(row.get::<Option<String>,_>("app_id")).fetch_all(&repo.pool).await?;
    candidates.retain(|c| enabled.contains(&c.rule_id));
    if let Some(selected) = row.get::<Option<String>, _>("selected_rule_id") {
        live(repo, key).await?;
        return Ok(candidates
            .into_iter()
            .find(|candidate| candidate.rule_id == selected));
    }

    let source:Option<String>=sqlx::query_scalar("SELECT t.text_value FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id WHERE r.clip_id=? AND (? IS NULL OR r.id=?) AND r.lifecycle_state='ready' ORDER BY CASE WHEN r.canonical_mime_type='text/plain' THEN 0 ELSE 1 END,r.capture_priority,r.ordinal LIMIT 1")
        .bind(row.get::<String,_>("source_clip_id")).bind(row.get::<Option<String>,_>("source_representation_id")).bind(row.get::<Option<String>,_>("source_representation_id")).fetch_optional(&repo.pool).await?;
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        evaluate(
            repo,
            source.as_deref().unwrap_or(""),
            &candidates,
            Some(key),
        ),
    )
    .await
    .context("decision_timeout")??;
    Ok(candidates
        .into_iter()
        .find(|c| Some(&c.rule_id) == outcome.selected_rule_id.as_ref()))
}

pub(crate) fn request_id(event: &str, package: &str, activation: &str) -> String {
    format!(
        "automation:{}",
        crate::history::sha256(
            serde_json::to_string(&(event, package, activation))
                .expect("string tuple serializes")
                .as_bytes()
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{configuration, contracts::*};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };

    fn candidate(id: &str, order: i64, app: Option<&str>, question: Option<&str>) -> Candidate {
        Candidate {
            rule_id: id.into(),
            order,
            application: app.map(|id| super::super::SourceApplication {
                platform: "windows".into(),
                id: id.into(),
                display_name: id.into(),
            }),
            condition_question: question.map(str::to_owned),
            parameters: serde_json::json!({"preset":id}),
            setup_label: id.into(),
            default_view: "compare".into(),
        }
    }

    #[test]
    fn scope_precedes_order_and_unknown_apps_only_use_global_rules() {
        let rules = vec![
            candidate("global", 0, None, None),
            candidate("other", 1, Some("other"), None),
            candidate("second", 4, Some("mail"), None),
            candidate("first", 2, Some("mail"), None),
        ];
        let app = rules[3].application.clone().unwrap();
        assert_eq!(
            ordered(rules.clone(), Some(&app))
                .iter()
                .map(|r| r.rule_id.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second", "global"]
        );
        assert_eq!(ordered(rules, None).len(), 1);
        assert!(validate_condition(Some("  ")).is_err());
        assert!(validate_condition(Some(&"x".repeat(2049))).is_err());
        assert_eq!(request_id("a", "bc", "d"), request_id("a", "bc", "d"));
        assert_ne!(request_id("ab", "c", "d"), request_id("a", "bc", "d"));
    }

    #[tokio::test]
    async fn unconditional_rules_work_without_a_model_but_conditional_errors_never_fall_through() {
        let (_root, service) = crate::recall::service_tests::repository().await;
        let rules = vec![
            candidate("first", 0, None, None),
            candidate("later", 1, None, Some("Does this match?")),
        ];
        let result = evaluate(&service.history, "Public draft", &rules, None)
            .await
            .unwrap();
        assert_eq!(result.selected_rule_id.as_deref(), Some("first"));
        assert_eq!(result.evaluations.len(), 1);
        let rules = vec![
            candidate("conditional", 0, None, Some("Does this match?")),
            candidate("fallback", 1, None, None),
        ];
        assert!(evaluate(&service.history, "Public draft", &rules, None)
            .await
            .is_err());
        assert!(evaluate(
            &service.history,
            "API_KEY=abcdef0123456789abcdef",
            &rules,
            None
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("privacy_restricted"));
        assert!(evaluate(&service.history, "Public draft", &[], None)
            .await
            .unwrap()
            .selected_rule_id
            .is_none());
    }

    #[tokio::test]
    async fn batches_within_scope_threshold_and_failures_preserve_first_match_semantics() {
        use axum::{routing::post, Router};
        let (_root, service) = crate::recall::service_tests::repository().await;
        let repo = &service.history;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let received = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let failed = Arc::new(AtomicBool::new(false));
        let requests = received.clone();
        let fail = failed.clone();
        let connection = AiConnection {
            id: crate::history::new_id(),
            name: "Fixture".into(),
            provider: AiProviderKind::Ollama,
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        let preset = AiModelPreset {
            id: crate::history::new_id(),
            name: "General".into(),
            connection_id: connection.id.clone(),
            model_id: "fixture".into(),
            purpose: AiModelPurpose::Decision,
            context_limit: 32768,
            output_limit: 4096,
            options: configuration::default_options(),
            capabilities: configuration::unknown_capabilities(),
        };
        configuration::import(
            repo,
            AiConfiguration {
                version: 4,
                connections: vec![connection],
                presets: vec![preset.clone()],
                selections: AiSelections {
                    default_decision: Some(preset.id),
                    ..Default::default()
                },
            },
        )
        .await
        .unwrap();
        let router = Router::new().route(
            "/v1/systemone",
            post(move |bytes: axum::body::Bytes| {
                let requests = requests.clone();
                let fail = fail.load(Ordering::SeqCst);
                async move {
                    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    requests.lock().unwrap().push(body.clone());
                    if fail {
                        return "{}".to_owned();
                    }
                    let answers: serde_json::Map<String, serde_json::Value> = body["questions"]
                        .as_object()
                        .unwrap()
                        .iter()
                        .map(|(id, question)| {
                            let probability = if question.to_string().contains("match") {
                                0.5
                            } else {
                                0.1
                            };
                            (
                                id.clone(),
                                serde_json::json!({"type":"noul","noul":probability}),
                            )
                        })
                        .collect();
                    serde_json::json!({"answers":answers}).to_string()
                }
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let rules = vec![
            candidate("no", 0, Some("mail"), Some("Is this rejected?")),
            candidate("yes", 1, Some("mail"), Some("Does this match?")),
            candidate("global", 0, None, Some("Does this match?")),
        ];
        let result = evaluate(repo, "A public draft", &rules, None)
            .await
            .unwrap();
        assert_eq!(result.selected_rule_id.as_deref(), Some("yes"));
        assert_eq!(result.evaluations.len(), 2);
        assert_eq!(result.evaluations[1].probability, Some(0.5));
        assert_eq!(received.lock().unwrap().len(), 1);
        assert_eq!(
            received.lock().unwrap()[0]["questions"]
                .as_object()
                .unwrap()
                .len(),
            2
        );
        received.lock().unwrap().clear();
        let fallback = vec![rules[0].clone(), rules[2].clone()];
        assert_eq!(
            evaluate(repo, "Public draft", &fallback, None)
                .await
                .unwrap()
                .selected_rule_id
                .as_deref(),
            Some("global")
        );
        assert_eq!(received.lock().unwrap().len(), 2);

        // Journal answers across recovery, retain selection, and recheck claims/grants.
        let (clip, _) = repo
            .capture(
                crate::history::CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: vec![],
                    representations: vec![crate::history::CapturedRepresentation {
                        format_key: "text/plain".into(),
                        canonical_mime_type: Some("text/plain".into()),
                        native_type: None,
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: crate::history::CapturedPayload::Text("Public draft".into()),
                    }],
                },
                &crate::history::CaptureSettings::default(),
            )
            .await
            .unwrap();
        let checksum = "a".repeat(64);
        sqlx::query("INSERT INTO extension_installs(id,package_id,version,api_version,source,sha256,relative_path,enabled,installed_at,updated_at) VALUES('fixture','fixture','1.0.0','^3.2','developer',?,'fixture',1,1,1)").bind(&checksum).execute(&repo.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO extension_runtime_state(extension_id,status) VALUES('fixture','ready')",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO extension_permission_grants(extension_id,package_sha256,permission_kind,permission_value,granted_at) VALUES('fixture',?,'background_clip_created','clip.created',1)").bind(&checksum).execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO extension_activation_events(event_id,package_id,activation_id,source_clip_id,captured_at,is_new_clip,package_sha256,configuration_revision,grant_revision,rule_id,parameters_json,status,created_at,updated_at,evaluation_claim,lease_until,candidates_json) VALUES('event','fixture','copy',?,1,1,?,0,0,'global','{}','pending',1,1,1,?,?)")
            .bind(&clip).bind(&checksum).bind(now_ms()+180_000).bind(serde_json::to_string(&fallback).unwrap()).execute(&repo.pool).await.unwrap();
        for rule in &fallback {
            sqlx::query("INSERT INTO extension_automation_rules(package_id,rule_id,activation_id,enabled,parameters_json,revision,updated_at) VALUES('fixture',?,'copy',1,'{}',0,1)").bind(&rule.rule_id).execute(&repo.pool).await.unwrap();
        }
        let key = EventKey {
            event: "event",
            package: "fixture",
            activation: "copy",
            claim: 1,
        };
        received.lock().unwrap().clear();
        assert_eq!(
            evaluate(repo, "Public draft", &fallback, Some(&key))
                .await
                .unwrap()
                .selected_rule_id
                .as_deref(),
            Some("global")
        );
        assert_eq!(received.lock().unwrap().len(), 2);
        assert_eq!(
            evaluate(repo, "Public draft", &fallback, Some(&key))
                .await
                .unwrap()
                .selected_rule_id
                .as_deref(),
            Some("global")
        );
        assert_eq!(
            received.lock().unwrap().len(),
            2,
            "recovery must reuse checkpointed answers"
        );
        sqlx::query("UPDATE extension_activation_events SET selected_rule_id='global',decision_revision=NULL WHERE event_id='event'").execute(&repo.pool).await.unwrap();
        let row = sqlx::query("SELECT * FROM extension_activation_events WHERE event_id='event'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            select_event(repo, &key, &row)
                .await
                .unwrap()
                .unwrap()
                .rule_id,
            "global"
        );
        assert_eq!(
            received.lock().unwrap().len(),
            2,
            "selected winner survives model changes"
        );
        let stale = EventKey { claim: 0, ..key };
        assert!(evaluate(repo, "Public draft", &fallback, Some(&stale))
            .await
            .is_err());
        sqlx::query("DELETE FROM extension_permission_grants WHERE extension_id='fixture'")
            .execute(&repo.pool)
            .await
            .unwrap();
        assert!(evaluate(repo, "Public draft", &fallback, Some(&key))
            .await
            .is_err());
        failed.store(true, Ordering::SeqCst);
        received.lock().unwrap().clear();
        assert!(evaluate(repo, "Public draft", &fallback, None)
            .await
            .is_err());
        assert_eq!(received.lock().unwrap().len(), 1);
        server.abort();
    }
}
