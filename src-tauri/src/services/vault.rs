use crate::models::{
    ClipItem, EncryptionContext, OutboxOperation, OutboxOperationKind, VaultItem, VaultSnapshot,
    VAULT_SNAPSHOT_VERSION,
};
use crate::services::cloud_crypto::{
    decrypt_payload, encrypt_payload, generate_symmetric_key, CloudCryptoError,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

const ITEM_PAYLOAD_CONTENT_TYPE: &str = "vault-item";
const WRAPPED_ITEM_KEY_CONTENT_TYPE: &str = "wrapped-item-key";

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error(transparent)]
    Crypto(#[from] CloudCryptoError),
    #[error("Unable to serialize vault snapshot")]
    Serialization,
    #[error("Unsupported vault snapshot format")]
    UnsupportedSnapshot,
}

impl VaultSnapshot {
    /// Excludes local binary and preview paths. Attachments are added only by the
    /// later explicit attachment-upload flow; native Office binaries never enter
    /// this payload.
    pub fn from_clip(clip: &ClipItem) -> Self {
        Self {
            format_version: VAULT_SNAPSHOT_VERSION,
            content_type: clip.content_type.clone(),
            content_text: clip.content_text.clone(),
            content_html: clip.content_html.clone(),
            content_rtf: clip.content_rtf.clone(),
            file_paths: clip.file_paths.clone(),
            ocr_text: clip.ocr_text.clone(),
            metadata: clip.metadata.clone(),
            note: clip.note.clone(),
            app_name: clip.app_name.clone(),
            captured_at: clip.created_at,
        }
    }
}

pub fn create_vault_item(
    owner_id: &str,
    collection_id: &str,
    key_version: u32,
    collection_key: &[u8; 32],
    clip: &ClipItem,
    now: i64,
) -> Result<VaultItem, VaultError> {
    let item_id = random_id("vault");
    let snapshot = VaultSnapshot::from_clip(clip);
    let serialized_snapshot =
        serde_json::to_vec(&snapshot).map_err(|_| VaultError::Serialization)?;
    let item_key = generate_symmetric_key();

    let encrypted_payload = encrypt_payload(
        &item_key,
        &serialized_snapshot,
        EncryptionContext {
            owner_id: owner_id.to_string(),
            collection_id: collection_id.to_string(),
            item_id: item_id.clone(),
            key_version,
            content_type: ITEM_PAYLOAD_CONTENT_TYPE.to_string(),
        },
    )?;
    let wrapped_item_key = encrypt_payload(
        collection_key,
        &item_key,
        EncryptionContext {
            owner_id: owner_id.to_string(),
            collection_id: collection_id.to_string(),
            item_id: item_id.clone(),
            key_version,
            content_type: WRAPPED_ITEM_KEY_CONTENT_TYPE.to_string(),
        },
    )?;

    Ok(VaultItem {
        id: item_id,
        collection_id: collection_id.to_string(),
        key_version,
        encrypted_payload,
        wrapped_item_key,
        created_at: now,
        updated_at: now,
        version: 1,
        deleted_at: None,
    })
}

pub fn decrypt_vault_snapshot(
    collection_key: &[u8; 32],
    item: &VaultItem,
) -> Result<VaultSnapshot, VaultError> {
    let item_key = decrypt_payload(collection_key, &item.wrapped_item_key)?;
    let item_key: [u8; 32] = item_key
        .try_into()
        .map_err(|_| VaultError::UnsupportedSnapshot)?;
    let serialized_snapshot = decrypt_payload(&item_key, &item.encrypted_payload)?;
    let snapshot: VaultSnapshot = serde_json::from_slice(&serialized_snapshot)
        .map_err(|_| VaultError::UnsupportedSnapshot)?;

    if snapshot.format_version != VAULT_SNAPSHOT_VERSION {
        return Err(VaultError::UnsupportedSnapshot);
    }

    Ok(snapshot)
}

pub fn create_upsert_outbox_operation(
    item: &VaultItem,
    now: i64,
) -> Result<OutboxOperation, VaultError> {
    let payload = serde_json::to_string(item).map_err(|_| VaultError::Serialization)?;
    Ok(OutboxOperation {
        id: random_id("outbox"),
        kind: OutboxOperationKind::UpsertVaultItem,
        collection_id: item.collection_id.clone(),
        vault_item_id: item.id.clone(),
        payload,
        idempotency_key: format!("{}:{}:{}", item.collection_id, item.id, item.version),
        attempt_count: 0,
        next_attempt_at: now,
        last_error: None,
        created_at: now,
    })
}

fn random_id(prefix: &str) -> String {
    format!(
        "{prefix}_{}",
        URL_SAFE_NO_PAD.encode(generate_symmetric_key())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_snapshot_round_trip_excludes_local_office_binary_paths() {
        let mut clip = ClipItem::from_text("meeting notes".to_string(), "text".to_string(), None);
        clip.content_type = "office".to_string();
        clip.attachment_path = Some("C:/private/office-native.bin".to_string());
        clip.image_path = Some("C:/private/preview.png".to_string());
        clip.pdf_path = Some("C:/private/preview.pdf".to_string());
        clip.svg_path = Some("C:/private/preview.svg".to_string());

        let collection_key = generate_symmetric_key();
        let item =
            create_vault_item("user-1", "personal-user-1", 1, &collection_key, &clip, 100).unwrap();
        let serialized_payload = serde_json::to_string(&item).unwrap();
        assert!(!serialized_payload.contains("meeting notes"));
        assert!(!serialized_payload.contains("office-native.bin"));

        let snapshot = decrypt_vault_snapshot(&collection_key, &item).unwrap();
        assert_eq!(snapshot.content_text.as_deref(), Some("meeting notes"));
        assert_eq!(snapshot.content_type, "office");
        assert!(!serde_json::to_string(&snapshot)
            .unwrap()
            .contains("office-native.bin"));
    }

    #[test]
    fn outbox_payload_contains_only_encrypted_item_data() {
        let clip = ClipItem::from_text("do not upload raw".to_string(), "text".to_string(), None);
        let collection_key = generate_symmetric_key();
        let item =
            create_vault_item("user-1", "personal-user-1", 1, &collection_key, &clip, 100).unwrap();
        let operation = create_upsert_outbox_operation(&item, 100).unwrap();

        assert!(!operation.payload.contains("do not upload raw"));
        assert_eq!(operation.vault_item_id, item.id);
    }
}
