//! Rust-owned generation for named hosted connections, independent of the Recall webview.
use super::{
    contracts::{generation::*, ProviderDescriptor},
    error::{ProviderError, ProviderResult},
};
use crate::ai::{configuration::validate_connection, contracts::*};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct NamedGenerationProvider {
    pub connection: AiConnection,
    pub preset: AiModelPreset,
    pub credential: String,
}

impl NamedGenerationProvider {
    fn request(&self, request: &GenerationRequest) -> ProviderResult<(url::Url, Value)> {
        if request.messages.is_empty()
            || request.max_output_tokens == 0
            || request.messages.len() > 16
            || request
                .messages
                .iter()
                .map(|m| m.content.len() + 16)
                .sum::<usize>()
                > 256 * 1024
        {
            return Err(ProviderError::InputLimit);
        }
        let base = validate_connection(&self.connection)
            .map_err(|_| ProviderError::InvalidConfiguration("invalid endpoint".into()))?;
        let limit = request.max_output_tokens.min(self.preset.output_limit);
        let messages = request
            .messages
            .iter()
            .map(|m| json!({"role":m.role,"content":m.content}))
            .collect::<Vec<_>>();
        let system = request
            .messages
            .iter()
            .filter(|m| m.role == GenerationRole::System)
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let (path, mut body) = match self.connection.provider {
            AiProviderKind::Openai => (
                "responses".into(),
                json!({"model":self.preset.model_id,"input":messages,"max_output_tokens":limit}),
            ),
            AiProviderKind::Openrouter => (
                "chat/completions".into(),
                json!({"model":self.preset.model_id,"messages":messages,"max_tokens":limit,"stream":false}),
            ),
            AiProviderKind::Anthropic => (
                "messages".into(),
                json!({"model":self.preset.model_id,"messages":messages.into_iter().filter(|m| m["role"] != "system").collect::<Vec<_>>(),"system":system,"max_tokens":limit}),
            ),
            AiProviderKind::Gemini => {
                if self.preset.model_id.contains(['/', '?', '#', '%']) {
                    return Err(ProviderError::InvalidConfiguration(
                        "invalid model ID".into(),
                    ));
                }
                (
                    format!("models/{}:generateContent", self.preset.model_id),
                    json!({
                        "systemInstruction":{"parts":[{"text":system}]},
                        "contents":request.messages.iter().filter(|m| m.role != GenerationRole::System).map(|m| json!({"role":if m.role == GenerationRole::Assistant {"model"} else {"user"},"parts":[{"text":m.content}]})).collect::<Vec<_>>(),
                        "generationConfig":{"maxOutputTokens":limit}
                    }),
                )
            }
            _ => {
                return Err(ProviderError::InvalidConfiguration(
                    "unsupported hosted generation provider".into(),
                ))
            }
        };
        if system.is_empty() {
            if self.connection.provider == AiProviderKind::Anthropic {
                body.as_object_mut().unwrap().remove("system");
            } else if self.connection.provider == AiProviderKind::Gemini {
                body.as_object_mut().unwrap().remove("systemInstruction");
            }
        }
        if let Some(temperature) = self.preset.options.temperature {
            if self.connection.provider == AiProviderKind::Gemini {
                body["generationConfig"]["temperature"] = json!(temperature);
            } else {
                body["temperature"] = json!(temperature);
            }
        }
        if let Some(effort) = self
            .preset
            .options
            .openai
            .as_ref()
            .and_then(|v| v.reasoning_effort.as_ref())
        {
            body["reasoning"] = json!({"effort":effort});
        }
        if let Some(budget) = self
            .preset
            .options
            .anthropic
            .as_ref()
            .and_then(|v| v.thinking_budget)
        {
            if budget >= limit {
                return Err(ProviderError::InvalidConfiguration(
                    "thinking budget exceeds requested output".into(),
                ));
            }
            body["thinking"] = json!({"type":"enabled","budget_tokens":budget});
        }
        if let Some(budget) = self
            .preset
            .options
            .gemini
            .as_ref()
            .and_then(|v| v.thinking_budget)
        {
            body["generationConfig"]["thinkingConfig"] = json!({"thinkingBudget":budget});
        }
        Ok((
            base.join(&path)
                .map_err(|_| ProviderError::InvalidConfiguration("invalid destination".into()))?,
            body,
        ))
    }
}

#[async_trait]
impl GenerationProvider for NamedGenerationProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            provider_id: format!("ai-generation:{}", self.preset.id),
            provider_version: "1".into(),
            model_id: self.preset.model_id.clone(),
            model_revision: self.preset.model_id.clone(),
        }
    }
    fn capabilities(&self) -> GenerationCapabilities {
        GenerationCapabilities {
            streaming: false,
            execution_location: GenerationExecutionLocation::Remote,
            context_window_tokens: Some(self.preset.context_limit),
        }
    }
    async fn generate_stream(
        &self,
        request: &GenerationRequest,
        cancellation: &GenerationCancellation,
        on_delta: &(dyn Fn(String) -> ProviderResult<()> + Send + Sync),
    ) -> ProviderResult<GenerationResponse> {
        if cancellation.is_cancelled() {
            return Err(ProviderError::Cancelled);
        }
        let (url, body) = self.request(request)?;
        let value = tokio::select! {
            _ = cancellation.cancelled() => return Err(ProviderError::Cancelled),
            result = crate::ai::http::request_json(&self.connection, &url, &self.credential, Some(&body)) => result?,
        };
        let output = parse_response(self.connection.provider, &value)?;
        if cancellation.is_cancelled() {
            return Err(ProviderError::Cancelled);
        }
        if !self.credential.is_empty() && output.text.contains(&self.credential) {
            return Err(ProviderError::InvalidOutput(
                "provider reflected protected credential".into(),
            ));
        }
        // This adapter advertises buffered delivery; the host callback receives the completed text.
        on_delta(output.text.clone())?;
        Ok(output)
    }
}

fn parse_response(provider: AiProviderKind, value: &Value) -> ProviderResult<GenerationResponse> {
    let invalid = || ProviderError::InvalidOutput("invalid generation response".into());
    if value.get("error").is_some_and(|v| !v.is_null()) {
        return Err(invalid());
    }
    let (text, reason) = match provider {
        AiProviderKind::Openai => {
            let status = value["status"].as_str().ok_or_else(invalid)?;
            if !["completed", "incomplete"].contains(&status) {
                return Err(invalid());
            }
            if status == "incomplete"
                && value["incomplete_details"]["reason"] != "max_output_tokens"
            {
                return Err(invalid());
            }
            let text = value["output"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .filter(|v| v["type"] == "message")
                .flat_map(|v| v["content"].as_array().into_iter().flatten())
                .filter(|v| v["type"] == "output_text")
                .filter_map(|v| v["text"].as_str())
                .collect::<String>();
            (
                text,
                if status == "completed" {
                    "stop"
                } else {
                    "length"
                },
            )
        }
        AiProviderKind::Anthropic => (
            value["content"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .filter(|v| v["type"] == "text")
                .filter_map(|v| v["text"].as_str())
                .collect::<String>(),
            value["stop_reason"].as_str().ok_or_else(invalid)?,
        ),
        AiProviderKind::Gemini => (
            value["candidates"][0]["content"]["parts"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .filter(|v| v["thought"] != true)
                .filter_map(|v| v["text"].as_str())
                .collect::<String>(),
            value["candidates"][0]["finishReason"]
                .as_str()
                .ok_or_else(invalid)?,
        ),
        AiProviderKind::Openrouter => (
            value["choices"][0]["message"]["content"]
                .as_str()
                .ok_or_else(invalid)?
                .into(),
            value["choices"][0]["finish_reason"]
                .as_str()
                .ok_or_else(invalid)?,
        ),
        _ => return Err(invalid()),
    };
    if text.trim().is_empty() || text.len() > 2 * 1024 * 1024 {
        return Err(invalid());
    }
    let completion_reason = match reason {
        "stop" | "end_turn" | "stop_sequence" | "STOP" => GenerationCompletionReason::Stop,
        "length" | "max_tokens" | "MAX_TOKENS" => GenerationCompletionReason::Length,
        _ => return Err(invalid()),
    };
    Ok(GenerationResponse {
        text,
        completion_reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn provider(kind: AiProviderKind) -> NamedGenerationProvider {
        NamedGenerationProvider {
            connection: AiConnection {
                id: "00000000-0000-4000-8000-000000000001".into(),
                name: "Fixture".into(),
                provider: kind,
                base_url: "https://provider.example.test/custom/v1/".into(),
                enabled: true,
                options: AiConnectionOptions {
                    organization: None,
                    project: None,
                },
            },
            preset: AiModelPreset {
                id: "fixture-preset".into(),
                name: "Fixture".into(),
                connection_id: "fixture-connection".into(),
                model_id: "fixture-model".into(),
                purpose: AiModelPurpose::Chat,
                context_limit: 32768,
                output_limit: 1024,
                options: crate::ai::configuration::default_options(),
                capabilities: crate::ai::configuration::unknown_capabilities(),
            },
            credential: "fixture-secret".into(),
        }
    }
    fn request() -> GenerationRequest {
        GenerationRequest {
            messages: [
                GenerationRole::System,
                GenerationRole::User,
                GenerationRole::Assistant,
                GenerationRole::User,
            ]
            .into_iter()
            .zip(["Follow the instruction", "First", "Answer", "Second"])
            .map(|(role, content)| GenerationMessage {
                role,
                content: content.into(),
            })
            .collect(),
            max_output_tokens: 4096,
        }
    }
    #[test]
    fn hosted_request_matrix_preserves_roles_paths_limits_and_options() {
        for (kind, path, limit_path) in [
            (AiProviderKind::Openai, "responses", "/max_output_tokens"),
            (AiProviderKind::Anthropic, "messages", "/max_tokens"),
            (
                AiProviderKind::Gemini,
                "models/fixture-model:generateContent",
                "/generationConfig/maxOutputTokens",
            ),
            (
                AiProviderKind::Openrouter,
                "chat/completions",
                "/max_tokens",
            ),
        ] {
            let mut provider = provider(kind);
            provider.preset.options.temperature = Some(0.25);
            let (url, body) = provider.request(&request()).unwrap();
            assert_eq!(
                url.as_str(),
                format!("https://provider.example.test/custom/v1/{path}")
            );
            assert_eq!(body.pointer(limit_path).unwrap(), 1024);
            assert!(!body.to_string().contains("fixture-secret"));
            match kind {
                AiProviderKind::Openai => {
                    assert_eq!(body["input"][0]["role"], "system");
                    assert_eq!(body["input"][2]["role"], "assistant");
                }
                AiProviderKind::Anthropic => {
                    assert_eq!(body["system"], "Follow the instruction");
                    assert_eq!(body["messages"].as_array().unwrap().len(), 3);
                    assert_eq!(body["messages"][1]["role"], "assistant");
                }
                AiProviderKind::Gemini => {
                    assert_eq!(
                        body["systemInstruction"]["parts"][0]["text"],
                        "Follow the instruction"
                    );
                    assert_eq!(body["contents"][1]["role"], "model");
                    assert_eq!(body["generationConfig"]["temperature"], 0.25);
                }
                _ => assert_eq!(body["messages"][0]["role"], "system"),
            }
        }
        let mut provider = provider(AiProviderKind::Anthropic);
        provider.preset.options.anthropic = Some(AnthropicPresetOptions {
            thinking_budget: Some(1024),
        });
        assert!(provider.request(&request()).is_err());
        let mut invalid = request();
        invalid.max_output_tokens = 0;
        assert!(provider.request(&invalid).is_err());
        invalid = request();
        invalid.messages[0].content = "x".repeat(256 * 1024);
        assert!(provider.request(&invalid).is_err());
        let mut provider = self::provider(AiProviderKind::Gemini);
        provider.preset.model_id = "../other".into();
        assert!(provider.request(&request()).is_err());
    }
    #[tokio::test]
    async fn cancelled_generation_never_connects_or_delivers_output() {
        let cancellation = GenerationCancellation::default();
        cancellation.cancel();
        let provider = provider(AiProviderKind::Openai);
        let result = provider
            .generate_stream(&request(), &cancellation, &|_| panic!("cancelled output"))
            .await;
        assert!(matches!(result, Err(ProviderError::Cancelled)));
    }
    #[test]
    fn hosted_completion_matrix_rejects_incomplete_and_blocked_outputs() {
        for (provider, value) in [
            (
                AiProviderKind::Openai,
                json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"hello"}]}]}),
            ),
            (
                AiProviderKind::Anthropic,
                json!({"content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"hello"}],"stop_reason":"end_turn"}),
            ),
            (
                AiProviderKind::Gemini,
                json!({"candidates":[{"content":{"parts":[{"text":"private","thought":true},{"text":"hello"}]},"finishReason":"STOP"}]}),
            ),
            (
                AiProviderKind::Openrouter,
                json!({"choices":[{"message":{"content":"hello"},"finish_reason":"stop"}]}),
            ),
        ] {
            assert_eq!(parse_response(provider, &value).unwrap().text, "hello");
        }
        assert!(parse_response(
            AiProviderKind::Openrouter,
            &json!({"choices":[{"message":{"content":"partial"},"finish_reason":null}]})
        )
        .is_err());
        assert!(parse_response(AiProviderKind::Gemini,&json!({"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"SAFETY"}]})).is_err());
        assert_eq!(
            parse_response(
                AiProviderKind::Anthropic,
                &json!({"content":[{"type":"text","text":"partial"}],"stop_reason":"max_tokens"})
            )
            .unwrap()
            .completion_reason,
            GenerationCompletionReason::Length
        );
    }
}
