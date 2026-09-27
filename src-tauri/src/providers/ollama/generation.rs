use super::client::{response_failure, transport_error, OllamaClient};
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
        if prompt.is_empty() {
            return Err(ProviderError::InvalidOutput(
                "generation prompt is empty".into(),
            ));
        }
        if prompt.len() > MAX_PROMPT_BYTES {
            return Err(ProviderError::InputLimit);
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
        let mut decoder = GenerationDecoder::default();
        loop {
            let next = tokio::select! {
                _ = cancellation.cancelled() => return Err(ProviderError::Cancelled),
                value = stream.next() => value,
            };
            let Some(chunk) = next else { break };
            let chunk = chunk.map_err(transport_error)?;
            decoder.push(&chunk, on_delta)?;
        }
        if cancellation.is_cancelled() {
            return Err(ProviderError::Cancelled);
        }
        decoder.finish(on_delta)
    }
}

#[derive(Default)]
struct GenerationDecoder {
    pending: Vec<u8>,
    output: String,
    completion: Option<GenerationCompletionReason>,
}

impl GenerationDecoder {
    fn push(
        &mut self,
        chunk: &[u8],
        on_delta: &(dyn Fn(String) -> ProviderResult<()> + Send + Sync),
    ) -> ProviderResult<()> {
        if self.pending.len().saturating_add(chunk.len()) > MAX_OUTPUT_BYTES {
            return Err(ProviderError::InvalidOutput(
                "generation stream exceeds host limit".into(),
            ));
        }
        self.pending.extend_from_slice(chunk);
        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line = self.pending.drain(..=newline).collect::<Vec<_>>();
            self.frame(&line[..line.len() - 1], on_delta)?;
        }
        Ok(())
    }

    fn frame(
        &mut self,
        line: &[u8],
        on_delta: &(dyn Fn(String) -> ProviderResult<()> + Send + Sync),
    ) -> ProviderResult<()> {
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        let value: serde_json::Value = serde_json::from_slice(line)
            .map_err(|_| ProviderError::InvalidOutput("invalid generation frame".into()))?;
        if let Some(error) = value.get("error") {
            return Err(response_failure(0, "api/generate", error.as_str()));
        }
        if self.completion.is_some() {
            return Err(ProviderError::InvalidOutput(
                "generation frame after completion".into(),
            ));
        }
        let done = value
            .get("done")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| ProviderError::InvalidOutput("generation frame lacks status".into()))?;
        let delta = match value.get("response") {
            Some(serde_json::Value::String(delta)) => delta.as_str(),
            None if done => "",
            _ => {
                return Err(ProviderError::InvalidOutput(
                    "generation frame lacks text".into(),
                ))
            }
        };
        if self.output.len().saturating_add(delta.len()) > MAX_OUTPUT_BYTES {
            return Err(ProviderError::InvalidOutput(
                "generation output exceeds host limit".into(),
            ));
        }
        if !delta.is_empty() {
            self.output.push_str(delta);
            on_delta(delta.to_owned())?;
        }
        if done {
            self.completion = Some(match value["done_reason"].as_str() {
                Some("length") => GenerationCompletionReason::Length,
                Some("stop") | None => GenerationCompletionReason::Stop,
                Some(other) => GenerationCompletionReason::Other(other.to_owned()),
            });
        }
        Ok(())
    }

    fn finish(
        mut self,
        on_delta: &(dyn Fn(String) -> ProviderResult<()> + Send + Sync),
    ) -> ProviderResult<GenerationResponse> {
        let pending = std::mem::take(&mut self.pending);
        self.frame(&pending, on_delta)?;
        let completion_reason = self.completion.ok_or_else(|| {
            ProviderError::InvalidOutput("generation ended without completion".into())
        })?;
        Ok(GenerationResponse {
            text: self.output,
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

    #[tokio::test]
    async fn oversized_prompt_is_terminal_before_network_access() {
        let provider = OllamaGenerationProvider::new("http://127.0.0.1:1", "test".into()).unwrap();
        let error = provider
            .generate_stream(
                &GenerationRequest {
                    messages: vec![crate::providers::contracts::generation::GenerationMessage {
                        role: GenerationRole::User,
                        content: "x".repeat(MAX_PROMPT_BYTES),
                    }],
                    max_output_tokens: 100,
                },
                &GenerationCancellation::default(),
                &|_| Ok(()),
            )
            .await
            .unwrap_err();
        assert_eq!(error, ProviderError::InputLimit);
        assert_eq!(error.failure().recovery, crate::failure::Recovery::Stop);
    }

    #[test]
    fn final_frame_uses_same_completion_parser_and_preserves_length() {
        for newline in ["", "\n"] {
            let mut decoder = GenerationDecoder::default();
            decoder.push(format!("{{\"response\":\"hello\",\"done\":true,\"done_reason\":\"length\"}}{newline}").as_bytes(), &|_| Ok(())).unwrap();
            let response = decoder.finish(&|_| Ok(())).unwrap();
            assert_eq!(response.text, "hello");
            assert_eq!(
                response.completion_reason,
                GenerationCompletionReason::Length
            );
        }
    }

    #[test]
    fn rejects_errors_during_streaming_and_in_final_frame_without_exposing_content() {
        for newline in ["", "\n"] {
            let mut decoder = GenerationDecoder::default();
            decoder
                .push(b"{\"response\":\"partial\",\"done\":false}\n", &|_| Ok(()))
                .unwrap();
            let result = decoder.push(
                format!(
                    "{{\"error\":\"context length exceeded private clipboard secret\"}}{newline}"
                )
                .as_bytes(),
                &|_| Ok(()),
            );
            let error = match result {
                Err(error) => error,
                Ok(()) => decoder.finish(&|_| Ok(())).unwrap_err(),
            };
            assert!(error.is_context_overflow());
            assert!(!error.to_string().contains("secret"));
        }
    }

    #[test]
    fn partial_malformed_and_oversized_streams_are_not_successful() {
        for frame in [
            b"{\"response\":\"partial\",\"done\":false}".as_slice(),
            b"not json",
            b"{\"response\":\"secret\"}",
        ] {
            let mut decoder = GenerationDecoder::default();
            decoder.push(frame, &|_| Ok(())).unwrap();
            assert!(matches!(
                decoder.finish(&|_| Ok(())),
                Err(ProviderError::InvalidOutput(_))
            ));
        }
        let mut decoder = GenerationDecoder::default();
        assert!(decoder
            .push(&vec![b'x'; MAX_OUTPUT_BYTES + 1], &|_| Ok(()))
            .is_err());
    }

    #[test]
    fn split_utf8_and_json_frames_decode_correctly() {
        let bytes = "{\"response\":\"日本語\",\"done\":true}\n".as_bytes();
        let mut decoder = GenerationDecoder::default();
        for byte in bytes {
            decoder.push(&[*byte], &|_| Ok(())).unwrap();
        }
        assert_eq!(decoder.finish(&|_| Ok(())).unwrap().text, "日本語");
    }
}
