use super::{configuration::*, contracts::*, credentials, service_tests::repository};
use crate::history::{new_id, now_ms};

fn connection(provider: AiProviderKind, name: &str) -> AiConnection {
    AiConnection {
        id: new_id(),
        name: name.into(),
        provider,
        base_url: if provider == AiProviderKind::Ollama {
            "http://127.0.0.1:11434".into()
        } else {
            "https://api.example.test/v1".into()
        },
        enabled: true,
        options: AiConnectionOptions {
            organization: None,
            project: None,
        },
    }
}
fn document(connections: Vec<AiConnection>) -> AiConfiguration {
    AiConfiguration {
        version: 1,
        connections,
        presets: vec![],
        selections: AiSelections {
            default_chat: None,
            active_embedding: None,
            web_search: None,
            ..AiSelections::default()
        },
    }
}

#[tokio::test]
async fn draft_connection_test_does_not_save_configuration() {
    let (_root, service) = repository().await;
    let before = serde_json::to_value(export(&service.history).await.unwrap()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut draft = connection(AiProviderKind::Ollama, "Unsaved fixture");
    draft.base_url = format!("http://{}", listener.local_addr().unwrap());
    let app = axum::Router::new().route(
        "/api/tags",
        axum::routing::get(|| async { serde_json::json!({"models": []}).to_string() }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    assert_eq!(
        test_connection(&service.history, &draft, None)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        serde_json::to_value(export(&service.history).await.unwrap()).unwrap(),
        before
    );
    assert!(credentials::get(&service.history, &draft.id)
        .await
        .unwrap()
        .is_none());
    server.abort();
}

#[tokio::test]
async fn draft_connection_test_requires_a_key_for_a_changed_destination() {
    let (_root, service) = repository().await;
    let saved = connection(AiProviderKind::Openai, "Saved");
    import(&service.history, document(vec![saved.clone()]))
        .await
        .unwrap();
    let mut draft = saved;
    draft.base_url = "https://different.example.test/v1".into();
    assert_eq!(
        test_connection(&service.history, &draft, None)
            .await
            .unwrap_err()
            .to_string(),
        "credential_required"
    );
    assert!(
        test_connection(&service.history, &draft, Some("bad\nkey".into()))
            .await
            .is_err()
    );
}

async fn embedding_fixture() -> (AiConfiguration, tokio::task::JoinHandle<()>) {
    use axum::{
        routing::{get, post},
        Router,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut connection = connection(AiProviderKind::Ollama, "Fixture");
    connection.base_url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/api/tags", get(|| async { serde_json::json!({"models":[{"name":"fixture-embedding","digest":"fixture-digest"}]}).to_string() }))
        .route("/api/show", post(|| async { serde_json::json!({"capabilities":["embedding"]}).to_string() }))
        .route("/api/embed", post(|| async { serde_json::json!({"embeddings":[[1.0,0.0]]}).to_string() }));
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut options = default_options();
    options.embedding = Some(EmbeddingPresetOptions {
        dimensions: None,
        task_policy: "symmetric".into(),
        hosted_indexing_enabled: false,
    });
    let preset = AiModelPreset {
        id: new_id(),
        name: "Fixture embedding".into(),
        connection_id: connection.id.clone(),
        model_id: "fixture-embedding".into(),
        purpose: AiModelPurpose::Embedding,
        context_limit: 32768,
        output_limit: 4096,
        options,
        capabilities: unknown_capabilities(),
    };
    let mut settings = document(vec![connection]);
    settings.selections.active_embedding = Some(preset.id.clone());
    settings.presets.push(preset);
    (settings, server)
}

#[tokio::test]
async fn failed_embedding_activation_survives_reopen_and_identical_offline_retry() {
    let (root, service) = repository().await;
    let repo = service.history.clone();
    let (settings, server) = embedding_fixture().await;
    sqlx::query("CREATE TRIGGER fixture_activation_failure BEFORE INSERT ON search_index_generations BEGIN SELECT RAISE(ABORT,'fixture activation failure'); END")
        .execute(&repo.pool).await.unwrap();
    assert!(import(&repo, settings.clone()).await.is_err());
    assert_eq!(
        export(&repo).await.unwrap().selections.active_embedding,
        settings.selections.active_embedding
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ai_embedding_activation")
            .fetch_one(&repo.pool)
            .await
            .unwrap(),
        1
    );
    // Subsequent recovery must use the verified descriptor, even with the provider offline.
    server.abort();
    let _ = server.await;
    sqlx::query("DROP TRIGGER fixture_activation_failure")
        .execute(&repo.pool)
        .await
        .unwrap();
    repo.pool.close().await;
    let reopened = crate::history::HistoryRepository::connect(
        &root.path().join("data/clips.db"),
        root.path().join("data/clipboard_data"),
    )
    .await
    .unwrap();
    import(&reopened, settings.clone()).await.unwrap();
    let generation: String =
        sqlx::query_scalar("SELECT id FROM search_index_generations WHERE status='building'")
            .fetch_one(&reopened.pool)
            .await
            .unwrap();
    assert!(!reconcile_embedding_activation(&reopened).await.unwrap());
    import(&reopened, settings).await.unwrap();
    let retained: String =
        sqlx::query_scalar("SELECT id FROM search_index_generations WHERE status='building'")
            .fetch_one(&reopened.pool)
            .await
            .unwrap();
    assert_eq!(generation, retained);
}

#[tokio::test]
async fn embedding_activation_recovery_fills_missing_jobs_without_resetting_completed_work() {
    let (_root, service) = repository().await;
    let repo = service.history.clone();
    let first = super::service_tests::capture(&service, "first source", "fixture", 1).await;
    let second = super::service_tests::capture(&service, "second source", "fixture", 2).await;
    let (settings, server) = embedding_fixture().await;
    sqlx::query("CREATE TRIGGER fixture_enqueue_failure BEFORE INSERT ON search_index_jobs BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END")
        .execute(&repo.pool).await.unwrap();
    assert!(import(&repo, settings.clone()).await.is_err());
    server.abort();
    let _ = server.await;
    let generation: String =
        sqlx::query_scalar("SELECT id FROM search_index_generations WHERE status='building'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    sqlx::query("DROP TRIGGER fixture_enqueue_failure")
        .execute(&repo.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO search_index_jobs(id,generation_id,clip_id,status,requested_at) VALUES(?,?,?,'completed',1)")
        .bind(new_id()).bind(&generation).bind(&first).execute(&repo.pool).await.unwrap();
    assert!(reconcile_embedding_activation(&repo).await.unwrap());
    let jobs: Vec<(String, String)> = sqlx::query_as(
        "SELECT clip_id,status FROM search_index_jobs WHERE generation_id=? ORDER BY clip_id",
    )
    .bind(&generation)
    .fetch_all(&repo.pool)
    .await
    .unwrap();
    assert_eq!(jobs.len(), 2);
    assert!(jobs.contains(&(first, "completed".into())));
    assert!(jobs.contains(&(second, "pending".into())));
    assert!(!reconcile_embedding_activation(&repo).await.unwrap());
    import(&repo, settings).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM search_index_generations")
            .fetch_one(&repo.pool)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn disabling_embeddings_supersedes_a_failed_activation() {
    let (_root, service) = repository().await;
    let repo = service.history.clone();
    let (mut settings, server) = embedding_fixture().await;
    sqlx::query("CREATE TRIGGER fixture_activation_failure BEFORE INSERT ON search_index_generations BEGIN SELECT RAISE(ABORT,'fixture activation failure'); END")
        .execute(&repo.pool).await.unwrap();
    assert!(import(&repo, settings.clone()).await.is_err());
    server.abort();
    let _ = server.await;
    settings.selections.active_embedding = None;
    import(&repo, settings).await.unwrap();
    assert!(
        !crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .enabled
    );
    assert!(!reconcile_embedding_activation(&repo).await.unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM search_index_generations")
            .fetch_one(&repo.pool)
            .await
            .unwrap(),
        0
    );
}
#[tokio::test]
async fn same_provider_connections_merge_validate_and_keep_credentials_host_only() {
    let (_root, service) = repository().await;
    let repo = service.history.clone();
    let first = connection(AiProviderKind::Openai, "Personal");
    let second = connection(AiProviderKind::Openai, "Work");
    import(&repo, document(vec![first.clone(), second.clone()]))
        .await
        .unwrap();
    set_credential(&repo, &first.id, Some("private-test-key".into()))
        .await
        .unwrap();
    let exported = export(&repo).await.unwrap();
    let serialized = serde_json::to_string(&exported).unwrap();
    assert!(!serialized.contains("private-test-key"));
    assert!(!serialized.contains("credential"));
    let snapshot = state(&repo).await.unwrap();
    assert!(
        snapshot
            .connection_states
            .iter()
            .find(|v| v.connection_id == first.id)
            .unwrap()
            .credential_configured
    );
    assert!(
        !snapshot
            .connection_states
            .iter()
            .find(|v| v.connection_id == second.id)
            .unwrap()
            .credential_configured
    );
    let mut edited = first.clone();
    edited.name = "Renamed".into();
    import(&repo, document(vec![edited])).await.unwrap();
    assert_eq!(export(&repo).await.unwrap().connections.len(), 2);
    assert_eq!(
        credentials::get(&repo, &first.id).await.unwrap().as_deref(),
        Some("private-test-key")
    );
    let before = serde_json::to_string(&export(&repo).await.unwrap()).unwrap();
    let mut bad = second.clone();
    bad.base_url = "http://remote.example/v1".into();
    assert!(import(&repo, document(vec![bad])).await.is_err());
    assert_eq!(
        serde_json::to_string(&export(&repo).await.unwrap()).unwrap(),
        before
    );
    let mut raw = serde_json::to_value(&first).unwrap();
    raw["headers"] = serde_json::json!({"Authorization":"secret"});
    assert!(serde_json::from_value::<AiConnection>(raw).is_err());
    let mut raw = serde_json::to_value(&first).unwrap();
    raw["credential"] = serde_json::json!("secret");
    assert!(serde_json::from_value::<AiConnection>(raw).is_err());
    set_credential(&repo, &first.id, None).await.unwrap();
    assert!(credentials::get(&repo, &first.id).await.unwrap().is_none());
}
#[tokio::test]
async fn legacy_assignments_migrate_once_without_changing_existing_index_configuration() {
    let (_root, service) = repository().await;
    let repo = service.history.clone();
    let original=serde_json::json!({"providerId":"builtin.embedding.ollama","model":"embedding-model","enabled":true,"minimumSimilarityPercent":63}).to_string();
    for (key,value) in [("providers.ollama.connection",serde_json::json!({"providerId":"builtin.model_provider.ollama","endpoint":"http://127.0.0.1:11434"}).to_string()),("providers.text_embedding.active",original.clone()),("providers.generation.text.active",serde_json::json!({"providerId":"builtin.generation.ollama","model":"chat-model","enabled":true}).to_string())] {
        sqlx::query("UPDATE config_device_values SET value_json=?,updated_at=? WHERE key=?").bind(value).bind(now_ms()).bind(key).execute(&repo.pool).await.unwrap();
    }
    migrate_legacy(&repo).await.unwrap();
    let first = export(&repo).await.unwrap();
    migrate_legacy(&repo).await.unwrap();
    let second = export(&repo).await.unwrap();
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&second).unwrap()
    );
    assert_eq!(first.connections.len(), 1);
    assert_eq!(first.presets.len(), 2);
    assert!(first.selections.default_chat.is_some());
    assert!(first.selections.active_embedding.is_some());
    assert_eq!(
        first.selections.extension_generation,
        first.selections.default_chat
    );
    let retained: String = sqlx::query_scalar(
        "SELECT value_json FROM config_device_values WHERE key='providers.text_embedding.active'",
    )
    .fetch_one(&repo.pool)
    .await
    .unwrap();
    assert_eq!(retained, original);
}

#[tokio::test]
async fn feature_assignments_are_independent_and_old_imports_preserve_new_defaults() {
    let (_root, service) = repository().await;
    let repo = &service.history;
    let local = connection(AiProviderKind::Ollama, "Home");
    let hosted = connection(AiProviderKind::Openai, "Work");
    let preset = |connection: &AiConnection, purpose| AiModelPreset {
        id: new_id(),
        name: "Model".into(),
        connection_id: connection.id.clone(),
        model_id: "fixture".into(),
        purpose,
        context_limit: 32768,
        output_limit: 4096,
        options: default_options(),
        capabilities: unknown_capabilities(),
    };
    let chat = preset(&hosted, AiModelPurpose::Chat);
    let decision = preset(&local, AiModelPurpose::Decision);
    let mut config = document(vec![local, hosted]);
    config.version = 2;
    config.presets = vec![chat.clone(), decision.clone()];
    config.selections.extension_generation = Some(chat.id.clone());
    config.selections.default_decision = Some(decision.id.clone());
    import(repo, config.clone()).await.unwrap();
    let saved = export(repo).await.unwrap();
    assert_eq!(saved.version, 3);
    assert!(saved.selections.default_chat.is_none());
    let missing_credential = crate::providers::generation::resolve(repo)
        .await
        .err()
        .unwrap();
    assert_eq!(
        crate::failure::OperationFailure::from_error(&missing_credential).code,
        crate::failure::FailureCode::ProviderNotConfigured
    );
    credentials::set(
        repo,
        &chat.connection_id,
        Some("fixture-private-credential".into()),
    )
    .await
    .unwrap();
    let (active, provider) = crate::providers::generation::resolve(repo).await.unwrap();
    assert_eq!(active.model, chat.model_id);
    assert!(matches!(
        provider.capabilities().execution_location,
        crate::providers::contracts::generation::GenerationExecutionLocation::Remote
    ));
    let mut old = config.clone();
    old.version = 1;
    old.selections.extension_generation = None;
    old.selections.default_decision = None;
    import(repo, old).await.unwrap();
    assert_eq!(
        export(repo).await.unwrap().selections.extension_generation,
        Some(chat.id.clone())
    );
    config.selections.extension_generation = Some(decision.id);
    assert!(import(repo, config.clone()).await.is_err());
    config.selections.extension_generation = None;
    config.presets[1].connection_id = chat.connection_id;
    assert!(import(repo, config).await.is_err());
    assert_eq!(
        export(repo).await.unwrap().selections.extension_generation,
        Some(chat.id)
    );
    crate::providers::generation::disable(repo).await.unwrap();
    assert!(crate::providers::generation::resolve(repo).await.is_err());
    assert!(export(repo)
        .await
        .unwrap()
        .selections
        .default_decision
        .is_some());
}

#[tokio::test]
async fn openrouter_decision_and_rerank_presets_round_trip_without_enabling_execution() {
    let (_root, service) = repository().await;
    let repo = &service.history;
    let router = connection(AiProviderKind::Openrouter, "Router");
    let local = connection(AiProviderKind::Ollama, "Local");
    let make_preset = |purpose| AiModelPreset {
        id: new_id(),
        name: "Specialist".into(),
        connection_id: router.id.clone(),
        model_id: "provider/specialist".into(),
        purpose,
        context_limit: 32768,
        output_limit: 4096,
        options: default_options(),
        capabilities: unknown_capabilities(),
    };
    let decision = make_preset(AiModelPurpose::Decision);
    let rerank = make_preset(AiModelPurpose::Rerank);
    let mut config = document(vec![router, local.clone()]);
    config.version = 3;
    config.presets = vec![decision.clone(), rerank.clone()];
    config.selections.default_decision = Some(decision.id.clone());
    config.selections.active_rerank = Some(rerank.id.clone());
    import(repo, config.clone()).await.unwrap();
    let saved = export(repo).await.unwrap();
    assert_eq!(saved.selections.default_decision, Some(decision.id));
    assert_eq!(saved.selections.active_rerank, Some(rerank.id.clone()));

    let mut legacy = saved.clone();
    legacy.version = 2;
    legacy.selections.active_rerank = None;
    import(repo, legacy).await.unwrap();
    assert_eq!(
        export(repo).await.unwrap().selections.active_rerank,
        Some(rerank.id)
    );

    config.presets[1].connection_id = local.id;
    assert!(import(repo, config).await.is_err());
}

#[tokio::test]
async fn existing_registry_backfills_generation_once_and_keeps_disabled_assignments_disabled() {
    let (_root, service) = repository().await;
    let repo = &service.history;
    let connection = connection(AiProviderKind::Ollama, "Home");
    let mut config = document(vec![connection.clone()]);
    let preset = AiModelPreset {
        id: new_id(),
        name: "Legacy chat".into(),
        connection_id: connection.id.clone(),
        model_id: "fixture".into(),
        purpose: AiModelPurpose::Chat,
        context_limit: 32768,
        output_limit: 4096,
        options: default_options(),
        capabilities: unknown_capabilities(),
    };
    config.presets.push(preset.clone());
    import(repo, config).await.unwrap();
    sqlx::query("DELETE FROM ai_selections WHERE selection_key='extension_generation'")
        .execute(&repo.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE ai_selections SET selected_id=? WHERE selection_key='legacy_migrated'")
        .bind(
            serde_json::json!({"connectionId":connection.id,"generationPresetId":preset.id})
                .to_string(),
        )
        .execute(&repo.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE config_device_values SET value_json=? WHERE key='providers.generation.text.active'").bind(serde_json::json!({"providerId":"builtin.generation.ollama","model":"fixture","enabled":false}).to_string()).execute(&repo.pool).await.unwrap();
    assert!(export(repo)
        .await
        .unwrap()
        .selections
        .extension_generation
        .is_none());
    sqlx::query("UPDATE config_device_values SET value_json=? WHERE key='providers.generation.text.active'").bind(serde_json::json!({"providerId":"builtin.generation.ollama","model":"fixture","enabled":true}).to_string()).execute(&repo.pool).await.unwrap();
    assert!(export(repo)
        .await
        .unwrap()
        .selections
        .extension_generation
        .is_none());
}
#[tokio::test]
async fn hosted_indexing_requires_enablement_and_import_is_validated_before_writes() {
    let (_root, service) = repository().await;
    let repo = service.history.clone();
    let connection = connection(AiProviderKind::Openai, "Hosted");
    let mut options = default_options();
    options.embedding = Some(EmbeddingPresetOptions {
        dimensions: Some(1536),
        task_policy: "symmetric".into(),
        hosted_indexing_enabled: false,
    });
    let preset = AiModelPreset {
        id: new_id(),
        name: "Embeddings".into(),
        connection_id: connection.id.clone(),
        model_id: "text-embedding-3-small".into(),
        purpose: AiModelPurpose::Embedding,
        context_limit: 32768,
        output_limit: 4096,
        options,
        capabilities: unknown_capabilities(),
    };
    let mut settings = document(vec![connection.clone()]);
    settings.presets.push(preset.clone());
    import(&repo, settings.clone()).await.unwrap();
    settings.selections.active_embedding = Some(preset.id.clone());
    // Preview is pure validation: no hosted probe, activation, or configuration write.
    let before = export(&repo).await.unwrap();
    let preview = merge(&before, settings.clone()).unwrap();
    assert_eq!(preview.selections.active_embedding, Some(preset.id.clone()));
    assert_eq!(
        serde_json::to_value(export(&repo).await.unwrap()).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    assert!(import(&repo, settings)
        .await
        .unwrap_err()
        .to_string()
        .contains("hosted_indexing_disabled"));
    assert!(export(&repo)
        .await
        .unwrap()
        .selections
        .active_embedding
        .is_none());
    assert!(embedding_provider_for(&repo, &connection, &preset, None)
        .await
        .is_err());
    let mut invalid = document(vec![connection]);
    invalid.presets.push(preset);
    invalid.presets[0]
        .options
        .embedding
        .as_mut()
        .unwrap()
        .task_policy = "unspecified".into();
    assert!(import(&repo, invalid).await.is_err());
}
#[cfg(target_os = "windows")]
#[tokio::test]
async fn windows_ai_credential_file_is_protected_and_tamper_is_rejected() {
    let (_root, service) = repository().await;
    let repo = service.history.clone();
    let id = new_id();
    credentials::set(&repo, &id, Some("test-secret-never-plaintext".into()))
        .await
        .unwrap();
    let path = repo
        .managed_root
        .parent()
        .unwrap()
        .join("ai-credentials")
        .join(format!("{id}.dpapi"));
    let mut bytes = std::fs::read(&path).unwrap();
    assert!(!bytes
        .windows(25)
        .any(|v| v == b"test-secret-never-plaintext"));
    let middle = bytes.len() / 2;
    bytes[middle] ^= 1;
    std::fs::write(&path, bytes).unwrap();
    assert!(credentials::get(&repo, &id).await.is_err());
}

#[tokio::test]
async fn configuration_v3_auto_and_legacy_explicit_limits_round_trip() {
    let (_root, service) = repository().await;
    let c = connection(AiProviderKind::Ollama, "Local");
    let mut config = document(vec![c.clone()]);
    config.presets.push(AiModelPreset {
        id: new_id(),
        name: "Saved".into(),
        connection_id: c.id,
        model_id: "custom".into(),
        purpose: AiModelPurpose::Chat,
        context_limit: 16384,
        output_limit: 3072,
        options: default_options(),
        capabilities: unknown_capabilities(),
    });
    for version in [1, 2] {
        config.version = version;
        import(&service.history, config.clone()).await.unwrap();
        let saved = export(&service.history).await.unwrap();
        assert_eq!(saved.presets[0].context_limit, 16384);
        assert_eq!(saved.presets[0].output_limit, 3072);
        assert!(saved.presets[0].options.limit_policy.is_none());
    }
    config.presets[0].options.limit_policy = Some(AiLimitPolicy::Auto);
    assert!(import(&service.history, config.clone()).await.is_err());
    config.version = 3;
    import(&service.history, config).await.unwrap();
    let saved = export(&service.history).await.unwrap();
    assert_eq!(saved.version, 3);
    assert!(matches!(
        saved.presets[0].options.limit_policy,
        Some(AiLimitPolicy::Auto)
    ));
    assert_eq!(saved.presets[0].output_limit, 3072);
}
