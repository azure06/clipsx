use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSettings {
    pub max_ordinary_clips: Option<u32>,
    pub max_age_days: Option<u32>,
    pub max_managed_bytes: Option<u64>,
    pub max_representation_bytes: Option<u64>,
    pub max_snapshot_bytes: Option<u64>,
    #[serde(default, skip_deserializing)]
    pub managed_bytes_used: u64,
    #[serde(default, skip_deserializing)]
    pub retention_warning: Option<String>,
}
impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            max_ordinary_clips: Some(1000),
            max_age_days: None,
            max_managed_bytes: Some(1_073_741_824),
            max_representation_bytes: Some(52_428_800),
            max_snapshot_bytes: Some(104_857_600),
            managed_bytes_used: 0,
            retention_warning: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    pub id: String,
    pub source_app_name: Option<String>,
    pub source_app_id: Option<String>,
    pub captured_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub note: Option<String>,
    pub tags: Vec<Tag>,
    pub safe_summary: String,
    pub representation_count: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPage {
    pub items: Vec<ClipSummary>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDetail {
    pub clip: ClipSummary,
    pub representations: Vec<RepresentationDetail>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepresentationDetail {
    pub id: String,
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub storage_kind: String,
    pub ordinal: i64,
    pub byte_length: i64,
    pub text_value: Option<String>,
    pub file_references: Vec<String>,
    pub binary_file_id: Option<String>,
    pub sha256: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub scope: Option<String>,
    pub tag_id: Option<String>,
}
#[derive(Debug, Clone)]
pub enum CapturedPayload {
    Text(String),
    Binary(Vec<u8>),
    Files(Vec<String>),
}
#[derive(Debug, Clone)]
pub struct CapturedRepresentation {
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub platform: String,
    pub capture_priority: i64,
    pub payload: CapturedPayload,
}
#[derive(Debug, Clone)]
pub struct CapturedSnapshot {
    pub token: u64,
    pub source_app_name: Option<String>,
    pub source_app_id: Option<String>,
    pub representations: Vec<CapturedRepresentation>,
}
#[derive(Debug, Clone)]
pub struct TransformProvenance {
    pub source_clip_id: String,
    pub source_representation_id: String,
    pub transformer_id: String,
    pub transformer_version: String,
    pub parameter_sha256: String,
}
