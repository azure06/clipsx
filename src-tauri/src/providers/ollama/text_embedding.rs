use super::{client::OllamaClient, models::OllamaModelDescriptor, OllamaEndpointStatus};
use crate::providers::{
    contracts::{
        text_embedding::{TextEmbeddingProvider, TextEmbeddingSpace},
        ProviderDescriptor,
    },
    error::{ProviderError, ProviderResult},
};
use async_trait::async_trait;
use std::time::Duration;

const PROVIDER_ID: &str = "builtin.embedding.ollama";
const PROVIDER_VERSION: &str = "1";
const MAX_BATCH: usize = 16;
const MAX_INPUT_BYTES: usize = 2_048;

pub struct OllamaTextEmbeddingProvider {
    client: OllamaClient,
    model: String,
}

impl OllamaTextEmbeddingProvider {
    pub fn new(endpoint: &str, model: String) -> ProviderResult<Self> {
        Ok(Self {
            client: OllamaClient::new(endpoint)?,
            model,
        })
    }

    async fn embeddings(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        let mut vectors = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(MAX_BATCH) {
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
        }
        Ok(vectors)
    }
}

#[async_trait]
impl TextEmbeddingProvider for OllamaTextEmbeddingProvider {
    async fn describe(&self) -> ProviderResult<TextEmbeddingSpace> {
        let models = discover_models(&self.client).await?;
        let selected = models
            .iter()
            .find(|candidate| candidate.name == self.model)
            .ok_or_else(|| {
                ProviderError::InvalidConfiguration(format!(
                    "{} is not installed in Ollama",
                    self.model
                ))
            })?;
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
                model_revision: selected
                    .digest
                    .clone()
                    .unwrap_or_else(|| self.model.clone()),
            },
            dimensions: vector.len(),
            normalization: "l2".into(),
            distance_metric: "cosine".into(),
        })
    }

    async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        self.embeddings(inputs).await
    }

    async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        self.embeddings(inputs).await
    }
}

pub async fn probe_endpoint(endpoint: String) -> OllamaEndpointStatus {
    match OllamaClient::new(&endpoint) {
        Ok(client) => match discover_models(&client).await {
            Ok(_) => OllamaEndpointStatus {
                reachable: true,
                endpoint,
                diagnostic: None,
            },
            Err(error) => OllamaEndpointStatus {
                reachable: false,
                endpoint,
                diagnostic: Some(error.to_string()),
            },
        },
        Err(error) => OllamaEndpointStatus {
            reachable: false,
            endpoint,
            diagnostic: Some(error.to_string()),
        },
    }
}

pub async fn list_models(endpoint: String) -> ProviderResult<Vec<OllamaModelDescriptor>> {
    discover_models(&OllamaClient::new(&endpoint)?).await
}

pub async fn probe_model(endpoint: String, model: String) -> ProviderResult<TextEmbeddingSpace> {
    OllamaTextEmbeddingProvider::new(&endpoint, model)?
        .describe()
        .await
}

async fn discover_models(client: &OllamaClient) -> ProviderResult<Vec<OllamaModelDescriptor>> {
    let response = client.get("api/tags", Duration::from_secs(10)).await?;
    Ok(response["models"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|model| {
            Some(OllamaModelDescriptor {
                name: model["name"].as_str()?.to_string(),
                digest: model["digest"].as_str().map(str::to_string),
                size: model["size"].as_u64(),
            })
        })
        .collect())
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
