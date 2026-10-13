use super::client::OllamaClient;
use crate::providers::{
    contracts::{
        text_embedding::{
            TextEmbeddingProvider, TextEmbeddingSpace, MAX_BATCH_INPUTS, MAX_INPUT_BYTES,
        },
        ProviderDescriptor,
    },
    error::{ProviderError, ProviderResult},
};
use async_trait::async_trait;
use std::time::Duration;

const PROVIDER_ID: &str = "builtin.embedding.ollama";
const PROVIDER_VERSION: &str = "1";

pub struct OllamaTextEmbeddingProvider {
    client: OllamaClient,
    model: String,
    expected_revision: std::sync::Mutex<Option<String>>,
}

impl OllamaTextEmbeddingProvider {
    pub fn new(endpoint: &str, model: String) -> ProviderResult<Self> {
        Ok(Self {
            client: OllamaClient::new(endpoint)?,
            model,
            expected_revision: std::sync::Mutex::new(None),
        })
    }

    async fn embeddings(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        let mut vectors = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(MAX_BATCH_INPUTS) {
            self.check_revision().await?;
            if let Some(input) = batch.iter().find(|value| value.len() > MAX_INPUT_BYTES) {
                return Err(ProviderError::InvalidConfiguration(format!(
                    "embedding input exceeds {MAX_INPUT_BYTES} bytes ({} bytes)",
                    input.len()
                )));
            }
            let response = self
                .client
                .post(
                    "api/embed",
                    serde_json::json!({"model": self.model, "input": batch, "truncate": false}),
                    Duration::from_secs(60),
                )
                .await?;
            vectors.extend(parse_vectors(&response, batch.len())?);
            // Discard the entire result if a mutable tag changed while the request ran.
            self.check_revision().await?;
        }
        Ok(vectors)
    }

    async fn check_revision(&self) -> ProviderResult<()> {
        let expected = self.expected_revision.lock().unwrap().clone();
        if let Some(expected) = expected {
            let actual =
                super::models::model_revision(self.client.endpoint().as_str(), &self.model).await?;
            if actual != expected {
                return Err(ProviderError::EmbeddingSpaceChanged);
            }
        }
        Ok(())
    }
}

#[async_trait]
impl TextEmbeddingProvider for OllamaTextEmbeddingProvider {
    async fn describe(&self) -> ProviderResult<TextEmbeddingSpace> {
        let selected =
            super::models::inspect_model(self.client.endpoint().as_str(), &self.model).await?;
        if !selected.supports(crate::providers::model_catalog::ModelCapability::TextEmbedding) {
            return Err(ProviderError::InvalidConfiguration(format!(
                "{} does not support text embeddings",
                self.model
            )));
        }
        let revision = selected.digest.clone().ok_or_else(|| {
            ProviderError::InvalidDescriptor("Ollama did not report a model revision".into())
        })?;
        *self.expected_revision.lock().unwrap() = Some(revision.clone());
        let vectors = self
            .embed_queries(&["clipsx embedding capability probe".into()])
            .await?;
        let vector = vectors
            .first()
            .ok_or_else(|| ProviderError::InvalidOutput("missing probe embedding".into()))?;
        validate_vector(vector, None)?;
        Ok(TextEmbeddingSpace {
            provider: ProviderDescriptor {
                provider_id: PROVIDER_ID.into(),
                provider_version: PROVIDER_VERSION.into(),
                model_id: self.model.clone(),
                model_revision: revision,
            },
            dimensions: vector.len(),
            normalization: "l2".into(),
            distance_metric: "cosine".into(),
        })
    }

    async fn verify_space(&self, expected: &TextEmbeddingSpace) -> ProviderResult<()> {
        if expected.provider.provider_id != PROVIDER_ID
            || expected.provider.provider_version != PROVIDER_VERSION
            || expected.provider.model_id != self.model
            || expected.normalization != "l2"
            || expected.distance_metric != "cosine"
        {
            return Err(ProviderError::EmbeddingSpaceChanged);
        }
        *self.expected_revision.lock().unwrap() = Some(expected.provider.model_revision.clone());
        self.check_revision().await
    }

    async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        self.embeddings(inputs).await
    }

    async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        self.embeddings(inputs).await
    }
}

fn parse_vectors(value: &serde_json::Value, expected: usize) -> ProviderResult<Vec<Vec<f32>>> {
    let vectors = value["embeddings"]
        .as_array()
        .ok_or_else(|| ProviderError::InvalidOutput("Ollama response has no embeddings".into()))?;
    if vectors.len() != expected {
        return Err(ProviderError::InvalidOutput(
            "Ollama returned the wrong vector count".into(),
        ));
    }
    vectors
        .iter()
        .map(|vector| {
            let values = vector
                .as_array()
                .ok_or_else(|| ProviderError::InvalidOutput("invalid embedding".into()))?;
            let vector = values
                .iter()
                .map(|value| {
                    value.as_f64().map(|value| value as f32).ok_or_else(|| {
                        ProviderError::InvalidOutput("invalid embedding value".into())
                    })
                })
                .collect::<ProviderResult<Vec<_>>>()?;
            validate_vector(&vector, None)?;
            Ok(vector)
        })
        .collect()
}

fn validate_vector(vector: &[f32], dimensions: Option<usize>) -> ProviderResult<()> {
    if vector.is_empty()
        || dimensions.is_some_and(|expected| expected != vector.len())
        || vector.iter().any(|value| !value.is_finite())
    {
        return Err(ProviderError::InvalidOutput(
            "invalid embedding dimensions or values".into(),
        ));
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if !(0.98..=1.02).contains(&norm) {
        return Err(ProviderError::InvalidOutput(
            "embedding vector is not L2 normalized".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mutable_tags_are_checked_before_and_after_embeddings() {
        use axum::{
            routing::{get, post},
            Router,
        };
        use std::sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        };
        let revision = Arc::new(AtomicUsize::new(1));
        let calls = Arc::new(AtomicUsize::new(0));
        let replace_during_request = Arc::new(AtomicBool::new(false));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route("/api/tags", get({ let revision = revision.clone(); move || { let revision = revision.clone(); async move { serde_json::json!({"models":[{"name":"fixture","digest":format!("revision-{}",revision.load(Ordering::SeqCst))}]}).to_string() } } }))
            .route("/api/show", post(|| async { serde_json::json!({"capabilities":["embedding"]}).to_string() }))
            .route("/api/embed", post({ let revision = revision.clone(); let calls = calls.clone(); let replace = replace_during_request.clone(); move || { let revision = revision.clone(); let calls = calls.clone(); let replace = replace.clone(); async move { calls.fetch_add(1,Ordering::SeqCst); if replace.load(Ordering::SeqCst) { revision.fetch_add(1,Ordering::SeqCst); } serde_json::json!({"embeddings":[[1.,0.]]}).to_string() } } }));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let provider = OllamaTextEmbeddingProvider::new(&endpoint, "fixture".into()).unwrap();
        let original = provider.describe().await.unwrap();
        provider.verify_space(&original).await.unwrap();
        provider
            .embed_queries(&["ordinary text".into()])
            .await
            .unwrap();
        let before = calls.load(Ordering::SeqCst);
        revision.store(2, Ordering::SeqCst);
        assert!(matches!(
            provider.embed_documents(&["another text".into()]).await,
            Err(ProviderError::EmbeddingSpaceChanged)
        ));
        assert_eq!(calls.load(Ordering::SeqCst), before);
        let replacement = provider.describe().await.unwrap();
        assert_ne!(
            original.provider.model_revision,
            replacement.provider.model_revision
        );
        assert_eq!(original.dimensions, replacement.dimensions);
        replace_during_request.store(true, Ordering::SeqCst);
        assert!(matches!(
            provider.embed_queries(&["during replacement".into()]).await,
            Err(ProviderError::EmbeddingSpaceChanged)
        ));
        server.abort();
    }

    #[test]
    fn typed_context_overflow_is_provider_owned() {
        let error = ProviderError::Rejected {
            operation: "/api/embed".into(),
            status: 400,
            detail: Some("input length exceeds the context length".into()),
            context_overflow: true,
        };
        assert!(error.is_context_overflow());
        assert_eq!(error.code(), "context_overflow");
    }
}
