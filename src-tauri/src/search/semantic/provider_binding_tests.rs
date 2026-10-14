use super::*;
use crate::ai::{configuration, contracts::*};
use axum::{
    body::Bytes,
    routing::{get, post},
    Router,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct Fixture {
    endpoint: String,
    calls: Arc<AtomicUsize>,
    revision: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn fixture(label: &'static str, vector: [f32; 2]) -> Fixture {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let revision = Arc::new(AtomicUsize::new(0));
    let router = Router::new()
        .route("/api/tags", get({
            let revision = revision.clone();
            move || { let revision = revision.clone(); async move {
                serde_json::json!({"models":[{"name":"fixture", "digest":format!("{label}-{}", revision.load(Ordering::SeqCst))}]}).to_string()
            }}
        }))
        .route("/api/show", post(|| async { serde_json::json!({"capabilities":["embedding"]}).to_string() }))
        .route("/api/embed", post({
            let calls = calls.clone();
            move |bytes: Bytes| { let calls = calls.clone(); async move {
                let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                calls.fetch_add(1, Ordering::SeqCst);
                let count = body["input"].as_array().unwrap().len();
                serde_json::json!({"embeddings":vec![vector; count]}).to_string()
            }}
        }));
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Fixture {
        endpoint,
        calls,
        revision,
        task,
    }
}
fn configuration_for(fixtures: &[&Fixture]) -> AiConfiguration {
    let mut document = AiConfiguration {
        version: 3,
        connections: vec![],
        presets: vec![],
        selections: AiSelections::default(),
    };
    for fixture in fixtures {
        let connection = AiConnection {
            id: new_id(),
            name: "Fixture".into(),
            provider: AiProviderKind::Ollama,
            base_url: fixture.endpoint.clone(),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        document.presets.push(AiModelPreset {
            id: new_id(),
            name: "Fixture".into(),
            connection_id: connection.id.clone(),
            model_id: "fixture".into(),
            purpose: AiModelPurpose::Embedding,
            context_limit: 32768,
            output_limit: 4096,
            options: AiPresetOptions {
                embedding: Some(EmbeddingPresetOptions {
                    dimensions: None,
                    task_policy: "symmetric".into(),
                    hosted_indexing_enabled: false,
                }),
                ..configuration::default_options()
            },
            capabilities: configuration::unknown_capabilities(),
        });
        document.connections.push(connection);
    }
    document
}
async fn activate(repo: &HistoryRepository, preset: &AiModelPreset) {
    let config = TextEmbeddingProviderConfig {
        provider_id: format!("ai-preset:{}", preset.id),
        model: preset.model_id.clone(),
        enabled: true,
        minimum_similarity_percent: None,
    };
    let provider = crate::ai::embedding::resolve_embedding(repo, &config, None)
        .await
        .unwrap();
    configure_descriptor(repo, config, provider.describe().await.unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn provider_switch_keeps_retained_binding_across_restart_and_isolates_failures() {
    let (_root, mut repo) = tests::repository().await;
    let old = fixture("old", [1., 0.]).await;
    let new = fixture("new", [0., 1.]).await;
    let mut document = configuration_for(&[&old, &new]);
    configuration::import(&repo, document.clone())
        .await
        .unwrap();
    let clip = tests::insert_text_clip(&repo, "retained clipboard evidence").await;
    activate(&repo, &document.presets[0]).await;
    assert_eq!(index_pending(&repo).await.unwrap(), 1);
    let original = generation_by_status(&repo, "active")
        .await
        .unwrap()
        .unwrap();
    // Simulate a schema-27 space; switching must retain its old route before replacing selection.
    sqlx::query("UPDATE search_embedding_spaces SET provider_binding_json=NULL")
        .execute(&repo.pool)
        .await
        .unwrap();
    activate(&repo, &document.presets[1]).await;
    let saved: String =
        sqlx::query_scalar("SELECT provider_binding_json FROM search_embedding_spaces WHERE id=?")
            .bind(&original.space_id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert!(saved.contains(&document.presets[0].id));
    repo.pool = sqlx::SqlitePool::connect_with(repo.pool.connect_options().as_ref().clone())
        .await
        .unwrap();
    let eligible = HashMap::from([(clip.clone(), 1)]);
    let before_old = old.calls.load(Ordering::SeqCst);
    let before_new = new.calls.load(Ordering::SeqCst);
    let matches = semantic_matches(&repo, "retained evidence", &eligible, 10)
        .await
        .unwrap();
    assert_eq!(matches[0].0, clip);
    assert!(matches[0].1 > 0.99);
    assert!(old.calls.load(Ordering::SeqCst) > before_old);
    assert_eq!(new.calls.load(Ordering::SeqCst), before_new);

    document.connections[0].base_url = new.endpoint.clone();
    configuration::import(&repo, document.clone())
        .await
        .unwrap();
    assert!(semantic_matches(&repo, "retained evidence", &eligible, 10)
        .await
        .is_err());
    assert_eq!(new.calls.load(Ordering::SeqCst), before_new);
    assert!(status(&repo).await.unwrap().diagnostic.is_none());
    document.connections[0].base_url = old.endpoint.clone();
    configuration::import(&repo, document).await.unwrap();
    old.revision.store(1, Ordering::SeqCst);
    let error = semantic_matches(&repo, "retained evidence", &eligible, 10)
        .await
        .unwrap_err();
    assert_eq!(
        crate::failure::OperationFailure::from_error(&error).code,
        crate::failure::FailureCode::EmbeddingSpaceChanged
    );
    assert!(status(&repo).await.unwrap().diagnostic.is_none());
    assert_eq!(index_pending(&repo).await.unwrap(), 1);
    let current = status(&repo).await.unwrap();
    assert!(matches!(current.phase, ProviderPhase::Ready));
    assert!(current.diagnostic.is_none());
    let before_old = old.calls.load(Ordering::SeqCst);
    assert!(
        semantic_matches(&repo, "replacement evidence", &eligible, 10)
            .await
            .unwrap()[0]
            .1
            > 0.99
    );
    assert_eq!(old.calls.load(Ordering::SeqCst), before_old);
}

#[tokio::test]
async fn legacy_binding_is_saved_only_after_matching_the_full_descriptor() {
    let (_root, repo) = tests::repository().await;
    let server = fixture("original", [1., 0.]).await;
    let document = configuration_for(&[&server]);
    configuration::import(&repo, document.clone())
        .await
        .unwrap();
    activate(&repo, &document.presets[0]).await;
    index_pending(&repo).await.unwrap();
    sqlx::query("UPDATE search_embedding_spaces SET provider_binding_json=NULL")
        .execute(&repo.pool)
        .await
        .unwrap();
    server.revision.store(1, Ordering::SeqCst);
    assert!(semantic_matches(&repo, "evidence", &HashMap::new(), 10)
        .await
        .is_err());
    let binding: Option<String> =
        sqlx::query_scalar("SELECT provider_binding_json FROM search_embedding_spaces")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert!(binding.is_none());
    server.revision.store(0, Ordering::SeqCst);
    semantic_matches(&repo, "evidence", &HashMap::new(), 10)
        .await
        .unwrap();
    configuration::remove(&repo, None, Some(document.presets[0].id.clone()))
        .await
        .unwrap();
    assert!(semantic_matches(&repo, "evidence", &HashMap::new(), 10)
        .await
        .is_err());
}
