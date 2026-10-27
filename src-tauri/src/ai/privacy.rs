//! Device-local capture rules. Evaluate in memory, then commit labels with the clip.
use super::{configuration, decision};
use crate::history::{new_id, now_ms, CapturedPayload, CapturedSnapshot, HistoryRepository};
use anyhow::{bail, Context, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use ts_rs::TS;

const KEY: &str = "privacy.capture_rules";
const SECRET_QUESTION: &str = "Does clipboard_text contain actual passwords, authentication credentials, private keys, account recovery codes, or session secrets? Exclude placeholders, masked values, public identifiers, and code that only references credentials.";
// A starting decision boundary, not an accuracy claim. Users can probe it with Test rule.
const MATCH_THRESHOLD: f64 = 0.5;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivacySettings {
    pub skip_secrets: bool,
    pub rules: Vec<DecisionRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionRule {
    pub id: String,
    pub name: String,
    pub question: String,
    pub action: RuleAction,
    pub tag: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum RuleAction {
    MarkSecret,
    MarkPrivate,
    Skip,
    Tag,
    Favorite,
    Pin,
}

impl RuleAction {
    fn is_general(self) -> bool {
        matches!(self, Self::Tag | Self::Favorite | Self::Pin)
    }
}

impl PrivacySettings {
    pub fn validate(&self) -> Result<()> {
        if self.rules.len() > 32 {
            bail!("privacy_rule_limit");
        }
        let mut ids = HashSet::new();
        for rule in &self.rules {
            if uuid::Uuid::parse_str(&rule.id).is_err()
                || !ids.insert(&rule.id)
                || rule.name.trim().is_empty()
                || rule.name.len() > 128
                || rule.name.chars().any(char::is_control)
                || rule.question.trim().is_empty()
                || rule.question.len() > 2048
                || (rule.action == RuleAction::Tag
                    && rule.tag.as_ref().is_none_or(|tag| {
                        tag.trim().is_empty() || tag.len() > 80 || tag.chars().any(char::is_control)
                    }))
                || (rule.action != RuleAction::Tag && rule.tag.is_some())
            {
                bail!("invalid_privacy_rule");
            }
        }
        Ok(())
    }
}

pub async fn settings(repo: &HistoryRepository) -> Result<PrivacySettings> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM config_device_values WHERE key=?")
            .bind(KEY)
            .fetch_optional(&repo.pool)
            .await?;
    let settings: PrivacySettings = value
        .map(|value| serde_json::from_str(&value))
        .transpose()?
        .unwrap_or_default();
    settings.validate()?;
    Ok(settings)
}

pub async fn save(repo: &HistoryRepository, settings: PrivacySettings) -> Result<()> {
    settings.validate()?;
    sqlx::query("INSERT INTO config_device_values(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .bind(KEY).bind(serde_json::to_string(&settings)?).bind(now_ms()).execute(&repo.pool).await?;
    Ok(())
}

#[derive(Debug, Default)]
pub(crate) struct CaptureDecision {
    secret: bool,
    private: bool,
    reviews: Vec<DecisionReview>,
    tags: Vec<String>,
    favorite: bool,
    pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionReview {
    pub stage: String,
    pub status: String,
    pub reason: Option<String>,
    pub evaluated_at: i64,
}

fn review(stage: &str, reason: Option<&str>) -> DecisionReview {
    DecisionReview {
        stage: stage.into(),
        status: if reason.is_some() {
            "not_checked"
        } else {
            "completed"
        }
        .into(),
        reason: reason.map(str::to_owned),
        evaluated_at: now_ms(),
    }
}

fn failure_reason(error: &anyhow::Error) -> &'static str {
    match error.to_string().as_str() {
        "decision_input_limit" => "input_limit",
        "decision_timeout" => "timeout",
        "invalid_decision_response" => "invalid_response",
        "missing_privacy_model"
        | "missing_decision_preset"
        | "decision_connection_unavailable"
        | "missing_credential"
        | "unsupported_decision_provider"
        | "invalid_decision_endpoint" => "unavailable",
        _ => match error.downcast_ref::<crate::providers::error::ProviderError>() {
            Some(crate::providers::error::ProviderError::Timeout) => "timeout",
            Some(crate::providers::error::ProviderError::InputLimit) => "input_limit",
            Some(crate::providers::error::ProviderError::Rejected {
                context_overflow: true,
                ..
            }) => "input_limit",
            Some(crate::providers::error::ProviderError::InvalidOutput(_)) => "invalid_response",
            Some(_) => "unavailable",
            None => "other",
        },
    }
}

pub(crate) async fn evaluate(
    repo: &HistoryRepository,
    snapshot: &CapturedSnapshot,
    progress: &(dyn Fn(&str) + Send + Sync),
) -> Result<CaptureDecision> {
    let config = settings(repo).await?;
    let texts: Vec<_> = snapshot
        .representations
        .iter()
        .filter_map(|rep| match &rep.payload {
            CapturedPayload::Text(text) if !text.trim().is_empty() => Some(text.as_str()),
            _ => None,
        })
        .collect();
    let secret = texts
        .iter()
        .any(|text| crate::contributions::contains_secret(text));
    let mut result = CaptureDecision {
        secret,
        ..Default::default()
    };
    if secret {
        if config.skip_secrets {
            bail!("privacy_secret_not_saved");
        }
        // A known credential needs no probabilistic review or general-provider disclosure.
        return Ok(result);
    }
    if texts.is_empty() {
        return Ok(result);
    }
    let document = configuration::export(repo).await?;
    let enabled: Vec<_> = config.rules.iter().filter(|rule| rule.enabled).collect();
    if document.selections.privacy_decision.is_none() && enabled.is_empty() {
        return Ok(result);
    }
    let input_bytes =
        texts.iter().map(|text| text.len()).sum::<usize>() + texts.len().saturating_sub(1) * 2;
    let text = if input_bytes <= 64 * 1024 {
        texts.join("\n\n")
    } else {
        String::new()
    };
    let has_privacy = document.selections.privacy_decision.is_some()
        || enabled.iter().any(|r| !r.action.is_general());
    let has_organization = enabled.iter().any(|r| r.action.is_general());
    let mut stage = if has_privacy {
        "privacy"
    } else {
        "organization"
    };
    let run = async {
        if input_bytes > 64 * 1024 {
            bail!("decision_input_limit");
        }
        // Resolve privacy before general classification; private inputs never reach the general slot.
        let privacy_rules: Vec<_> = enabled.iter().filter(|r| !r.action.is_general()).collect();
        let mut questions = BTreeMap::new();
        if document.selections.privacy_decision.is_some() {
            questions.insert("secret".into(), SECRET_QUESTION.into());
        }
        for (index, rule) in privacy_rules.iter().enumerate() {
            questions.insert(format!("rule_{index}"), rule.question.clone());
        }
        if !questions.is_empty() {
            progress("privacy");
            let preset = document
                .selections
                .privacy_decision
                .as_deref()
                .context("missing_privacy_model")?;
            let answers = decision::predicates(repo, preset, &text, &questions).await?;
            if answers.get("secret").is_some_and(|v| *v >= MATCH_THRESHOLD) {
                result.secret = true;
            }
            for (index, rule) in privacy_rules.iter().enumerate() {
                if answers[&format!("rule_{index}")] >= MATCH_THRESHOLD {
                    match rule.action {
                        RuleAction::MarkSecret => result.secret = true,
                        RuleAction::MarkPrivate => result.private = true,
                        RuleAction::Skip => bail!("privacy_rule_not_saved"),
                        RuleAction::Tag | RuleAction::Favorite | RuleAction::Pin => unreachable!(),
                    }
                }
            }
            result.reviews.push(review("privacy", None));
        }
        if result.secret && config.skip_secrets {
            bail!("privacy_secret_not_saved");
        }
        // Duplicate captures retain earlier restrictions even if the rules have changed.
        let retained_restriction: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM clip_items c JOIN content_clip_facets f ON f.clip_id=c.id WHERE c.capture_sha256=? AND c.lifecycle_state='ready' AND f.facet_id IN ('core.security.secret','core.security.private'))")
            .bind(crate::history::capture_fingerprint(&snapshot.representations))
            .fetch_one(&repo.pool).await?;
        if result.secret || result.private || retained_restriction {
            return Ok(());
        }
        let general_rules: Vec<_> = enabled.iter().filter(|r| r.action.is_general()).collect();
        if !general_rules.is_empty() {
            stage = "organization";
            progress("organizing");
            let preset = document
                .selections
                .default_decision
                .as_deref()
                .context("missing_decision_preset")?;
            let questions = general_rules
                .iter()
                .enumerate()
                .map(|(index, rule)| (format!("rule_{index}"), rule.question.clone()))
                .collect();
            let answers = decision::predicates(repo, preset, &text, &questions).await?;
            for (index, rule) in general_rules.iter().enumerate() {
                if answers[&format!("rule_{index}")] >= MATCH_THRESHOLD {
                    match rule.action {
                        RuleAction::Tag => result
                            .tags
                            .push(rule.tag.clone().context("invalid_privacy_rule")?),
                        RuleAction::Favorite => result.favorite = true,
                        RuleAction::Pin => result.pinned = true,
                        _ => unreachable!(),
                    }
                }
            }
            result.reviews.push(review("organization", None));
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = run {
        if matches!(
            error.to_string().as_str(),
            "privacy_rule_not_saved" | "privacy_secret_not_saved"
        ) {
            return Err(error);
        }
        result
            .reviews
            .push(review(stage, Some(failure_reason(&error))));
        if stage == "privacy" && has_organization {
            result
                .reviews
                .push(review("organization", Some("privacy_not_checked")));
        }
        result.tags.clear();
        result.favorite = false;
        result.pinned = false;
        progress(if error.to_string() == "decision_input_limit" {
            "input_limit"
        } else {
            "unreviewed"
        });
    }
    // Do not commit classifications made against superseded settings or model bindings.
    if serde_json::to_string(&settings(repo).await?)? != serde_json::to_string(&config)?
        || serde_json::to_string(&configuration::export(repo).await?)?
            != serde_json::to_string(&document)?
    {
        bail!("privacy_configuration_changed");
    }
    Ok(result)
}

impl CaptureDecision {
    pub async fn persist(&self, tx: &mut sqlx::SqliteConnection, clip_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM clip_decision_reviews WHERE clip_id=?")
            .bind(clip_id)
            .execute(&mut *tx)
            .await?;
        for review in &self.reviews {
            sqlx::query("INSERT INTO clip_decision_reviews(clip_id,stage,status,reason,evaluated_at) VALUES(?,?,?,?,?)")
                .bind(clip_id).bind(&review.stage).bind(&review.status).bind(&review.reason).bind(review.evaluated_at).execute(&mut *tx).await?;
        }
        // Retain earlier restrictions on a duplicate copy; ordinary redetection cannot clear these labels.
        for (facet, name, present) in [
            ("core.security.secret", "Secret", self.secret),
            ("core.security.private", "Private", self.private),
        ] {
            if !present {
                continue;
            }
            sqlx::query("INSERT INTO content_facet_definitions(id,owner_id,version,display_name) VALUES(?,?,'1',?) ON CONFLICT(id) DO NOTHING")
                .bind(facet).bind(if facet == "core.security.secret" { "builtin" } else { "builtin.privacy" }).bind(name).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO content_clip_facets(clip_id,facet_id,source_representation_id,detector_id,detector_version,payload_json) SELECT clip_id,?,id,?,?,? FROM clip_representations WHERE clip_id=? ON CONFLICT DO UPDATE SET payload_json=excluded.payload_json")
                .bind(facet).bind("builtin.privacy").bind("1").bind(serde_json::json!({"schemaVersion":2,"kind":"privacy_check","warning":"Restricted by privacy policy"}).to_string()).bind(clip_id).execute(&mut *tx).await?;
        }
        if self.favorite || self.pinned {
            sqlx::query("UPDATE clip_items SET is_favorite=MAX(is_favorite,?),is_pinned=MAX(is_pinned,?),updated_at=? WHERE id=?")
                .bind(self.favorite).bind(self.pinned).bind(now_ms()).bind(clip_id).execute(&mut *tx).await?;
        }
        for tag in &self.tags {
            sqlx::query("INSERT INTO catalog_tags(id,name,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO NOTHING")
                .bind(new_id()).bind(tag.trim()).bind(now_ms()).bind(now_ms()).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO catalog_clip_tags(clip_id,tag_id,created_at) SELECT ?,id,? FROM catalog_tags WHERE name=? ON CONFLICT DO NOTHING")
                .bind(clip_id).bind(now_ms()).bind(tag.trim()).execute(&mut *tx).await?;
        }
        Ok(())
    }
}

pub async fn restricted(repo: &HistoryRepository, clip_id: &str) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM content_clip_facets WHERE clip_id=? AND facet_id IN ('core.security.secret','core.security.private'))")
        .bind(clip_id).fetch_one(&repo.pool).await?)
}

pub async fn test_rule(repo: &HistoryRepository, rule: DecisionRule, text: String) -> Result<f64> {
    PrivacySettings {
        skip_secrets: false,
        rules: vec![rule.clone()],
    }
    .validate()?;
    let document = configuration::export(repo).await?;
    let preset = if rule.action.is_general() {
        if crate::contributions::contains_secret(&text) {
            bail!("privacy_secret_input");
        }
        document.selections.default_decision
    } else {
        document.selections.privacy_decision
    }
    .context("missing_decision_preset")?;
    Ok(decision::predicates(
        repo,
        &preset,
        &text,
        &BTreeMap::from([("match".into(), rule.question)]),
    )
    .await?["match"])
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSecretStatus {
    pub capture_hash: String,
    pub secret: bool,
    pub private: bool,
}
pub async fn clip_secret_status(
    repo: &HistoryRepository,
    clip_id: &str,
) -> Result<ClipSecretStatus> {
    use sqlx::Row;
    let row=sqlx::query("SELECT c.capture_sha256,EXISTS(SELECT 1 FROM content_clip_facets f WHERE f.clip_id=c.id AND f.facet_id='core.security.secret'),EXISTS(SELECT 1 FROM content_clip_facets f WHERE f.clip_id=c.id AND f.facet_id='core.security.private') FROM clip_items c WHERE c.id=? AND c.lifecycle_state='ready'").bind(clip_id).fetch_optional(&repo.pool).await?.context("privacy_clip_unavailable")?;
    Ok(ClipSecretStatus {
        capture_hash: row.try_get(0)?,
        secret: row.get(1),
        private: row.get(2),
    })
}
pub async fn clear_secret(
    repo: &HistoryRepository,
    clip_id: &str,
    expected_hash: &str,
) -> Result<ClipSecretStatus> {
    let mut tx = repo.pool.begin().await?;
    let hash: String = sqlx::query_scalar(
        "SELECT capture_sha256 FROM clip_items WHERE id=? AND lifecycle_state='ready'",
    )
    .bind(clip_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("privacy_clip_unavailable")?;
    if hash != expected_hash {
        bail!("privacy_clip_changed")
    }
    sqlx::query(
        "DELETE FROM content_clip_facets WHERE clip_id=? AND facet_id='core.security.secret'",
    )
    .bind(clip_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM content_compact_presentations WHERE clip_id=? AND facet_id='core.security.secret'").bind(clip_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE clip_items SET updated_at=? WHERE id=?")
        .bind(now_ms())
        .bind(clip_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    clip_secret_status(repo, clip_id).await
}
