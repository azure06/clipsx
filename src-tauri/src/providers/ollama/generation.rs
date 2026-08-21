use super::client::OllamaClient;
use crate::providers::{
    contracts::{generation::GenerationProvider, ProviderDescriptor},
    error::{ProviderError, ProviderResult},
};
use async_trait::async_trait;
use std::time::Duration;

const PROVIDER_ID: &str = "builtin.generation.ollama";
const PROVIDER_VERSION: &str = "1";
const MAX_PROMPT_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

pub struct OllamaGenerationProvider {
    client: OllamaClient,
    model: String,
}

impl OllamaGenerationProvider {
    pub fn new(endpoint: &str, model: String) -> ProviderResult<Self> {
        if model.trim().is_empty() || model.len() > 256 {
            return Err(ProviderError::InvalidConfiguration(
                "generation model is invalid".into(),
            ));
        }
        Ok(Self {
            client: OllamaClient::new(endpoint)?,
            model,
        })
    }
}

#[async_trait]
impl GenerationProvider for OllamaGenerationProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            provider_id: PROVIDER_ID.into(),
            provider_version: PROVIDER_VERSION.into(),
            model_id: self.model.clone(),
            model_revision: self.model.clone(),
        }
    }

    async fn generate(&self, prompt: &str) -> ProviderResult<String> {
        if prompt.is_empty() || prompt.len() > MAX_PROMPT_BYTES {
            return Err(ProviderError::InvalidConfiguration(format!(
                "generation prompt must be between 1 and {MAX_PROMPT_BYTES} bytes"
            )));
        }
        let response = self
            .client
            .post_bounded(
                "api/generate",
                serde_json::json!({
                    "model": self.model,
                    "prompt": prompt,
                    "stream": false,
                    "options": { "num_predict": 4096 }
                }),
                Duration::from_secs(120),
                MAX_OUTPUT_BYTES,
            )
            .await?;
        let output = response["response"]
            .as_str()
            .ok_or_else(|| ProviderError::InvalidOutput("Ollama response has no text".into()))?;
        if output.len() > MAX_OUTPUT_BYTES {
            return Err(ProviderError::InvalidOutput(
                "Ollama generation output exceeds 2 MiB".into(),
            ));
        }
        Ok(output.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_models_before_network_access() {
        assert!(OllamaGenerationProvider::new("http://localhost:11434", "".into()).is_err());
    }
}
