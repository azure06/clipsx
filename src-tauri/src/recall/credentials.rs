//! Host-only AI credentials. There is deliberately no renderer read command.
use crate::history::HistoryRepository;
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
    tokio::task::spawn_blocking(move || read(&root, &id)).await?
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
    tokio::task::spawn_blocking(move || write(&root, &id, value.as_deref())).await?
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
fn read(_: &Path, id: &str) -> Result<Option<String>> {
    let entry = keyring::Entry::new("com.infiniti.clipsx.ai", id)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => bail!("credential_storage_unavailable"),
    }
}
#[cfg(not(target_os = "windows"))]
fn write(root: &Path, id: &str, value: Option<&str>) -> Result<()> {
    let entry = keyring::Entry::new("com.infiniti.clipsx.ai", id)?;
    if let Some(value) = value {
        entry.set_password(value)?;
        std::fs::create_dir_all(root)?;
        std::fs::write(root.join(format!("{id}.ref")), b"ai-credential-v1")?;
    } else {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(_) => bail!("credential_storage_unavailable"),
        }
        let _ = std::fs::remove_file(root.join(format!("{id}.ref")));
    }
    Ok(())
}

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
