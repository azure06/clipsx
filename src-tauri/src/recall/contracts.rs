//! Rust owns the assistant contract. Generated TypeScript and MCP schemas derive here.
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
