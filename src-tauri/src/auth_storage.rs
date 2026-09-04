//! Device-local persistence for Supabase session and PKCE values.

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

#[cfg(any(not(target_os = "windows"), not(test)))]
const AUTH_SERVICE: &str = "com.infiniti.clipsx";
pub const AUTH_STORAGE_KEY: &str = "sb-clipsx-auth-token";
const MAX_PLAINTEXT_BYTES: usize = 1024 * 1024;
const MAX_ENCRYPTED_BYTES: u64 = 2 * 1024 * 1024;

pub fn is_supported_key(key: &str) -> bool {
    if matches!(
        key,
        AUTH_STORAGE_KEY
            | "sb-clipsx-auth-token-user"
            | "sb-clipsx-auth-token-code-verifier"
            | "sb-clipsx-auth-token-flows-code-verifier"
    ) {
        return true;
    }
    key.strip_prefix("sb-clipsx-auth-token-flow-")
        .and_then(|suffix| suffix.strip_suffix("-code-verifier"))
        .is_some_and(|id| {
            id.len() == 32
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

#[derive(Clone)]
pub struct AuthStorage {
    root: PathBuf,
    lock: Arc<tokio::sync::Mutex<()>>,
}

impl AuthStorage {
    pub fn new(data_root: PathBuf) -> Self {
        Self {
            root: data_root.join("auth"),
            lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn get(&self, key: String) -> Result<Option<String>, String> {
        validate_key(&key)?;
        let _guard = self.lock.lock().await;
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || backend::get(&root, &key))
            .await
            .map_err(|_| "Authentication storage task failed".to_string())?
    }

    pub async fn set(&self, key: String, value: String) -> Result<(), String> {
        validate_key(&key)?;
        let _guard = self.lock.lock().await;
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || backend::set(&root, &key, value))
            .await
            .map_err(|_| "Authentication storage task failed".to_string())?
    }

    pub async fn remove(&self, key: String) -> Result<(), String> {
        validate_key(&key)?;
        let _guard = self.lock.lock().await;
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || backend::remove(&root, &key))
            .await
            .map_err(|_| "Authentication storage task failed".to_string())?
    }

    pub async fn reset(&self) -> Result<(), String> {
        let _guard = self.lock.lock().await;
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || backend::reset(&root))
            .await
            .map_err(|_| "Authentication storage task failed".to_string())?
    }
}

fn validate_key(key: &str) -> Result<(), String> {
    is_supported_key(key)
        .then_some(())
        .ok_or_else(|| "Unsupported authentication storage key".to_string())
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct Envelope {
    version: u8,
    values: BTreeMap<String, String>,
}

#[cfg(target_os = "windows")]
mod backend {
    use super::*;
    use std::{fs, io::Write, slice};
    use windows::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    const FILE_NAME: &str = "session.dpapi";

    pub fn get(root: &PathBuf, key: &str) -> Result<Option<String>, String> {
        Ok(read(root)?.values.get(key).cloned())
    }

    pub fn set(root: &PathBuf, key: &str, value: String) -> Result<(), String> {
        if !path(root).exists() {
            cleanup_legacy()?;
        }
        let mut envelope = read(root)?;
        envelope.values.insert(key.to_string(), value);
        write(root, &envelope)
    }

    pub fn remove(root: &PathBuf, key: &str) -> Result<(), String> {
        let mut envelope = read(root)?;
        envelope.values.remove(key);
        if envelope.values.is_empty() {
            remove_file(root)
        } else {
            write(root, &envelope)
        }
    }

    pub fn reset(root: &PathBuf) -> Result<(), String> {
        remove_file(root)?;
        cleanup_legacy()
    }

    fn path(root: &PathBuf) -> PathBuf {
        root.join(FILE_NAME)
    }

    fn read(root: &PathBuf) -> Result<Envelope, String> {
        let path = path(root);
        let metadata = match fs::metadata(&path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Envelope {
                    version: 1,
                    values: BTreeMap::new(),
                })
            }
            Err(_) => return Err("Unable to read protected sign-in storage".into()),
        };
        if metadata.len() > MAX_ENCRYPTED_BYTES {
            return Err("Protected sign-in storage exceeds its size limit".into());
        }
        let encrypted =
            fs::read(path).map_err(|_| "Unable to read protected sign-in storage".to_string())?;
        let plaintext = unprotect(&encrypted)?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err("Protected sign-in data exceeds its size limit".into());
        }
        let envelope: Envelope = serde_json::from_slice(&plaintext)
            .map_err(|_| "Protected sign-in storage is corrupt".to_string())?;
        if envelope.version != 1 {
            return Err("Protected sign-in storage has an unsupported version".into());
        }
        if envelope.values.keys().any(|key| !is_supported_key(key)) {
            return Err("Protected sign-in storage contains an invalid key".into());
        }
        Ok(envelope)
    }

    fn write(root: &PathBuf, envelope: &Envelope) -> Result<(), String> {
        let plaintext = serde_json::to_vec(envelope)
            .map_err(|_| "Unable to serialize protected sign-in data".to_string())?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err("Sign-in data exceeds its size limit".into());
        }
        let encrypted = protect(&plaintext)?;
        if encrypted.len() as u64 > MAX_ENCRYPTED_BYTES {
            return Err("Protected sign-in data exceeds its size limit".into());
        }
        fs::create_dir_all(root)
            .map_err(|_| "Unable to create protected sign-in storage".to_string())?;
        cleanup_temporary_files(root);
        let mut temporary = tempfile::Builder::new()
            .prefix(".session.dpapi-")
            .suffix(".tmp")
            .tempfile_in(root)
            .map_err(|_| "Unable to stage protected sign-in data".to_string())?;
        temporary
            .write_all(&encrypted)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| "Unable to persist protected sign-in data".to_string())?;
        temporary
            .persist(path(root))
            .map_err(|_| "Unable to replace protected sign-in data".to_string())?;
        Ok(())
    }

    fn remove_file(root: &PathBuf) -> Result<(), String> {
        match fs::remove_file(path(root)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Unable to clear protected sign-in storage".into()),
        }
    }

    fn cleanup_temporary_files(root: &PathBuf) {
        let Ok(entries) = fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(".session.dpapi-") && name.ends_with(".tmp") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    fn protect(value: &[u8]) -> Result<Vec<u8>, String> {
        crypt(value, true)
    }

    fn unprotect(value: &[u8]) -> Result<Vec<u8>, String> {
        crypt(value, false)
    }

    fn crypt(value: &[u8], protect_value: bool) -> Result<Vec<u8>, String> {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(value.len()).map_err(|_| "Sign-in data is too large")?,
            pbData: value.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let result = unsafe {
            if protect_value {
                CryptProtectData(
                    &mut input,
                    windows::core::PCWSTR::null(),
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &mut input,
                    None,
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            }
        };
        result.map_err(|_| "Windows could not protect sign-in data".to_string())?;
        let bytes =
            unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        }
        Ok(bytes)
    }

    #[cfg(not(test))]
    fn cleanup_legacy() -> Result<(), String> {
        let index_key = format!("{AUTH_STORAGE_KEY}-flows-code-verifier");
        let mut keys = vec![
            AUTH_STORAGE_KEY.to_string(),
            format!("{AUTH_STORAGE_KEY}-user"),
            format!("{AUTH_STORAGE_KEY}-code-verifier"),
            index_key.clone(),
        ];
        if let Ok(index) =
            keyring::Entry::new(AUTH_SERVICE, &index_key).and_then(|entry| entry.get_password())
        {
            if let Ok(ids) = serde_json::from_str::<Vec<String>>(&index) {
                keys.extend(
                    ids.into_iter()
                        .filter(|id| {
                            id.len() == 32
                                && id.bytes().all(|byte| {
                                    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
                                })
                        })
                        .map(|id| format!("{AUTH_STORAGE_KEY}-flow-{id}-code-verifier")),
                );
            }
        }
        for key in keys {
            let entry = keyring::Entry::new(AUTH_SERVICE, &key)
                .map_err(|_| "Unable to access legacy sign-in storage".to_string())?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => return Err("Unable to clear legacy sign-in storage".into()),
            }
        }
        Ok(())
    }

    #[cfg(test)]
    fn cleanup_legacy() -> Result<(), String> {
        // Unit tests must never touch the developer's real Windows Credential Manager.
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn dpapi_round_trips_large_unicode_values_without_plaintext_on_disk() {
            let root = tempfile::tempdir().unwrap();
            let value = format!("こんにちは:{}", "session-value".repeat(1024));
            set(&root.path().to_path_buf(), AUTH_STORAGE_KEY, value.clone()).unwrap();
            assert_eq!(
                get(&root.path().to_path_buf(), AUTH_STORAGE_KEY).unwrap(),
                Some(value.clone())
            );
            let encrypted = fs::read(root.path().join(FILE_NAME)).unwrap();
            assert!(!encrypted
                .windows(value.as_bytes().len())
                .any(|part| part == value.as_bytes()));
        }

        #[test]
        fn tampering_is_rejected_and_previous_value_survives_failed_oversized_write() {
            let root = tempfile::tempdir().unwrap();
            let root = root.path().to_path_buf();
            set(&root, AUTH_STORAGE_KEY, "working".into()).unwrap();
            assert!(set(&root, AUTH_STORAGE_KEY, "x".repeat(MAX_PLAINTEXT_BYTES)).is_err());
            assert_eq!(
                get(&root, AUTH_STORAGE_KEY).unwrap().as_deref(),
                Some("working")
            );
            let mut encrypted = fs::read(path(&root)).unwrap();
            let middle = encrypted.len() / 2;
            encrypted[middle] ^= 1;
            fs::write(path(&root), encrypted).unwrap();
            assert!(get(&root, AUTH_STORAGE_KEY).is_err());
        }

        #[test]
        fn removing_last_value_removes_the_file() {
            let root = tempfile::tempdir().unwrap();
            let root = root.path().to_path_buf();
            set(&root, AUTH_STORAGE_KEY, "value".into()).unwrap();
            remove(&root, AUTH_STORAGE_KEY).unwrap();
            assert!(!path(&root).exists());
            remove(&root, AUTH_STORAGE_KEY).unwrap();
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod backend {
    use super::*;

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(AUTH_SERVICE, key)
            .map_err(|_| "Unable to access sign-in storage".into())
    }
    pub fn get(_: &PathBuf, key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Unable to read sign-in storage".into()),
        }
    }
    pub fn set(_: &PathBuf, key: &str, value: String) -> Result<(), String> {
        entry(key)?
            .set_password(&value)
            .map_err(|_| "Unable to write sign-in storage".into())
    }
    pub fn remove(_: &PathBuf, key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Unable to clear sign-in storage".into()),
        }
    }
    pub fn reset(_: &PathBuf) -> Result<(), String> {
        for key in [
            AUTH_STORAGE_KEY,
            "sb-clipsx-auth-token-user",
            "sb-clipsx-auth-token-code-verifier",
            "sb-clipsx-auth-token-flows-code-verifier",
        ] {
            remove(&PathBuf::new(), key)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_supabase_session_and_pkce_namespace() {
        for key in [
            AUTH_STORAGE_KEY,
            "sb-clipsx-auth-token-user",
            "sb-clipsx-auth-token-code-verifier",
            "sb-clipsx-auth-token-flows-code-verifier",
            "sb-clipsx-auth-token-flow-0123456789abcdef0123456789abcdef-code-verifier",
        ] {
            assert!(is_supported_key(key), "{key}");
        }
        for key in [
            "other",
            "../sb-clipsx-auth-token",
            "sb-clipsx-auth-token-user-extra",
            "sb-clipsx-auth-token-flow-ABCDEF0123456789abcdef0123456789-code-verifier",
            "sb-clipsx-auth-token-flow-short-code-verifier",
        ] {
            assert!(!is_supported_key(key), "{key}");
        }
    }
}
