use super::*;

async fn fixture() -> (tempfile::TempDir, HistoryRepository, AiConfiguration) {
    let (root, service) = crate::recall::service_tests::repository().await;
    let repo = service.history;
    migrate_legacy(&repo).await.unwrap();
    let connection = AiConnection {
        id: new_id(),
        name: "Removal fixture".into(),
        provider: AiProviderKind::Openrouter,
        base_url: "https://openrouter.ai/api/v1".into(),
        enabled: true,
        options: AiConnectionOptions {
            organization: None,
            project: None,
        },
    };
    let other = AiConnection {
        id: new_id(),
        name: "Unrelated".into(),
        ..connection.clone()
    };
    let mut presets = Vec::new();
    for purpose in [
        AiModelPurpose::Chat,
        AiModelPurpose::Embedding,
        AiModelPurpose::Decision,
        AiModelPurpose::Rerank,
    ] {
        let mut options = default_options();
        if purpose == AiModelPurpose::Embedding {
            options.embedding = Some(EmbeddingPresetOptions {
                dimensions: None,
                task_policy: "symmetric".into(),
                hosted_indexing_enabled: true,
            });
        }
        presets.push(AiModelPreset {
            id: new_id(),
            name: "Fixture".into(),
            connection_id: connection.id.clone(),
            model_id: "fixture/model".into(),
            purpose,
            context_limit: 32768,
            output_limit: 4096,
            options,
            capabilities: unknown_capabilities(),
        });
    }
    let document = AiConfiguration {
        version: 3,
        connections: vec![connection, other],
        selections: AiSelections {
            default_chat: Some(presets[0].id.clone()),
            extension_generation: Some(presets[0].id.clone()),
            active_embedding: Some(presets[1].id.clone()),
            default_decision: Some(presets[2].id.clone()),
            active_rerank: Some(presets[3].id.clone()),
            web_search: None,
        },
        presets,
    };
    validate(&document).unwrap();
    let mut tx = repo.pool.begin().await.unwrap();
    persist(&mut tx, &document).await.unwrap();
    let config = providers::TextEmbeddingProviderConfig {
        provider_id: format!("ai-preset:{}", document.presets[1].id),
        model: "fixture/model".into(),
        enabled: true,
        minimum_similarity_percent: None,
    };
    sqlx::query("INSERT INTO config_device_values(key,value_json,updated_at) VALUES('providers.text_embedding.active',?,1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").bind(serde_json::to_string(&config).unwrap()).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    (root, repo, document)
}

#[tokio::test]
async fn removing_default_preset_clears_assignments_and_chat_links_without_deleting_data() {
    let (_root, repo, document) = fixture().await;
    let chat = &document.presets[0].id;
    credentials::set(
        &repo,
        &document.connections[0].id,
        Some("fixture-secret".into()),
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO recall_threads(id,local_id,title,preset_id,reasoning_json,created_at,updated_at) VALUES('thread','local','Saved',?,'{\"kind\":\"effort\",\"value\":\"low\"}',1,1)").bind(chat).execute(&repo.pool).await.unwrap();
    sqlx::query("INSERT INTO recall_messages(thread_id,id,role,content_json,metadata_json,created_at,updated_at) VALUES('thread','message','assistant','[]','{\"model\":\"original-model\"}',1,1)").execute(&repo.pool).await.unwrap();
    sqlx::query("INSERT INTO clip_items(id,note,captured_at,updated_at,lifecycle_state) VALUES('kept','Saved clip',1,1,'ready')").execute(&repo.pool).await.unwrap();
    let result = remove(&repo, None, Some(chat.clone())).await.unwrap();
    assert!(result.configuration.selections.default_chat.is_none());
    assert!(result
        .configuration
        .selections
        .extension_generation
        .is_none());
    assert_eq!(
        result.configuration.selections.active_embedding,
        document.selections.active_embedding
    );
    assert_eq!(result.configuration.connections.len(), 2);
    assert_eq!(
        credentials::get(&repo, &document.connections[0].id)
            .await
            .unwrap()
            .as_deref(),
        Some("fixture-secret")
    );
    let links: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT preset_id,reasoning_json FROM recall_threads WHERE id='thread'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(links, (None, None));
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT metadata_json FROM recall_messages WHERE id='message'"
        )
        .fetch_one(&repo.pool)
        .await
        .unwrap(),
        "{\"model\":\"original-model\"}"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT note FROM clip_items WHERE id='kept'")
            .fetch_one(&repo.pool)
            .await
            .unwrap(),
        "Saved clip"
    );
    assert!(
        crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .enabled
    );
}

#[tokio::test]
async fn removing_provider_clears_all_its_assignments_and_disables_embeddings() {
    let (_root, repo, document) = fixture().await;
    let id = &document.connections[0].id;
    credentials::set(&repo, id, Some("fixture-secret".into()))
        .await
        .unwrap();
    let result = remove(&repo, Some(id.clone()), None).await.unwrap();
    assert_eq!(result.configuration.connections.len(), 1);
    assert_eq!(
        result.configuration.connections[0].id,
        document.connections[1].id
    );
    assert!(result.configuration.presets.is_empty());
    assert_eq!(
        serde_json::to_value(result.configuration.selections).unwrap(),
        serde_json::to_value(AiSelections::default()).unwrap()
    );
    assert!(
        !crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .enabled
    );
    assert!(credentials::get(&repo, id).await.unwrap().is_none());
    assert_eq!(result.pending_credential_removals, Some(0));
    migrate_legacy(&repo).await.unwrap();
    assert_eq!(export(&repo).await.unwrap().connections.len(), 1);
}

#[tokio::test]
async fn removing_unused_preset_preserves_every_feature_assignment() {
    let (_root, repo, mut document) = fixture().await;
    let unused = AiModelPreset {
        id: new_id(),
        name: "Unused".into(),
        ..document.presets[0].clone()
    };
    document.presets.push(unused.clone());
    import(&repo, document.clone()).await.unwrap();
    let result = remove(&repo, None, Some(unused.id)).await.unwrap();
    assert_eq!(
        serde_json::to_value(result.configuration.selections).unwrap(),
        serde_json::to_value(document.selections).unwrap()
    );
    assert_eq!(result.configuration.presets.len(), 4);
    assert!(
        crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .enabled
    );
}

#[tokio::test]
async fn removing_web_connection_clears_only_its_web_assignment() {
    let (_root, repo, mut document) = fixture().await;
    let web = AiConnection {
        id: new_id(),
        name: "Web".into(),
        provider: AiProviderKind::Tavily,
        base_url: "https://api.tavily.com".into(),
        ..document.connections[0].clone()
    };
    document.connections.push(web.clone());
    document.selections.web_search = Some(web.id.clone());
    import(&repo, document.clone()).await.unwrap();
    let result = remove(&repo, Some(web.id), None).await.unwrap();
    assert!(result.configuration.selections.web_search.is_none());
    assert_eq!(
        result.configuration.selections.default_chat,
        document.selections.default_chat
    );
    assert_eq!(
        result.configuration.selections.active_embedding,
        document.selections.active_embedding
    );
    assert_eq!(result.configuration.presets.len(), 4);
}

#[tokio::test]
async fn removal_rolls_back_configuration_assignments_and_cleanup_intents_on_database_failure() {
    let (_root, repo, document) = fixture().await;
    sqlx::query("CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON ai_connections BEGIN SELECT RAISE(ABORT,'fixture'); END").execute(&repo.pool).await.unwrap();
    assert!(
        remove(&repo, Some(document.connections[0].id.clone()), None)
            .await
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(export(&repo).await.unwrap()).unwrap(),
        serde_json::to_value(document).unwrap()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ai_credential_cleanup")
            .fetch_one(&repo.pool)
            .await
            .unwrap(),
        0
    );
    assert!(
        crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .enabled
    );
    assert!(remove(&repo, None, None).await.is_err());
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn credential_cleanup_survives_restart_and_blocks_id_reuse_until_complete() {
    let (root, repo, document) = fixture().await;
    let id = &document.connections[0].id;
    let path = root
        .path()
        .join("data/ai-credentials")
        .join(format!("{id}.dpapi"));
    std::fs::create_dir_all(&path).unwrap();
    let removed = remove(&repo, Some(id.clone()), None).await.unwrap();
    assert_eq!(removed.pending_credential_removals, Some(1));
    assert!(import(&repo, document.clone()).await.is_err());
    repo.pool.close().await;
    let reopened = HistoryRepository::connect(
        &root.path().join("data/clips.db"),
        root.path().join("data/clipboard_data"),
    )
    .await
    .unwrap();
    std::fs::remove_dir(&path).unwrap();
    let result = retry_credential_cleanup(&reopened).await.unwrap();
    assert_eq!(result.pending_credential_removals, Some(0));
    assert_eq!(result.configuration.connections.len(), 1);
    let mut reimport = document.clone();
    reimport.selections.active_embedding = None;
    import(&reopened, reimport).await.unwrap();
    set_credential(&reopened, id, Some("replacement-credential".into()))
        .await
        .unwrap();
    reconcile_embedding_activation(&reopened).await.unwrap();
    assert_eq!(
        credentials::get(&reopened, id).await.unwrap().as_deref(),
        Some("replacement-credential")
    );
}
