// Data models and types
pub mod ai;
pub mod clip;
pub mod cloud;
pub mod entitlement;
pub mod search;
pub mod settings;

pub use ai::{
    AiCapabilityArtifact, AiCapabilityDeliveryMode, AiCapabilityInstallState, AiCapabilityKind,
    AiCapabilityRuntimeState, AiCapabilityStatus, IndexingOverview,
};
pub use clip::{compute_index_text, ClipItem, ClipTagEntry, Tag};
#[allow(unused_imports)]
pub use cloud::{
    CollectionKeyEnvelope, CollectionRole, DeviceIdentity, EncryptedPayload, EncryptionContext,
    RecoveryKeyBackup, ENCRYPTED_PAYLOAD_VERSION, ENCRYPTION_ALGORITHM, KEY_ENVELOPE_ALGORITHM,
};
#[allow(unused_imports)]
pub use entitlement::{
    EntitlementState, EntitlementTier, OfficeRestoreAllowance, UsageAllowance,
    FREE_OFFICE_RESTORE_LIMIT,
};
pub use search::{SearchDocument, SearchEmbedding, SearchJob};
pub use settings::AppSettings;
