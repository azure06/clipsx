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
        },
    }
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
    let retained: String = sqlx::query_scalar(
        "SELECT value_json FROM config_device_values WHERE key='providers.text_embedding.active'",
    )
    .fetch_one(&repo.pool)
    .await
    .unwrap();
    assert_eq!(retained, original);
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
