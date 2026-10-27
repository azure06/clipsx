use super::{configuration, contracts::*, privacy::*};
use crate::history::{
    new_id, CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
};

fn snapshot(text: &str) -> CapturedSnapshot {
    CapturedSnapshot {
        token: 1,
        source_app_name: None,
        source_app_id: None,
        format_observations: vec![],
        representations: vec![CapturedRepresentation {
            format_key: "text/plain".into(),
            canonical_mime_type: Some("text/plain".into()),
            native_type: None,
            platform: "windows".into(),
            capture_priority: 1,
            payload: CapturedPayload::Text(text.into()),
        }],
    }
}
fn rule(action: RuleAction) -> DecisionRule {
    DecisionRule {
        id: new_id(),
        name: "Customer privacy".into(),
        question: "Does this contain confidential customer information?".into(),
        action,
        tag: None,
        enabled: true,
    }
}

#[tokio::test]
async fn oversized_decision_input_is_saved_in_full_unchecked_even_with_strict_rules() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    save(
        repo,
        PrivacySettings {
            skip_secrets: true,
            rules: vec![rule(RuleAction::Skip)],
        },
    )
    .await
    .unwrap();
    let text = "ordinary public text ".repeat(4000);
    let phases = std::sync::Mutex::new(Vec::new());
    let (id, _) = repo
        .capture_with_progress(snapshot(&text), &CaptureSettings::default(), &|phase| {
            phases.lock().unwrap().push(phase.to_owned());
        })
        .await
        .unwrap();
    assert!(!restricted(repo, &id).await.unwrap());
    assert!(phases.lock().unwrap().contains(&"input_limit".to_owned()));
    let saved: String = sqlx::query_scalar("SELECT t.text_value FROM clip_text_values t JOIN clip_representations r ON r.id=t.representation_id WHERE r.clip_id=?")
        .bind(&id).fetch_one(&repo.pool).await.unwrap();
    assert_eq!(saved, text);
    let summary = repo.summary(&id).await.unwrap();
    assert_eq!(summary.decision_reviews[0].stage, "privacy");
    assert_eq!(
        summary.decision_reviews[0].reason.as_deref(),
        Some("input_limit")
    );
    assert!(
        crate::search::semantic::eligibility::clip_is_eligible(repo, &id)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn heuristics_restrict_immediately_and_skip_happens_before_storage() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let secret = "APP_PASSWORD=correct-horse-battery-staple";
    let (id, _) = repo
        .capture(snapshot(secret), &CaptureSettings::default())
        .await
        .unwrap();
    assert!(restricted(repo, &id).await.unwrap());
    crate::contributions::detect_clip(repo, &id).await.unwrap();
    assert!(restricted(repo, &id).await.unwrap());
    let facets = crate::contributions::facets(repo, &id).await.unwrap();
    assert_eq!(
        facets
            .iter()
            .filter(|facet| facet.id == "core.security.secret")
            .count(),
        1
    );
    assert!(
        !crate::search::semantic::eligibility::clip_is_eligible(repo, &id)
            .await
            .unwrap()
    );
    let long = format!(
        "{}\nAPI_KEY=abcdef0123456789abcdef",
        "public information ".repeat(300)
    );
    let (long_id, _) = repo
        .capture(snapshot(&long), &CaptureSettings::default())
        .await
        .unwrap();
    crate::contributions::detect_clip(repo, &long_id)
        .await
        .unwrap();
    assert!(restricted(repo, &long_id).await.unwrap());
    save(
        repo,
        PrivacySettings {
            skip_secrets: true,
            rules: vec![],
        },
    )
    .await
    .unwrap();
    assert!(repo
        .capture(
            snapshot("API_KEY=abcdef0123456789abcdef"),
            &CaptureSettings::default()
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("not_saved"));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM clip_items")
        .fetch_one(&repo.pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    assert!(settings(repo).await.unwrap().skip_secrets);
}

#[tokio::test]
async fn missing_models_save_unchecked_without_partial_writes() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let config = PrivacySettings {
        skip_secrets: false,
        rules: vec![rule(RuleAction::MarkPrivate)],
    };
    save(repo, config).await.unwrap();
    let (id, _) = repo
        .capture(
            snapshot("A customer called about their contract"),
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    assert!(!restricted(repo, &id).await.unwrap());
    let cleanup: i64 =
        sqlx::query_scalar("SELECT count(*) FROM search_semantic_cleanup WHERE clip_id=?")
            .bind(&id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(cleanup, 0);
    save(
        repo,
        PrivacySettings {
            skip_secrets: false,
            rules: vec![rule(RuleAction::Skip)],
        },
    )
    .await
    .unwrap();
    assert!(repo
        .capture(snapshot("Another customer"), &CaptureSettings::default())
        .await
        .is_ok());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM clip_items")
        .fetch_one(&repo.pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn review_records_follow_recapture_and_clip_lifecycle() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let text = "an ordinary public memo";
    let (id, _) = repo
        .capture(snapshot(text), &CaptureSettings::default())
        .await
        .unwrap();
    assert!(repo.summary(&id).await.unwrap().decision_reviews.is_empty());
    let mut tag = rule(RuleAction::Tag);
    tag.tag = Some("memo".into());
    save(
        repo,
        PrivacySettings {
            skip_secrets: true,
            rules: vec![tag],
        },
    )
    .await
    .unwrap();
    let (duplicate, reused) = repo
        .capture(snapshot(text), &CaptureSettings::default())
        .await
        .unwrap();
    assert!(reused);
    assert_eq!(duplicate, id);
    let summary = repo.summary(&id).await.unwrap();
    assert_eq!(summary.decision_reviews.len(), 1);
    assert_eq!(summary.decision_reviews[0].stage, "organization");
    assert_eq!(
        summary.decision_reviews[0].reason.as_deref(),
        Some("unavailable")
    );
    assert!(summary.tags.is_empty());
    assert!(!restricted(repo, &id).await.unwrap());
    let (_, _, path): (i64, String, String) = sqlx::query_as("PRAGMA database_list")
        .fetch_one(&repo.pool)
        .await
        .unwrap();
    let reopened = crate::history::HistoryRepository::connect(
        std::path::Path::new(&path),
        repo.managed_root.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        reopened.summary(&id).await.unwrap().decision_reviews.len(),
        1
    );
    reopened.pool.close().await;
    assert_eq!(
        repo.summaries(std::slice::from_ref(&id)).await.unwrap()[&id]
            .decision_reviews
            .len(),
        1
    );
    save(repo, PrivacySettings::default()).await.unwrap();
    repo.capture(snapshot(text), &CaptureSettings::default())
        .await
        .unwrap();
    assert!(repo.summary(&id).await.unwrap().decision_reviews.is_empty());
    save(
        repo,
        PrivacySettings {
            skip_secrets: false,
            rules: vec![rule(RuleAction::MarkPrivate)],
        },
    )
    .await
    .unwrap();
    repo.capture(snapshot(text), &CaptureSettings::default())
        .await
        .unwrap();
    assert_eq!(repo.summary(&id).await.unwrap().decision_reviews.len(), 1);
    repo.delete(&id).await.unwrap();
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM clip_decision_reviews WHERE clip_id=?")
            .bind(&id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn provider_failures_are_informational_and_stage_specific() {
    use axum::{routing::post, Router};
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let connection = AiConnection {
        id: new_id(),
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
        id: new_id(),
        name: "Privacy".into(),
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
                privacy_decision: Some(preset.id.clone()),
                default_decision: Some(preset.id),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    let app = Router::new().route(
        "/v1/systemone",
        post(|bytes: axum::body::Bytes| async move {
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            if body["state"]["clipboard_text"]
                .as_str()
                .unwrap()
                .contains("timeout fixture")
            {
                tokio::time::sleep(std::time::Duration::from_secs(13)).await;
            }
            if body["questions"].get("secret").is_some()
                && body["state"]["clipboard_text"]
                    .as_str()
                    .unwrap()
                    .contains("organization fixture")
            {
                return serde_json::json!({"answers":{"secret":{"type":"noul","noul":0.1}}})
                    .to_string();
            }
            "{\"answers\":{}}".to_owned()
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    save(
        repo,
        PrivacySettings {
            skip_secrets: true,
            rules: vec![],
        },
    )
    .await
    .unwrap();
    for (text, reason) in [
        ("malformed fixture", "invalid_response"),
        ("timeout fixture", "timeout"),
    ] {
        let (id, _) = repo
            .capture(snapshot(text), &CaptureSettings::default())
            .await
            .unwrap();
        let summary = repo.summary(&id).await.unwrap();
        assert_eq!(summary.decision_reviews[0].reason.as_deref(), Some(reason));
        assert!(!restricted(repo, &id).await.unwrap());
        assert!(
            crate::search::semantic::eligibility::clip_is_eligible(repo, &id)
                .await
                .unwrap()
        );
    }
    let mut tag = rule(RuleAction::Tag);
    tag.tag = Some("Should not appear".into());
    save(
        repo,
        PrivacySettings {
            skip_secrets: false,
            rules: vec![tag],
        },
    )
    .await
    .unwrap();
    let (id, _) = repo
        .capture(
            snapshot("organization fixture"),
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    let summary = repo.summary(&id).await.unwrap();
    assert!(summary
        .decision_reviews
        .iter()
        .any(|r| r.stage == "privacy" && r.status == "completed"));
    assert!(summary
        .decision_reviews
        .iter()
        .any(|r| r.stage == "organization" && r.reason.as_deref() == Some("invalid_response")));
    assert!(summary.tags.is_empty());
    assert!(!restricted(repo, &id).await.unwrap());
    server.abort();
}

#[tokio::test]
async fn privacy_precedes_general_model_and_negative_models_cannot_override_heuristics() {
    use axum::{routing::post, Router};
    use std::sync::{Arc, Mutex};
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let requests = Arc::new(Mutex::new(Vec::new()));
    let received = requests.clone();
    let positive = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let model_positive = positive.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let connection = AiConnection {
        id: new_id(),
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
        id: new_id(),
        name: "Privacy".into(),
        connection_id: connection.id.clone(),
        model_id: "fixture".into(),
        purpose: AiModelPurpose::Decision,
        context_limit: 32768,
        output_limit: 4096,
        options: configuration::default_options(),
        capabilities: configuration::unknown_capabilities(),
    };
    let mut general = preset.clone();
    general.id = new_id();
    general.model_id = "general-must-not-run".into();
    configuration::import(
        repo,
        AiConfiguration {
            version: 4,
            connections: vec![connection],
            presets: vec![preset.clone(), general.clone()],
            selections: AiSelections {
                privacy_decision: Some(preset.id),
                default_decision: Some(general.id),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    let app = Router::new().route("/v1/systemone", post(move |bytes: axum::body::Bytes| {
        let received = received.clone(); let positive = model_positive.load(std::sync::atomic::Ordering::SeqCst); async move {
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            received.lock().unwrap().push(body.clone());
            let answers: serde_json::Map<String, serde_json::Value> = body["questions"].as_object().unwrap().keys().map(|id| (id.clone(), serde_json::json!({"type":"noul","noul":if id == "secret" || !positive {0.1} else {0.9}}))).collect();
            serde_json::json!({"answers": answers}).to_string()
        }
    }));
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut tag = rule(RuleAction::Tag);
    tag.tag = Some("Customer".into());
    save(
        repo,
        PrivacySettings {
            skip_secrets: false,
            rules: vec![
                rule(RuleAction::MarkPrivate),
                tag.clone(),
                rule(RuleAction::Favorite),
                rule(RuleAction::Pin),
            ],
        },
    )
    .await
    .unwrap();
    let private_capture = with_format(
        snapshot("Customer Alice has a confidential contract"),
        "text/html",
        &format!(
            "<p>Customer Alice has a confidential contract</p><!-- {} -->",
            "formatting ".repeat(7000)
        ),
    );
    let (id, _) = repo
        .capture(private_capture.clone(), &CaptureSettings::default())
        .await
        .unwrap();
    assert!(restricted(repo, &id).await.unwrap());
    let flags = repo.summary(&id).await.unwrap();
    assert!(!flags.is_favorite && !flags.is_pinned);
    assert_eq!(requests.lock().unwrap().len(), 1);
    assert_eq!(requests.lock().unwrap()[0]["model"], "fixture");
    assert_eq!(
        requests.lock().unwrap()[0]["state"]["clipboard_text"],
        "Customer Alice has a confidential contract"
    );
    // No detector or general call sees a credential already settled by native checks.
    let (secret, _) = repo
        .capture(
            snapshot("password=MyActualPassword123!"),
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    assert!(restricted(repo, &secret).await.unwrap());
    assert_eq!(requests.lock().unwrap().len(), 1);
    save(
        repo,
        PrivacySettings {
            skip_secrets: false,
            rules: vec![tag, rule(RuleAction::Favorite), rule(RuleAction::Pin)],
        },
    )
    .await
    .unwrap();
    let (public, _) = repo
        .capture(
            snapshot("A public customer guide"),
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    assert!(!restricted(repo, &public).await.unwrap());
    let tag_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM catalog_clip_tags WHERE clip_id=?")
            .bind(&public)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(tag_count, 1);
    assert_eq!(requests.lock().unwrap().len(), 3);
    assert_eq!(requests.lock().unwrap()[2]["model"], "general-must-not-run");
    // A changed policy cannot disclose a previously private duplicate to the general model.
    let before = requests.lock().unwrap().len();
    let (private_duplicate, reused) = repo
        .capture(private_capture, &CaptureSettings::default())
        .await
        .unwrap();
    assert!(reused);
    assert_eq!(private_duplicate, id);
    assert!(restricted(repo, &private_duplicate).await.unwrap());
    assert_eq!(requests.lock().unwrap().len(), before + 1);
    assert_eq!(requests.lock().unwrap().last().unwrap()["model"], "fixture");
    let flags = repo.summary(&public).await.unwrap();
    assert!(flags.is_favorite && flags.is_pinned);
    for action in [RuleAction::Favorite, RuleAction::Pin] {
        assert_eq!(
            test_rule(repo, rule(action), "Public work notes".into())
                .await
                .unwrap(),
            0.9
        );
        assert!(
            test_rule(repo, rule(action), "password=MyActualPassword123!".into())
                .await
                .is_err()
        );
    }
    positive.store(false, std::sync::atomic::Ordering::SeqCst);
    let (duplicate, reused) = repo
        .capture(
            snapshot("A public customer guide"),
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    assert!(reused);
    assert_eq!(duplicate, public);
    let flags = repo.summary(&duplicate).await.unwrap();
    assert!(flags.is_favorite && flags.is_pinned);
    let (negative, _) = repo
        .capture(
            snapshot("An unrelated public clip"),
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    let flags = repo.summary(&negative).await.unwrap();
    assert!(!flags.is_favorite && !flags.is_pinned);
    positive.store(true, std::sync::atomic::Ordering::SeqCst);
    // A model-backed skip rule must leave no canonical clip behind.
    save(
        repo,
        PrivacySettings {
            skip_secrets: false,
            rules: vec![rule(RuleAction::Skip)],
        },
    )
    .await
    .unwrap();
    assert!(repo
        .capture(
            snapshot("Do not keep this customer contract"),
            &CaptureSettings::default()
        )
        .await
        .is_err());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM clip_items")
        .fetch_one(&repo.pool)
        .await
        .unwrap();
    assert_eq!(count, 4);
    server.abort();
}

#[tokio::test]
async fn old_configuration_imports_preserve_privacy_and_removal_clears_it() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let connection = AiConnection {
        id: new_id(),
        name: "Fixture".into(),
        provider: AiProviderKind::Ollama,
        base_url: "http://127.0.0.1:11434".into(),
        enabled: true,
        options: AiConnectionOptions {
            organization: None,
            project: None,
        },
    };
    let preset = AiModelPreset {
        id: new_id(),
        name: "Privacy".into(),
        connection_id: connection.id.clone(),
        model_id: "fixture".into(),
        purpose: AiModelPurpose::Decision,
        context_limit: 32768,
        output_limit: 4096,
        options: configuration::default_options(),
        capabilities: configuration::unknown_capabilities(),
    };
    let doc = AiConfiguration {
        version: 4,
        connections: vec![connection],
        presets: vec![preset.clone()],
        selections: AiSelections {
            privacy_decision: Some(preset.id.clone()),
            ..Default::default()
        },
    };
    configuration::import(repo, doc.clone()).await.unwrap();
    let mut old = doc;
    old.version = 3;
    old.selections.privacy_decision = None;
    configuration::import(repo, old).await.unwrap();
    assert_eq!(
        configuration::export(repo)
            .await
            .unwrap()
            .selections
            .privacy_decision,
        Some(preset.id.clone())
    );
    configuration::remove(repo, None, Some(preset.id.clone()))
        .await
        .unwrap();
    assert!(configuration::export(repo)
        .await
        .unwrap()
        .selections
        .privacy_decision
        .is_none());
}

#[test]
fn invalid_rules_are_rejected_before_saving() {
    let mut config = PrivacySettings {
        skip_secrets: false,
        rules: vec![rule(RuleAction::Tag)],
    };
    assert!(config.validate().is_err());
    config.rules[0].tag = Some("Work".into());
    assert!(config.validate().is_ok());
    config.rules.push(config.rules[0].clone());
    assert!(config.validate().is_err());
}

#[tokio::test]
async fn clearing_secret_removes_only_classification_without_override_storage() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    let text = format!("API_KEY={}", "abcdef0123456789".repeat(2));
    let (id, _) = repo
        .capture(snapshot(&text), &CaptureSettings::default())
        .await
        .unwrap();
    let status = clip_secret_status(repo, &id).await.unwrap();
    assert!(status.secret);
    assert!(clear_secret(repo, &id, "stale-capture").await.is_err());
    assert!(clip_secret_status(repo, &id).await.unwrap().secret);
    let representations: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM clip_representations WHERE clip_id=?")
            .bind(&id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    let cleared = clear_secret(repo, &id, &status.capture_hash).await.unwrap();
    assert!(!cleared.secret);
    assert_eq!(cleared.private, status.private);
    let after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM clip_representations WHERE clip_id=?")
            .bind(&id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(after, representations);
    let overrides: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name='clip_secret_overrides'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(overrides, 0);
    crate::contributions::detect_clip(repo, &id).await.unwrap();
    assert!(clip_secret_status(repo, &id).await.unwrap().secret);
}

fn with_format(mut capture: CapturedSnapshot, mime: &str, text: &str) -> CapturedSnapshot {
    let mut rep = capture.representations[0].clone();
    rep.format_key = mime.into();
    rep.canonical_mime_type = Some(mime.into());
    rep.payload = CapturedPayload::Text(text.into());
    capture.representations.push(rep);
    capture
}

#[test]
fn decision_input_prefers_plain_text_without_duplicate_markup_or_false_input_limit() {
    let capture = with_format(
        snapshot("Readable memo"),
        "text/html",
        &format!("<p>{}</p>", "markup ".repeat(12000)),
    );
    assert_eq!(decision_text(&capture), "Readable memo");
    let mut preferred = capture.clone();
    preferred.representations[1].capture_priority = 0;
    assert_eq!(decision_text(&preferred), "Readable memo");
}

#[test]
fn decision_input_extracts_html_and_rtf_when_plain_text_is_missing_or_empty() {
    let html = with_format(
        snapshot("  "),
        "text/html",
        "<style>p { color:red }</style><p>Hello <b>world</b></p><script>ignored()</script>",
    );
    assert_eq!(decision_text(&html), "Hello world");
    let rtf = with_format(
        snapshot(""),
        "application/rtf",
        r"{\rtf1\ansi Hello \b world}",
    );
    assert_eq!(decision_text(&rtf), "Hello world");
    let unsafe_rtf = with_format(snapshot(""), "text/rtf", r"{\rtf1\object\objdata unsafe}");
    assert!(decision_text(&unsafe_rtf).is_empty());
}

#[test]
fn decision_input_preserves_plain_source_and_skips_binary_images() {
    let mut capture = snapshot(" ");
    capture.representations[0].payload = CapturedPayload::Binary(vec![1, 2, 3]);
    capture.representations[0].canonical_mime_type = Some("image/png".into());
    assert!(decision_text(&capture).is_empty());
    let json = with_format(capture, "application/json", r#"{"message":"hello"}"#);
    assert_eq!(decision_text(&json), r#"{"message":"hello"}"#);
}

#[tokio::test]
async fn plain_model_input_does_not_bypass_secret_heuristics_in_html() {
    let (_root, service) = crate::recall::service_tests::repository().await;
    let repo = &service.history;
    save(
        repo,
        PrivacySettings {
            skip_secrets: true,
            rules: vec![],
        },
    )
    .await
    .unwrap();
    let html = format!(
        "<p>Public memo</p><!-- API_KEY={} -->",
        "abcdef0123456789".repeat(2)
    );
    let capture = with_format(snapshot("Public memo"), "text/html", &html);
    assert_eq!(decision_text(&capture), "Public memo");
    assert!(repo
        .capture(capture, &CaptureSettings::default())
        .await
        .unwrap_err()
        .to_string()
        .contains("privacy_secret_not_saved"));
}
