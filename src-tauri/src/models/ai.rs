use serde::{Deserialize, Serialize};

/// Identifies one of the independently managed AI capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AiCapabilityKind {
    TextSearch,
    ImageSearch,
}

/// Describes how a capability's model files are obtained.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiCapabilityDeliveryMode {
    /// Files are fetched through the shared reqwest-based downloader.
    SelfManaged,
    /// Files are resolved by fastembed / HuggingFace at runtime.
    CacheManaged,
}

/// Persisted install state for a single capability.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiCapabilityInstallState {
    #[default]
    NotDownloaded,
    Downloading,
    Ready,
    Error,
}

/// Runtime activity state (not persisted — recomputed from service state at query time).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiCapabilityRuntimeState {
    Idle,
    Loading,
    Ready,
    Error,
}

/// One downloadable artifact for a self-managed capability.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilityArtifact {
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub destination: String,
}

/// Full status of one capability, returned by `get_ai_capabilities`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilityStatus {
    pub kind: AiCapabilityKind,
    pub display_name: String,
    pub delivery_mode: AiCapabilityDeliveryMode,
    pub install_state: AiCapabilityInstallState,
    pub runtime_state: AiCapabilityRuntimeState,
    pub installed_at: Option<i64>,
    pub last_error: Option<String>,
    /// Combined size of all known artifacts in bytes (0 when unknown).
    pub size_bytes: u64,
}

/// Overview of the indexing pipeline across all capabilities.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingOverview {
    pub total_eligible_clips: i64,
    pub indexed_clips: i64,
    pub missing_count: i64,
    pub stale_count: i64,
    pub failed_count: i64,
    pub pending_count: i64,
    pub active_stack_version: String,
    pub last_error_summary: Option<String>,
}

// ── Legacy types kept only for settings backward-compat migration ────────────

/// Kept so the old `ai-stack-state.json` file can still be read and discarded
/// cleanly rather than erroring on startup.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiStackInstallState {
    #[default]
    NotDownloaded,
    Downloading,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStackArtifact {
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub destination: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStackManifest {
    pub version: String,
    pub display_name: String,
    pub runtime: String,
    pub install_state: AiStackInstallState,
    pub installed_at: Option<i64>,
    pub last_error: Option<String>,
}
