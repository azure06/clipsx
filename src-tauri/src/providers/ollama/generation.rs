use super::client::OllamaClient;
use crate::providers::{
    contracts::{
        generation::{
            GenerationCancellation, GenerationCapabilities, GenerationCompletionReason,
            GenerationExecutionLocation, GenerationProvider, GenerationRequest, GenerationResponse,
            GenerationRole,
        },
        ProviderDescriptor,
    },
    error::{ProviderError, ProviderResult},
};
use async_trait::async_trait;
use futures::StreamExt;
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

    fn capabilities(&self) -> GenerationCapabilities {
        GenerationCapabilities {
            streaming: true,
            execution_location: GenerationExecutionLocation::Local,
            // Ollama's effective context is runtime configuration. Keep prompt
            // planning conservative when the connection cannot report it.
            context_window_tokens: Some(4_096),
        }
    }

    async fn generate_stream(
        &self,
        request: &GenerationRequest,
        cancellation: &GenerationCancellation,
        on_delta: &(dyn Fn(String) -> ProviderResult<()> + Send + Sync),
    ) -> ProviderResult<GenerationResponse> {
        let prompt = request
            .messages
            .iter()
            .map(|message| {
                let role = match message.role {
                    GenerationRole::System => "System",
                    GenerationRole::User => "User",
                    GenerationRole::Assistant => "Assistant",
                };
                format!("{role}: {}", message.content)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        if prompt.is_empty() || prompt.len() > MAX_PROMPT_BYTES {
            return Err(ProviderError::InvalidConfiguration(format!(
                "generation prompt must be between 1 and {MAX_PROMPT_BYTES} bytes"
            )));
        }
        let response = self
            .client
            .post_stream(
                "api/generate",
                serde_json::json!({
                    "model": self.model,
                    "prompt": prompt,
                    "stream": true,
                    "options": { "num_predict": request.max_output_tokens }
                }),
                Duration::from_secs(120),
            )
            .await?;
        let mut stream = response.bytes_stream();
        let mut pending = Vec::new();
        let mut output = String::new();
        let mut completion_reason = GenerationCompletionReason::Stop;
        loop {
            let next = tokio::select! {
                _ = cancellation.cancelled() => return Err(ProviderError::Cancelled),
                value = stream.next() => value,
            };
            let Some(chunk) = next else { break };
            let chunk = chunk.map_err(|error| ProviderError::Unavailable(error.to_string()))?;
            if pending.len().saturating_add(chunk.len()) > MAX_OUTPUT_BYTES {
                return Err(ProviderError::InvalidOutput(
                    "Ollama generation stream exceeds 2 MiB".into(),
                ));
            }
            pending.extend_from_slice(&chunk);
            while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                let line = pending.drain(..=newline).collect::<Vec<_>>();
                let line = std::str::from_utf8(&line[..line.len() - 1])
                    .map_err(|error| ProviderError::InvalidOutput(error.to_string()))?;
                if line.trim().is_empty() {
                    continue;
                }
                let value: serde_json::Value = serde_json::from_str(line)
                    .map_err(|error| ProviderError::InvalidOutput(error.to_string()))?;
                let delta = value["response"].as_str().unwrap_or_default();
                if !delta.is_empty() {
                    if output.len().saturating_add(delta.len()) > MAX_OUTPUT_BYTES {
                        return Err(ProviderError::InvalidOutput(
                            "Ollama generation output exceeds 2 MiB".into(),
                        ));
                    }
                    output.push_str(delta);
                    on_delta(delta.to_owned())?;
                }
                if value["done"].as_bool() == Some(true) {
                    completion_reason = match value["done_reason"].as_str() {
                        Some("length") => GenerationCompletionReason::Length,
                        Some("stop") | None => GenerationCompletionReason::Stop,
                        Some(other) => GenerationCompletionReason::Other(other.to_owned()),
                    };
                }
            }
        }
        if !pending.iter().all(u8::is_ascii_whitespace) {
            let line = std::str::from_utf8(&pending)
                .map_err(|error| ProviderError::InvalidOutput(error.to_string()))?;
            let value: serde_json::Value = serde_json::from_str(line)
                .map_err(|error| ProviderError::InvalidOutput(error.to_string()))?;
            let delta = value["response"].as_str().unwrap_or_default();
            if output.len().saturating_add(delta.len()) > MAX_OUTPUT_BYTES {
                return Err(ProviderError::InvalidOutput(
                    "Ollama generation output exceeds 2 MiB".into(),
                ));
            }
            if !delta.is_empty() {
                output.push_str(delta);
                on_delta(delta.to_owned())?;
            }
        }
        if cancellation.is_cancelled() {
            return Err(ProviderError::Cancelled);
        }
        Ok(GenerationResponse {
            text: output,
            completion_reason,
        })
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
