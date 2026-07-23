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
