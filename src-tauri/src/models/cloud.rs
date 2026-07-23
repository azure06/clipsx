use serde::{Deserialize, Serialize};

pub const ENCRYPTED_PAYLOAD_VERSION: u16 = 1;
pub const ENCRYPTION_ALGORITHM: &str = "xchacha20poly1305";
pub const KEY_ENVELOPE_ALGORITHM: &str = "x25519-hkdf-sha256+xchacha20poly1305";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionContext {
    pub owner_id: String,
    pub collection_id: String,
    pub item_id: String,
    pub key_version: u32,
    pub content_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedPayload {
    pub format_version: u16,
    pub algorithm: String,
    pub nonce: String,
    pub ciphertext: String,
    pub context: EncryptionContext,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionKeyEnvelope {
    pub format_version: u16,
    pub algorithm: String,
    pub recipient_key_id: String,
    pub ephemeral_public_key: String,
    pub nonce: String,
    pub ciphertext: String,
    pub collection_id: String,
    pub key_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryKeyBackup {
    pub public_key: String,
    pub encrypted_private_key: EncryptedPayload,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollectionRole {
    Owner,
    Editor,
    Viewer,
}

pub const VAULT_SNAPSHOT_VERSION: u16 = 1;

/// The deliberately saved portion of a local clip. It is serialized only inside
/// an encrypted vault payload, never stored as cloud-visible metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub format_version: u16,
    pub content_type: String,
    pub content_text: Option<String>,
    pub content_html: Option<String>,
    pub content_rtf: Option<String>,
    pub file_paths: Option<String>,
    pub ocr_text: Option<String>,
    pub metadata: Option<String>,
    pub note: Option<String>,
    pub app_name: Option<String>,
    pub captured_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItem {
    pub id: String,
    pub collection_id: String,
    pub key_version: u32,
    pub encrypted_payload: EncryptedPayload,
    pub wrapped_item_key: EncryptedPayload,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: u64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutboxOperationKind {
    UpsertVaultItem,
    DeleteVaultItem,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxOperation {
    pub id: String,
    pub kind: OutboxOperationKind,
    pub collection_id: String,
    pub vault_item_id: String,
    pub payload: String,
    pub idempotency_key: String,
    pub attempt_count: u32,
    pub next_attempt_at: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub collection_id: String,
    pub vault_item_id: String,
    pub version: u64,
    pub deleted_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCursor {
    pub collection_id: String,
    pub cursor: Option<String>,
    pub updated_at: i64,
}
