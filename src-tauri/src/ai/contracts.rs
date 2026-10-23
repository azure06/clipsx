//! Shared configuration and model contracts. IPC generation remains centralized.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

macro_rules! dto {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiProviderKind {
    Ollama,
    Openai,
    Anthropic,
    Gemini,
    Openrouter,
    Tavily,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiModelPurpose {
    Chat,
    Embedding,
    Decision,
    Rerank,
}
dto!(AiConnectionOptions { organization: Option<String>, project: Option<String> });
dto!(AiConnection {
    id: String,
    name: String,
    provider: AiProviderKind,
    base_url: String,
    enabled: bool,
    options: AiConnectionOptions
});
dto!(AiCapabilities { tools: Option<bool>, vision: Option<bool>, web_search: Option<bool>, source: Option<String> });
dto!(OpenaiPresetOptions { reasoning_effort: Option<String> });
dto!(AnthropicPresetOptions { thinking_budget: Option<u32> });
dto!(GeminiPresetOptions { thinking_budget: Option<u32> });
dto!(EmbeddingPresetOptions { dimensions: Option<u32>, task_policy: String, hosted_indexing_enabled: bool });
dto!(EmbeddingModelInformation { max_input_bytes: u32, max_batch_inputs: u32, configurable_dimensions: Option<bool>, task_policies: Vec<String>, default_task_policy: String, source: String });
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiPresetOptions {
    pub temperature: Option<f64>,
    pub openai: Option<OpenaiPresetOptions>,
    pub anthropic: Option<AnthropicPresetOptions>,
    pub gemini: Option<GeminiPresetOptions>,
    pub embedding: Option<EmbeddingPresetOptions>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub limit_policy: Option<AiLimitPolicy>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum AiLimitPolicy {
    Auto,
    Explicit,
}
dto!(ModelInformation { identity: String, context_limit: Option<u32>, input_limit: Option<u32>, output_limit: Option<u32>, runtime_context_limit: Option<u32>, tools: Option<bool>, vision: Option<bool>, structured_output: Option<bool>, reasoning_output: Option<bool>, source: String, observed_at: f64 });
dto!(AiModelPreset {
    id: String,
    name: String,
    connection_id: String,
    model_id: String,
    purpose: AiModelPurpose,
    context_limit: u32,
    output_limit: u32,
    options: AiPresetOptions,
    capabilities: AiCapabilities
});
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSelections {
    pub default_chat: Option<String>,
    pub active_embedding: Option<String>,
    pub web_search: Option<String>,
    #[serde(default)]
    pub extension_generation: Option<String>,
    #[serde(default)]
    pub default_decision: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub privacy_decision: Option<String>,
    #[serde(default)]
    pub active_rerank: Option<String>,
}
dto!(AiConfiguration { version: u32, connections: Vec<AiConnection>, presets: Vec<AiModelPreset>, selections: AiSelections });
dto!(AiConnectionState { connection_id: String, credential_configured: bool, last_test_at: Option<f64>, diagnostic: Option<String> });
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConfigurationState {
    pub configuration: AiConfiguration,
    pub connection_states: Vec<AiConnectionState>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub pending_credential_removals: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiDiscoveredModel {
    pub id: String,
    pub purposes: Option<Vec<AiModelPurpose>>,
    pub capabilities: AiCapabilities,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub model_information: Option<ModelInformation>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub embedding_information: Option<EmbeddingModelInformation>,
}
