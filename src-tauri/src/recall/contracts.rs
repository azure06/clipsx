//! Rust owns the assistant contract. Generated TypeScript and MCP schemas derive here.
pub use crate::ai::contracts::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Both assistant transports reject malformed arguments without exposing their contents.
pub(super) fn parse_tool_arguments<T: serde::de::DeserializeOwned>(
    value: serde_json::Value,
) -> anyhow::Result<T> {
    serde_json::from_value(value).map_err(|_| {
        crate::failure::FailureCode::InvalidParameters
            .failure()
            .into()
    })
}

macro_rules! dto {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalMode {
    #[default]
    Keyword,
    Hybrid,
}
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextKind {
    #[default]
    Captured,
    Ocr,
    Note,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipFilters {
    pub scope: Option<String>,
    pub tag_id: Option<String>,
    pub captured_after: Option<i64>,
    pub captured_before: Option<i64>,
    #[serde(default)]
    pub source_app_ids: Vec<String>,
    #[serde(default)]
    pub excluded_clip_ids: Vec<String>,
    #[serde(default)]
    pub representation_families: Vec<String>,
    #[serde(default)]
    pub facet_ids: Vec<String>,
}

dto!(ClipSearchRequest {
    query: String, mode: Option<RetrievalMode>, filters: Option<ClipFilters>, limit: Option<u32>, cursor: Option<String>,
});
dto!(ClipReadRequest {
    clip_id: String, representation_id: Option<String>, kind: Option<TextKind>, page_bytes: Option<u32>, cursor: Option<String>,
});
dto!(ClipImageRequest {
    clip_id: String,
    representation_id: String
});
dto!(RepresentationDescriptor {
    id: String, mime_type: Option<String>, family: String, storage_kind: String, byte_length: u32, fingerprint: String, image_available: bool,
});
dto!(ClipTag {
    id: String,
    name: String
});
dto!(ClipMetadata {
    id: String, revision: String, captured_at: f64, source_app_id: Option<String>, source_app_name: Option<String>, favorite: bool, pinned: bool, tags: Vec<ClipTag>, representations: Vec<RepresentationDescriptor>, ocr_status: String,
});
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum WarningCode {
    FiltersBounded,
    SourceChanged,
    RetrievalIncomplete,
    OcrPending,
    TextUnavailable,
}
dto!(ClipboardWarning { code: WarningCode });
dto!(ClipMatch { clip: ClipMetadata, snippet: Option<String>, rank: f64, sources: Vec<String> });
dto!(RetrievalOutcome {
    source: String,
    status: String
});
dto!(ClipSearchResult {
    api_version: u32, items: Vec<ClipMatch>, next_cursor: Option<String>, exhaustive: bool, source_outcomes: Vec<RetrievalOutcome>, warnings: Vec<ClipboardWarning>,
});
dto!(ClipReadResult {
    api_version: u32, clip: ClipMetadata, representation_id: Option<String>, kind: TextKind, text: String, text_fingerprint: Option<String>, total_bytes: u32, next_cursor: Option<String>, warnings: Vec<ClipboardWarning>,
});
dto!(ClipImageResult {
    api_version: u32,
    clip_id: String,
    representation_id: String,
    revision: String,
    source_fingerprint: String,
    mime_type: String,
    data: String,
    original_width: u32,
    original_height: u32,
    width: u32,
    height: u32,
    resized: bool,
});
dto!(ClipboardStatus {
    api_version: u32, now: f64, timezone: Option<String>, keyword_ready: bool, semantic_ready: bool, tools: Vec<String>, result_limit: u32, organization_limit: u32, default_text_page_bytes: u32, max_text_page_bytes: u32, max_image_bytes: u32,
});
dto!(SourceApplication {
    id: String,
    name: String
});
dto!(ClipboardFilters {
    api_version: u32, tags: Vec<ClipTag>, source_applications: Vec<SourceApplication>, representation_families: Vec<String>, facet_ids: Vec<String>, warnings: Vec<ClipboardWarning>,
});

dto!(SourceReference {
    clip_id: String,
    representation_id: String,
    fingerprint: String
});
dto!(ModelAttribution {
    provider: String,
    model: String
});
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum CreatedTextFormat {
    PlainText,
    Markdown,
}
dto!(CreateClipRequest { request_id: String, text: String, format: CreatedTextFormat, sources: Option<Vec<SourceReference>>, model: Option<ModelAttribution> });
dto!(ClipRevision {
    clip_id: String,
    revision: String
});
dto!(OrganizeClipsRequest { request_id: String, clips: Vec<ClipRevision>, note: Option<String>, favorite: Option<bool>, pinned: Option<bool>, add_tags: Option<Vec<String>>, remove_tags: Option<Vec<String>> });
dto!(UndoClipboardRequest {
    request_id: String,
    action_id: String
});
dto!(ClipboardActionResult { api_version: u32, action_id: String, operation: String, clips: Vec<ClipRevision>, removed_clip_ids: Vec<String>, undo_available: bool, expires_at: f64 });
dto!(ClipboardActivity {
    action_id: String,
    operation: String,
    actor_id: String,
    created_at: f64,
    undo_available: bool
});

dto!(McpConfiguration {
    enabled: bool,
    port: u16
});
dto!(McpGrant {
    id: String,
    name: String,
    can_write: bool,
    created_at: f64,
    revoked: bool
});
dto!(McpGrantSecret {
    grant: McpGrant,
    token: String
});
dto!(McpIntegrationStatus { configuration: McpConfiguration, endpoint: String, state: String, diagnostic: Option<String> });

dto!(ResolvedExecutionPolicy {
    input_limit: u32, output_limit: u32, context_limit: u32, estimated: bool,
    source: String, reasoning: Option<ReasoningSelection>, max_steps: u32, max_compactions: u32, deadline_ms: u32
});
dto!(RecallContextSummary {
    thread_id: String,
    covered_message_id: String,
    input_fingerprint: String,
    text: String,
    provider: String,
    model: String,
    created_at: f64
});
dto!(RecallContextCoverage { input_fingerprint: String, summary: Option<RecallContextSummary> });
/// Generated for the TypeScript-owned context planner; never instantiated by Rust.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
pub struct ContextStatus {
    pub state: String,
    pub estimated_input: u32,
    pub input_limit: u32,
    pub reason: Option<String>,
}
dto!(DecisionTestResult {
    choice: String,
    confidence: f64
});
dto!(AssistantToolDefinition {
    name: String,
    description: String,
    input_schema_json: String
});
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReasoningSelection {
    Effort { value: String },
    Budget { tokens: u32 },
    Thinking { enabled: bool },
}
dto!(AssistantModelOptions { reasoning: Vec<ReasoningSelection>, reasoning_source: Option<String> });
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantRunRequest {
    pub run_id: String,
    pub preset_id: String,
    pub filters: Option<ClipFilters>,
    pub attachments: Vec<ClipRevision>,
    pub web_enabled: bool,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub reasoning: Option<ReasoningSelection>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantRunContext {
    pub run_id: String,
    pub connection: AiConnection,
    pub preset: AiModelPreset,
    pub filters: ClipFilters,
    pub attachments: Vec<ClipReadResult>,
    pub status: ClipboardStatus,
    pub tools: Vec<AssistantToolDefinition>,
    pub web_route: String,
    pub reasoning: Option<ReasoningSelection>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub execution_policy: Option<ResolvedExecutionPolicy>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub model_information: Option<ModelInformation>,
}
dto!(WebSource {
    url: String,
    title: String,
    content: String
});
dto!(WebEvidence { sources: Vec<WebSource>, incomplete: bool });

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecallThread {
    pub id: String,
    pub local_id: String,
    pub title: String,
    pub archived: bool,
    pub preset_id: Option<String>,
    pub web_enabled: bool,
    pub head_message_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub reasoning: Option<ReasoningSelection>,
}
dto!(RecallMessage { id: String, parent_id: Option<String>, role: String, content_json: String, status_json: Option<String>, metadata_json: String, created_at: i64 });
dto!(RecallHistory { thread: RecallThread, messages: Vec<RecallMessage>, sources: Vec<RecallSourceSnapshot> });
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecallThreadUpdate {
    pub thread_id: String,
    pub title: String,
    pub archived: bool,
    pub preset_id: Option<String>,
    pub web_enabled: bool,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub reasoning: Option<ReasoningSelection>,
}
dto!(RecallRunStart {
    thread_id: String,
    run_id: String,
    message_id: String,
    parent_id: String
});
dto!(RecallCheckpoint { run_id: String, sequence: u32, content_json: String, metadata_json: String, status_json: Option<String>, terminal: bool });
dto!(RecallSourceSnapshot { id: String, message_id: String, clip_id: String, snapshot_json: String, asset_hash: Option<String>, available: bool });

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_contracts_match() {
        let config = ts_rs::Config::default().with_large_int("number");
        let declarations = [
            RetrievalMode::decl(&config),
            TextKind::decl(&config),
            ClipFilters::decl(&config),
            ClipSearchRequest::decl(&config),
            ClipReadRequest::decl(&config),
            ClipImageRequest::decl(&config),
            RepresentationDescriptor::decl(&config),
            ClipTag::decl(&config),
            ClipMetadata::decl(&config),
            WarningCode::decl(&config),
            ClipboardWarning::decl(&config),
            ClipMatch::decl(&config),
            RetrievalOutcome::decl(&config),
            ClipSearchResult::decl(&config),
            ClipReadResult::decl(&config),
            ClipImageResult::decl(&config),
            ClipboardStatus::decl(&config),
            SourceApplication::decl(&config),
            ClipboardFilters::decl(&config),
            SourceReference::decl(&config),
            ModelAttribution::decl(&config),
            CreatedTextFormat::decl(&config),
            CreateClipRequest::decl(&config),
            ClipRevision::decl(&config),
            OrganizeClipsRequest::decl(&config),
            UndoClipboardRequest::decl(&config),
            ClipboardActionResult::decl(&config),
            ClipboardActivity::decl(&config),
            McpConfiguration::decl(&config),
            McpGrant::decl(&config),
            McpGrantSecret::decl(&config),
            McpIntegrationStatus::decl(&config),
            AiProviderKind::decl(&config),
            AiModelPurpose::decl(&config),
            AiConnectionOptions::decl(&config),
            AiConnection::decl(&config),
            AiCapabilities::decl(&config),
            OpenaiPresetOptions::decl(&config),
            AnthropicPresetOptions::decl(&config),
            GeminiPresetOptions::decl(&config),
            EmbeddingPresetOptions::decl(&config),
            EmbeddingModelInformation::decl(&config),
            AiLimitPolicy::decl(&config),
            ModelInformation::decl(&config),
            ResolvedExecutionPolicy::decl(&config),
            RecallContextSummary::decl(&config),
            ContextStatus::decl(&config),
            RecallContextCoverage::decl(&config),
            AiPresetOptions::decl(&config),
            AiModelPreset::decl(&config),
            AiSelections::decl(&config),
            DecisionTestResult::decl(&config),
            AiConfiguration::decl(&config),
            AiConnectionState::decl(&config),
            AiConfigurationState::decl(&config),
            AiDiscoveredModel::decl(&config),
            AssistantToolDefinition::decl(&config),
            ReasoningSelection::decl(&config),
            AssistantModelOptions::decl(&config),
            AssistantRunRequest::decl(&config),
            AssistantRunContext::decl(&config),
            WebSource::decl(&config),
            WebEvidence::decl(&config),
            RecallThread::decl(&config),
            RecallMessage::decl(&config),
            RecallHistory::decl(&config),
            RecallThreadUpdate::decl(&config),
            RecallRunStart::decl(&config),
            RecallCheckpoint::decl(&config),
            RecallSourceSnapshot::decl(&config),
        ];
        let generated = format!(
            "// Generated from src-tauri/src/recall/contracts.rs. Do not edit.\n{}\n",
            declarations
                .iter()
                .map(|v| format!("export {v}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/features/recall/contracts.generated.ts");
        if std::env::var_os("CLIPSX_GENERATE_CONTRACTS").is_some() {
            std::fs::write(&path, &generated).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(path).unwrap().replace("\r\n", "\n"),
            generated,
            "Regenerate Recall contracts with CLIPSX_GENERATE_CONTRACTS=1"
        );
        let schema = schemars::schema_for!(ClipSearchRequest);
        assert!(serde_json::to_string(&schema)
            .unwrap()
            .contains("additionalProperties\":false"));
    }
}
