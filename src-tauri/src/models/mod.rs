// Data models and types
pub mod ai;
pub mod clip;
pub mod search;
pub mod settings;

pub use ai::{
    AiCapabilityArtifact, AiCapabilityDeliveryMode, AiCapabilityInstallState, AiCapabilityKind,
    AiCapabilityRuntimeState, AiCapabilityStatus, IndexingOverview,
};
pub use clip::{compute_index_text, ClipItem, ClipTagEntry, Tag};
pub use search::{SearchDocument, SearchEmbedding, SearchJob};
pub use settings::AppSettings;
