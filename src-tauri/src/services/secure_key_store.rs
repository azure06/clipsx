use crate::services::cloud_crypto::{CloudCryptoError, DeviceKeyMaterial};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

const E2EE_KEYRING_SERVICE: &str = "com.infiniti.clipsx.e2ee";

#[derive(Debug, thiserror::Error)]
pub enum SecureKeyStoreError {
    #[error("Invalid device key identifier")]
    InvalidIdentifier,
    #[error("Unable to access the system credential vault")]
    CredentialVault,
    #[error("Device private key was not found")]
    NotFound,
    #[error(transparent)]
    InvalidKey(#[from] CloudCryptoError),
}

pub struct SecureKeyStore;

impl SecureKeyStore {
    pub fn store_device_key(
        device_id: &str,
        identity: &DeviceKeyMaterial,
    ) -> Result<(), SecureKeyStoreError> {
        Self::entry(device_id)?
            .set_password(&identity.private_key_encoded())
            .map_err(|_| SecureKeyStoreError::CredentialVault)
    }

    pub fn load_device_key(device_id: &str) -> Result<DeviceKeyMaterial, SecureKeyStoreError> {
        let encoded = match Self::entry(device_id)?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Err(SecureKeyStoreError::NotFound),
            Err(_) => return Err(SecureKeyStoreError::CredentialVault),
        };
        DeviceKeyMaterial::from_private_key(&encoded).map_err(Into::into)
    }

    pub fn remove_device_key(device_id: &str) -> Result<(), SecureKeyStoreError> {
        match Self::entry(device_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecureKeyStoreError::CredentialVault),
        }
    }

    pub fn store_collection_key(
        collection_id: &str,
        key_version: u32,
        key: &[u8; 32],
    ) -> Result<(), SecureKeyStoreError> {
        Self::collection_entry(collection_id, key_version)?
            .set_password(&URL_SAFE_NO_PAD.encode(key))
            .map_err(|_| SecureKeyStoreError::CredentialVault)
    }

    pub fn load_collection_key(
        collection_id: &str,
        key_version: u32,
    ) -> Result<[u8; 32], SecureKeyStoreError> {
        let encoded = match Self::collection_entry(collection_id, key_version)?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Err(SecureKeyStoreError::NotFound),
            Err(_) => return Err(SecureKeyStoreError::CredentialVault),
        };
        let decoded = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| SecureKeyStoreError::InvalidKey(CloudCryptoError::InvalidKey))?;
        decoded
            .try_into()
            .map_err(|_| SecureKeyStoreError::InvalidKey(CloudCryptoError::InvalidKey))
    }

    fn entry(device_id: &str) -> Result<keyring::Entry, SecureKeyStoreError> {
        if !is_valid_device_id(device_id) {
            return Err(SecureKeyStoreError::InvalidIdentifier);
        }
        keyring::Entry::new(E2EE_KEYRING_SERVICE, &format!("device-{device_id}"))
            .map_err(|_| SecureKeyStoreError::CredentialVault)
    }

    fn collection_entry(
        collection_id: &str,
        key_version: u32,
    ) -> Result<keyring::Entry, SecureKeyStoreError> {
        if !is_valid_device_id(collection_id) {
            return Err(SecureKeyStoreError::InvalidIdentifier);
        }
        keyring::Entry::new(
            E2EE_KEYRING_SERVICE,
            &format!("collection-{collection_id}-v{key_version}"),
        )
        .map_err(|_| SecureKeyStoreError::CredentialVault)
    }
}

pub fn is_valid_device_id(device_id: &str) -> bool {
    !device_id.is_empty()
        && device_id.len() <= 128
        && device_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::is_valid_device_id;

    #[test]
    fn device_ids_are_limited_to_safe_keyring_names() {
        assert!(is_valid_device_id("device_01-abc"));
        assert!(!is_valid_device_id(""));
        assert!(!is_valid_device_id("../../other-account"));
        assert!(!is_valid_device_id("device key"));
    }
}
