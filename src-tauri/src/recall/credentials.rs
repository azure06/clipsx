//! Host-only AI credentials. There is deliberately no renderer read command.
use crate::history::HistoryRepository;
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn storage_failure() -> anyhow::Error {
    crate::failure::FailureCode::CredentialStorageUnavailable
        .failure()
        .into()
}

fn root(repo: &HistoryRepository) -> PathBuf {
    repo.managed_root
        .parent()
        .unwrap_or(&repo.managed_root)
        .join("ai-credentials")
}
fn key(id: &str) -> Result<&str> {
    if uuid::Uuid::parse_str(id)?.to_string() != id {
        bail!("invalid_connection_id");
    }
    Ok(id)
}
pub async fn get(repo: &HistoryRepository, id: &str) -> Result<Option<String>> {
    let id = key(id)?.to_string();
    let root = root(repo);
    let _lock = LOCK.lock().await;
    tokio::task::spawn_blocking(move || read(&root, &id))
        .await
        .map_err(|_| storage_failure())?
        .map_err(|_| storage_failure())
}
pub async fn set(repo: &HistoryRepository, id: &str, value: Option<String>) -> Result<()> {
    let id = key(id)?.to_string();
    if value
        .as_ref()
        .is_some_and(|v| v.is_empty() || v.len() > 8192 || v.chars().any(char::is_control))
    {
        bail!("invalid_credential");
    }
    let root = root(repo);
    let _lock = LOCK.lock().await;
    tokio::task::spawn_blocking(move || write(&root, &id, value.as_deref()))
        .await
        .map_err(|_| storage_failure())?
        .map_err(|_| storage_failure())
}
#[cfg(target_os = "windows")]
fn read(root: &Path, id: &str) -> Result<Option<String>> {
    let path = root.join(format!("{id}.dpapi"));
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => bail!("credential_storage_unavailable"),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 32768 {
        bail!("credential_storage_unavailable");
    }
    let encrypted = std::fs::read(path)?;
    let plaintext =
        crate::auth_storage::unprotect_private_bytes(&encrypted).map_err(anyhow::Error::msg)?;
    if plaintext.len() > 8192 {
        bail!("credential_storage_unavailable");
    }
    Ok(Some(String::from_utf8(plaintext)?))
}
#[cfg(target_os = "windows")]
fn write(root: &Path, id: &str, value: Option<&str>) -> Result<()> {
    use std::io::Write;
    let path = root.join(format!("{id}.dpapi"));
    let Some(value) = value else {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => bail!("credential_storage_unavailable"),
        }
    };
    std::fs::create_dir_all(root)?;
    if std::fs::symlink_metadata(root)?.file_type().is_symlink() {
        bail!("credential_storage_unavailable");
    }
    let encrypted =
        crate::auth_storage::protect_private_bytes(value.as_bytes()).map_err(anyhow::Error::msg)?;
    let mut file = tempfile::NamedTempFile::new_in(root)?;
    file.write_all(&encrypted)?;
    file.as_file().sync_all()?;
    file.persist(path)
        .map_err(|_| anyhow::anyhow!("credential_storage_unavailable"))?;
    Ok(())
}
#[cfg(not(target_os = "windows"))]
fn read(root: &Path, id: &str) -> Result<Option<String>> {
    if !has_reference(root, id)? {
        return Ok(None);
    }
    read_store(root, id)
}
#[cfg(all(not(target_os = "windows"), not(test)))]
fn read_store(_: &Path, id: &str) -> Result<Option<String>> {
    let entry = keyring::Entry::new("com.infiniti.clipsx.ai", id)
        .map_err(|_| anyhow::anyhow!("credential_storage_unavailable"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => bail!("credential_storage_unavailable"),
    }
}
#[cfg(not(target_os = "windows"))]
fn write(root: &Path, id: &str, value: Option<&str>) -> Result<()> {
    if let Some(value) = value {
        write_store(root, id, Some(value))?;
        std::fs::create_dir_all(root)?;
        std::fs::write(root.join(format!("{id}.ref")), b"ai-credential-v1")?;
    } else {
        if !has_reference(root, id)? {
            return Ok(());
        }
        write_store(root, id, None)?;
        std::fs::remove_file(root.join(format!("{id}.ref")))?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn has_reference(root: &Path, id: &str) -> Result<bool> {
    let path = root.join(format!("{id}.ref"));
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            if std::fs::read(path)? != b"ai-credential-v1" {
                bail!("credential_storage_unavailable");
            }
            Ok(true)
        }
        _ => bail!("credential_storage_unavailable"),
    }
}

#[cfg(all(not(target_os = "windows"), not(test)))]
fn write_store(_: &Path, id: &str, value: Option<&str>) -> Result<()> {
    let entry = keyring::Entry::new("com.infiniti.clipsx.ai", id)
        .map_err(|_| anyhow::anyhow!("credential_storage_unavailable"))?;
    match value {
        Some(value) => entry.set_password(value),
        None => match entry.delete_credential() {
            Err(keyring::Error::NoEntry) => Ok(()),
            result => result,
        },
    }
    .map_err(|_| anyhow::anyhow!("credential_storage_unavailable"))
}

// Unit tests never access a developer's desktop keyring. Scope fake entries to
// the temporary profile so concurrent tests and reopen checks remain isolated.
#[cfg(all(test, not(target_os = "windows")))]
mod test_store {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{LazyLock, Mutex},
    };
    static VALUES: LazyLock<Mutex<HashMap<PathBuf, String>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    pub(super) fn read_store(root: &Path, id: &str) -> Result<Option<String>> {
        Ok(VALUES.lock().unwrap().get(&root.join(id)).cloned())
    }
    pub(super) fn write_store(root: &Path, id: &str, value: Option<&str>) -> Result<()> {
        let mut values = VALUES.lock().unwrap();
        if let Some(value) = value {
            values.insert(root.join(id), value.into());
        } else {
            values.remove(&root.join(id));
        }
        Ok(())
    }
}
#[cfg(all(test, not(target_os = "windows")))]
use test_store::{read_store, write_store};

#[cfg(not(target_os = "windows"))]
pub(crate) fn reset_owned(root: &Path) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    if std::fs::symlink_metadata(root)?.file_type().is_symlink() {
        bail!("credential_storage_unavailable");
    }
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|v| v.strip_suffix(".ref")) else {
            continue;
        };
        if key(id).is_ok() {
            write(root, id, None)?;
        }
    }
    Ok(())
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;

    #[test]
    fn absent_credentials_need_no_desktop_store() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("absent");
        let id = uuid::Uuid::now_v7().to_string();
        assert!(read(&root, &id).unwrap().is_none());
        write(&root, &id, None).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn credentials_are_profile_scoped_and_reset_removes_references() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::now_v7().to_string();
        write(first.path(), &id, Some("fixture-secret")).unwrap();
        assert_eq!(
            read(first.path(), &id).unwrap().as_deref(),
            Some("fixture-secret")
        );
        assert!(read(second.path(), &id).unwrap().is_none());
        assert_eq!(
            std::fs::read(first.path().join(format!("{id}.ref"))).unwrap(),
            b"ai-credential-v1"
        );
        reset_owned(first.path()).unwrap();
        assert!(read(first.path(), &id).unwrap().is_none());
        assert!(read_store(first.path(), &id).unwrap().is_none());
    }

    #[test]
    fn invalid_references_are_errors_not_missing_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::now_v7().to_string();
        std::fs::write(temp.path().join(format!("{id}.ref")), b"invalid").unwrap();
        assert_eq!(
            read(temp.path(), &id).unwrap_err().to_string(),
            "credential_storage_unavailable"
        );
        std::fs::remove_file(temp.path().join(format!("{id}.ref"))).unwrap();
        std::os::unix::fs::symlink(
            temp.path().join("missing"),
            temp.path().join(format!("{id}.ref")),
        )
        .unwrap();
        assert!(read(temp.path(), &id).is_err());
    }
}

#[cfg(test)]
mod failure_tests {
    use super::*;

    #[tokio::test]
    async fn unreadable_and_unwritable_storage_returns_a_curated_recoverable_failure() {
        let (_temp, service) = crate::recall::service_tests::repository().await;
        let repo = &service.history;
        std::fs::write(root(repo), b"blocked-storage-path").unwrap();
        let id = uuid::Uuid::now_v7().to_string();
        let write_error = set(repo, &id, Some("fixture-secret-not-for-diagnostics".into()))
            .await
            .unwrap_err();
        std::fs::remove_file(root(repo)).unwrap();
        std::fs::create_dir_all(root(repo)).unwrap();
        #[cfg(target_os = "windows")]
        std::fs::write(
            root(repo).join(format!("{id}.dpapi")),
            b"invalid-protected-data",
        )
        .unwrap();
        #[cfg(not(target_os = "windows"))]
        std::fs::write(root(repo).join(format!("{id}.ref")), b"invalid-reference").unwrap();
        let read_error = get(repo, &id).await.unwrap_err();
        for error in [write_error, read_error] {
            let failure = crate::recall::service::public_failure(error);
            assert_eq!(
                failure.code,
                crate::failure::FailureCode::CredentialStorageUnavailable
            );
            assert_eq!(failure.recovery, crate::failure::Recovery::Wait);
            let serialized = serde_json::to_string(&failure).unwrap();
            assert!(!serialized.contains("fixture-secret"));
            assert!(!serialized.contains("blocked-storage-path"));
        }
    }
}
