use crate::models::{
    CollectionKeyEnvelope, EncryptedPayload, EncryptionContext, RecoveryKeyBackup,
    ENCRYPTED_PAYLOAD_VERSION, ENCRYPTION_ALGORITHM, KEY_ENVELOPE_ALGORITHM,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, Generate, Key, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

const KEY_BYTES: usize = 32;
const ENVELOPE_KDF_INFO: &[u8] = b"clipsx.collection-key-envelope.v1";
const RECOVERY_KDF_INFO: &[u8] = b"clipsx.account-recovery.v1";

#[derive(Debug, thiserror::Error)]
pub enum CloudCryptoError {
    #[error("Invalid encoded key material")]
    InvalidKey,
    #[error("Unsupported encrypted payload format")]
    UnsupportedFormat,
    #[error("Encrypted payload authentication failed")]
    AuthenticationFailed,
    #[error("Key agreement rejected a non-contributory public key")]
    InvalidPublicKey,
    #[error("Unable to derive an encryption key")]
    KeyDerivationFailed,
    #[error("Unable to serialize encryption context")]
    InvalidContext,
}

pub struct DeviceKeyMaterial {
    private_key: StaticSecret,
    public_key: PublicKey,
}

impl DeviceKeyMaterial {
    pub fn generate() -> Self {
        let private_key = StaticSecret::random();
        let public_key = PublicKey::from(&private_key);
        Self {
            private_key,
            public_key,
        }
    }

    pub fn from_private_key(encoded: &str) -> Result<Self, CloudCryptoError> {
        let private_key = StaticSecret::from(decode_32(encoded)?);
        let public_key = PublicKey::from(&private_key);
        Ok(Self {
            private_key,
            public_key,
        })
    }

    pub fn private_key_encoded(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.private_key.to_bytes())
    }

    pub fn public_key_encoded(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.public_key.as_bytes())
    }
}

pub fn generate_symmetric_key() -> [u8; KEY_BYTES] {
    Key::<XChaCha20Poly1305>::generate().into()
}

fn cipher_from_key(key: &[u8; KEY_BYTES]) -> XChaCha20Poly1305 {
    let cipher_key =
        Key::<XChaCha20Poly1305>::try_from(key.as_slice()).expect("fixed-size key must be valid");
    XChaCha20Poly1305::new(&cipher_key)
}

fn nonce_from_bytes(nonce: &[u8; 24]) -> Result<XNonce, CloudCryptoError> {
    XNonce::try_from(nonce.as_slice()).map_err(|_| CloudCryptoError::InvalidKey)
}

pub fn generate_recovery_code() -> String {
    URL_SAFE_NO_PAD.encode(generate_symmetric_key())
}

pub fn encrypt_payload(
    key: &[u8; KEY_BYTES],
    plaintext: &[u8],
    context: EncryptionContext,
) -> Result<EncryptedPayload, CloudCryptoError> {
    let associated_data = serialize_context(&context)?;
    let cipher = cipher_from_key(key);
    let nonce = XNonce::generate();
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &associated_data,
            },
        )
        .map_err(|_| CloudCryptoError::AuthenticationFailed)?;

    Ok(EncryptedPayload {
        format_version: ENCRYPTED_PAYLOAD_VERSION,
        algorithm: ENCRYPTION_ALGORITHM.to_string(),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
        context,
    })
}

pub fn decrypt_payload(
    key: &[u8; KEY_BYTES],
    payload: &EncryptedPayload,
) -> Result<Vec<u8>, CloudCryptoError> {
    validate_payload(payload)?;
    let nonce = decode_24(&payload.nonce)?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&payload.ciphertext)
        .map_err(|_| CloudCryptoError::InvalidKey)?;
    let associated_data = serialize_context(&payload.context)?;
    let cipher = cipher_from_key(key);

    cipher
        .decrypt(
            &nonce_from_bytes(&nonce)?,
            Payload {
                msg: &ciphertext,
                aad: &associated_data,
            },
        )
        .map_err(|_| CloudCryptoError::AuthenticationFailed)
}

pub fn seal_collection_key(
    collection_key: &[u8; KEY_BYTES],
    recipient_key_id: String,
    recipient_public_key: &str,
    collection_id: String,
    key_version: u32,
) -> Result<CollectionKeyEnvelope, CloudCryptoError> {
    let recipient_public = PublicKey::from(decode_32(recipient_public_key)?);
    let ephemeral_private = EphemeralSecret::random();
    let ephemeral_public = PublicKey::from(&ephemeral_private);
    let shared_secret = ephemeral_private.diffie_hellman(&recipient_public);
    if !shared_secret.was_contributory() {
        return Err(CloudCryptoError::InvalidPublicKey);
    }

    let context = envelope_context(&collection_id, key_version, &recipient_key_id);
    let wrapping_key = derive_key(shared_secret.as_bytes(), &context, ENVELOPE_KDF_INFO)?;
    let cipher = cipher_from_key(&wrapping_key);
    let nonce = XNonce::generate();
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: collection_key,
                aad: &context,
            },
        )
        .map_err(|_| CloudCryptoError::AuthenticationFailed)?;

    Ok(CollectionKeyEnvelope {
        format_version: ENCRYPTED_PAYLOAD_VERSION,
        algorithm: KEY_ENVELOPE_ALGORITHM.to_string(),
        recipient_key_id,
        ephemeral_public_key: URL_SAFE_NO_PAD.encode(ephemeral_public.as_bytes()),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
        collection_id,
        key_version,
    })
}

pub fn open_collection_key(
    recipient: &DeviceKeyMaterial,
    envelope: &CollectionKeyEnvelope,
) -> Result<[u8; KEY_BYTES], CloudCryptoError> {
    if envelope.format_version != ENCRYPTED_PAYLOAD_VERSION
        || envelope.algorithm != KEY_ENVELOPE_ALGORITHM
    {
        return Err(CloudCryptoError::UnsupportedFormat);
    }

    let ephemeral_public = PublicKey::from(decode_32(&envelope.ephemeral_public_key)?);
    let shared_secret = recipient.private_key.diffie_hellman(&ephemeral_public);
    if !shared_secret.was_contributory() {
        return Err(CloudCryptoError::InvalidPublicKey);
    }

    let context = envelope_context(
        &envelope.collection_id,
        envelope.key_version,
        &envelope.recipient_key_id,
    );
    let wrapping_key = derive_key(shared_secret.as_bytes(), &context, ENVELOPE_KDF_INFO)?;
    let nonce = decode_24(&envelope.nonce)?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&envelope.ciphertext)
        .map_err(|_| CloudCryptoError::InvalidKey)?;
    let cipher = cipher_from_key(&wrapping_key);
    let plaintext = cipher
        .decrypt(
            &nonce_from_bytes(&nonce)?,
            Payload {
                msg: &ciphertext,
                aad: &context,
            },
        )
        .map_err(|_| CloudCryptoError::AuthenticationFailed)?;

    plaintext
        .try_into()
        .map_err(|_| CloudCryptoError::InvalidKey)
}

pub fn create_recovery_key_backup(
    owner_id: String,
    recovery_code: &str,
    created_at: i64,
) -> Result<(DeviceKeyMaterial, RecoveryKeyBackup), CloudCryptoError> {
    let recovery_identity = DeviceKeyMaterial::generate();
    let recovery_key = recovery_key_from_code(recovery_code)?;
    let context = EncryptionContext {
        owner_id,
        collection_id: "account-recovery".to_string(),
        item_id: "recovery-key".to_string(),
        key_version: 1,
        content_type: "recovery-key".to_string(),
    };
    let encrypted_private_key = encrypt_payload(
        &recovery_key,
        recovery_identity.private_key_encoded().as_bytes(),
        context,
    )?;

    let backup = RecoveryKeyBackup {
        public_key: recovery_identity.public_key_encoded(),
        encrypted_private_key,
        created_at,
    };
    Ok((recovery_identity, backup))
}

pub fn restore_recovery_key_backup(
    recovery_code: &str,
    backup: &RecoveryKeyBackup,
) -> Result<DeviceKeyMaterial, CloudCryptoError> {
    let recovery_key = recovery_key_from_code(recovery_code)?;
    let private_key = decrypt_payload(&recovery_key, &backup.encrypted_private_key)?;
    let private_key = String::from_utf8(private_key).map_err(|_| CloudCryptoError::InvalidKey)?;
    let identity = DeviceKeyMaterial::from_private_key(&private_key)?;
    if identity.public_key_encoded() != backup.public_key {
        return Err(CloudCryptoError::AuthenticationFailed);
    }
    Ok(identity)
}

pub fn recovery_key_from_code(code: &str) -> Result<[u8; KEY_BYTES], CloudCryptoError> {
    let secret = decode_32(code)?;
    derive_key(&secret, b"clipsx-recovery-code", RECOVERY_KDF_INFO)
}

fn validate_payload(payload: &EncryptedPayload) -> Result<(), CloudCryptoError> {
    if payload.format_version != ENCRYPTED_PAYLOAD_VERSION
        || payload.algorithm != ENCRYPTION_ALGORITHM
    {
        return Err(CloudCryptoError::UnsupportedFormat);
    }
    Ok(())
}

fn serialize_context(context: &EncryptionContext) -> Result<Vec<u8>, CloudCryptoError> {
    serde_json::to_vec(context).map_err(|_| CloudCryptoError::InvalidContext)
}

fn envelope_context(collection_id: &str, key_version: u32, recipient_key_id: &str) -> Vec<u8> {
    format!(
        "clipsx-envelope-v1\\0{}\\0{}\\0{}",
        collection_id, key_version, recipient_key_id
    )
    .into_bytes()
}

fn derive_key(input: &[u8], salt: &[u8], info: &[u8]) -> Result<[u8; KEY_BYTES], CloudCryptoError> {
    let hkdf = Hkdf::<Sha256>::new(Some(salt), input);
    let mut output = [0u8; KEY_BYTES];
    hkdf.expand(info, &mut output)
        .map_err(|_| CloudCryptoError::KeyDerivationFailed)?;
    Ok(output)
}

fn decode_32(encoded: &str) -> Result<[u8; 32], CloudCryptoError> {
    URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| CloudCryptoError::InvalidKey)?
        .try_into()
        .map_err(|_| CloudCryptoError::InvalidKey)
}

fn decode_24(encoded: &str) -> Result<[u8; 24], CloudCryptoError> {
    URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| CloudCryptoError::InvalidKey)?
        .try_into()
        .map_err(|_| CloudCryptoError::InvalidKey)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> EncryptionContext {
        EncryptionContext {
            owner_id: "owner".to_string(),
            collection_id: "collection".to_string(),
            item_id: "item".to_string(),
            key_version: 1,
            content_type: "text".to_string(),
        }
    }

    #[test]
    fn payload_round_trip_and_context_authentication() {
        let key = generate_symmetric_key();
        let mut payload = encrypt_payload(&key, b"private text", context()).unwrap();
        assert_eq!(decrypt_payload(&key, &payload).unwrap(), b"private text");

        payload.context.item_id = "other-item".to_string();
        assert!(matches!(
            decrypt_payload(&key, &payload),
            Err(CloudCryptoError::AuthenticationFailed)
        ));
    }

    #[test]
    fn collection_key_envelope_opens_only_for_recipient() {
        let recipient = DeviceKeyMaterial::generate();
        let other = DeviceKeyMaterial::generate();
        let collection_key = generate_symmetric_key();
        let envelope = seal_collection_key(
            &collection_key,
            "device-1".to_string(),
            &recipient.public_key_encoded(),
            "collection-1".to_string(),
            2,
        )
        .unwrap();

        assert_eq!(
            open_collection_key(&recipient, &envelope).unwrap(),
            collection_key
        );
        assert!(open_collection_key(&other, &envelope).is_err());
    }

    #[test]
    fn recovery_code_restores_only_the_matching_recovery_identity() {
        let recovery_code = generate_recovery_code();
        let (identity, backup) =
            create_recovery_key_backup("owner".to_string(), &recovery_code, 100).unwrap();
        let restored = restore_recovery_key_backup(&recovery_code, &backup).unwrap();

        assert_eq!(restored.public_key_encoded(), identity.public_key_encoded());
        assert!(restore_recovery_key_backup(&generate_recovery_code(), &backup).is_err());
    }
}
