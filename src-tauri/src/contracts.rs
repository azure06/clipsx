#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StorageKind {
    Text,
    BinaryAsset,
    FileList,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    Pending,
    Ready,
    Failed,
    Missing,
    Quarantined,
    Unsupported,
    Invalidated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepresentationContract {
    pub id: String,
    pub clip_id: String,
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub platform: String,
    pub storage_kind: StorageKind,
    pub ordinal: i32,
    pub capture_priority: i32,
    pub lifecycle_state: LifecycleState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RenderModel {
    Text {
        text: String,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    Markdown {
        markdown: String,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Tree {
        value: serde_json::Value,
    },
    KeyValue {
        entries: Vec<(String, String)>,
    },
    Image {
        artifact_id: String,
    },
    Html {
        sanitized_html: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSpaceDescriptor {
    pub provider_kind: String,
    pub endpoint_identity: Option<String>,
    pub model_id: String,
    pub model_revision: Option<String>,
    pub modality: String,
    pub dimensions: u32,
    pub normalization: String,
    pub distance_metric: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub state: String,
    pub message: String,
    pub reset_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactoryResetResult {
    pub deleted: Vec<String>,
    pub failures: Vec<String>,
    pub restart_required: bool,
}
