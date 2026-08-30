//! Storage roots, database preparation, managed files, and reset behavior.
use crate::contracts::{FactoryResetResult, StartupStatus};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    str::FromStr,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

pub const SCHEMA_ID: &str = "clipsx-local-v2";
pub const SCHEMA_VERSION: i64 = 8;
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemaState {
    Ready,
    LegacyResetRequired,
    UnsupportedSchema,
}

#[derive(Debug, Clone)]
pub struct AppRoots {
    pub data: PathBuf,
    pub config: PathBuf,
}
impl AppRoots {
    pub fn from_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self> {
        Ok(Self {
            data: app
                .path()
                .app_data_dir()
                .context("Cannot resolve app data directory")?,
            config: app
                .path()
                .app_config_dir()
                .context("Cannot resolve app config directory")?,
        })
    }
    pub fn database(&self) -> PathBuf {
        self.data.join("clips.db")
    }
    pub fn clipboard_data(&self) -> PathBuf {
        self.data.join("clipboard_data")
    }
    pub fn extensions(&self) -> PathBuf {
        self.data.join("extensions")
    }
    pub fn search_index(&self) -> PathBuf {
        self.data.join("search-index")
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct StagedManagedFile {
    pub sha256: String,
    pub byte_length: u64,
    pub relative_path: PathBuf,
    staging_path: PathBuf,
}
pub struct ManagedFileStore {
    root: PathBuf,
}
#[allow(dead_code)]
impl ManagedFileStore {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("staging"))?;
        Ok(Self { root })
    }
    pub fn stage(&self, category: &str, bytes: &[u8]) -> Result<StagedManagedFile> {
        if !matches!(
            category,
            "images" | "office" | "pdf" | "svg" | "native" | "binary" | "derived"
        ) {
            bail!("unsupported managed-file category");
        }
        let mut hash = Sha256::new();
        hash.update(bytes);
        let sha256 = format!("{:x}", hash.finalize());
        let relative_path = PathBuf::from("managed")
            .join(category)
            .join(&sha256[..2])
            .join(&sha256);
        let staging_path = self.root.join("staging").join(format!(
            "{sha256}.{}.{}.{}.pending",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(StagedManagedFile {
            sha256,
            byte_length: bytes.len() as u64,
            relative_path,
            staging_path,
        })
    }
    pub fn commit(&self, staged: StagedManagedFile) -> Result<PathBuf> {
        if !staged.staging_path.starts_with(self.root.join("staging"))
            || staged
                .relative_path
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::RootDir))
        {
            bail!("invalid managed-file path");
        }
        let destination = self.root.join(&staged.relative_path);
        let parent = destination
            .parent()
            .context("managed-file destination has no parent")?;
        fs::create_dir_all(parent)?;
        if destination.exists() {
            fs::remove_file(&staged.staging_path)?;
        } else {
            fs::rename(&staged.staging_path, &destination)?;
        }
        Ok(destination)
    }
    #[allow(dead_code)]
    pub fn reconcile_staging(&self) -> Result<Vec<PathBuf>> {
        let staging = self.root.join("staging");
        if !staging.exists() {
            return Ok(Vec::new());
        }
        let mut removed = Vec::new();
        for entry in fs::read_dir(staging)? {
            let path = entry?.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.is_file() || metadata.file_type().is_symlink() {
                fs::remove_file(&path)?;
                removed.push(path);
            }
        }
        Ok(removed)
    }
}

pub async fn prepare(roots: &AppRoots) -> Result<SchemaState> {
    fs::create_dir_all(&roots.data)?;
    fs::create_dir_all(&roots.config)?;
    let database = roots.database();
    if database.exists() {
        let state = inspect_database(&database).await?;
        if state != SchemaState::Ready {
            return Ok(state);
        }
    }
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", database.display()))?
        .create_if_missing(true)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    match sqlx::migrate!("./migrations").run(&mut connection).await {
        Ok(()) => Ok(SchemaState::Ready),
        Err(
            sqlx::migrate::MigrateError::Dirty(_)
            | sqlx::migrate::MigrateError::VersionMissing(_)
            | sqlx::migrate::MigrateError::VersionMismatch(_),
        ) => Ok(SchemaState::UnsupportedSchema),
        Err(error) => Err(error.into()),
    }
}

async fn inspect_database(path: &Path) -> Result<SchemaState> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    let has_meta: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'system_schema_meta')").fetch_one(&mut connection).await?;
    if has_meta {
        let row: Option<(String, i64)> =
            sqlx::query_as("SELECT schema_id,schema_version FROM system_schema_meta LIMIT 1")
                .fetch_optional(&mut connection)
                .await?;
        return Ok(
            if row
                .as_ref()
                .is_some_and(|(id, version)| id == SCHEMA_ID && *version == SCHEMA_VERSION)
            {
                SchemaState::Ready
            } else {
                SchemaState::UnsupportedSchema
            },
        );
    }
    let legacy: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('clips', 'embeddings', 'vault_items'))").fetch_one(&mut connection).await?;
    Ok(if legacy {
        SchemaState::LegacyResetRequired
    } else {
        SchemaState::UnsupportedSchema
    })
}

pub fn startup_status(state: SchemaState) -> StartupStatus {
    match state {
        SchemaState::Ready => StartupStatus { state: "ready".into(), message: "ClipsX v2 storage is ready.".into(), reset_available: false },
        SchemaState::LegacyResetRequired => StartupStatus { state: "legacy_reset_required".into(), message: "This ClipsX database uses the retired schema. Factory reset is required; data is not migrated.".into(), reset_available: true },
        SchemaState::UnsupportedSchema => StartupStatus { state: "unsupported_schema".into(), message: "The local database is not a supported ClipsX v2 schema. Factory reset is required.".into(), reset_available: true },
    }
}

pub fn factory_reset(roots: &AppRoots, confirmation: &str) -> Result<FactoryResetResult> {
    if confirmation != "RESET CLIPSX" {
        bail!("Factory reset confirmation did not match");
    }
    let mut deleted = Vec::new();
    let mut failures = Vec::new();
    for path in [
        roots.database(),
        roots.database().with_extension("db-wal"),
        roots.database().with_extension("db-shm"),
        roots.clipboard_data(),
        roots.extensions(),
        roots.search_index(),
    ] {
        match remove_owned(&path, &roots.data) {
            Ok(true) => deleted.push(path.display().to_string()),
            Ok(false) => {}
            Err(error) => failures.push(format!("{}: {error}", path.display())),
        }
    }
    for path in [
        roots.data.join("models"),
        roots.data.join("text-search-state.json"),
        roots.data.join("image-search-state.json"),
        roots.config.join("settings.json"),
        roots.config.join("entitlement.json"),
        roots.config.join("credential-registry.json"),
    ] {
        match remove_owned(
            &path,
            if path.starts_with(&roots.data) {
                &roots.data
            } else {
                &roots.config
            },
        ) {
            Ok(true) => deleted.push(path.display().to_string()),
            Ok(false) => {}
            Err(error) => failures.push(format!("{}: {error}", path.display())),
        }
    }
    clear_known_credentials(&mut failures);
    Ok(FactoryResetResult {
        deleted,
        failures,
        restart_required: true,
    })
}

fn remove_owned(target: &Path, root: &Path) -> Result<bool> {
    if !target.starts_with(root)
        || target == root
        || target
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        bail!("refusing unsafe reset target");
    }
    if !target.exists() {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(target)?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(target)?;
    } else {
        fs::remove_dir_all(target)?;
    }
    Ok(true)
}

fn clear_known_credentials(failures: &mut Vec<String>) {
    for key in ["sb-clipsx-auth-token", "sb-clipsx-auth-token-code-verifier"] {
        for suffix in
            std::iter::once(String::new()).chain((0..32).map(|index| format!("-chunk-{index}")))
        {
            if let Ok(entry) = keyring::Entry::new("com.infiniti.clipsx", &format!("{key}{suffix}"))
            {
                if let Err(error) = entry.delete_credential() {
                    if !matches!(error, keyring::Error::NoEntry) {
                        failures.push(format!("credential {key}{suffix}: {error}"));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    #[tokio::test]
    async fn initializes_fresh_baseline() {
        let root = TempDir::new().unwrap();
        let roots = AppRoots {
            data: root.path().join("data"),
            config: root.path().join("config"),
        };
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
        assert_eq!(
            inspect_database(&roots.database()).await.unwrap(),
            SchemaState::Ready
        );
    }
    #[tokio::test]
    async fn rejects_legacy_database() {
        let root = TempDir::new().unwrap();
        let path = root.path().join("legacy.db");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("CREATE TABLE clips (id TEXT)")
            .execute(&mut conn)
            .await
            .unwrap();
        drop(conn);
        assert_eq!(
            inspect_database(&path).await.unwrap(),
            SchemaState::LegacyResetRequired
        );
    }
    #[tokio::test]
    async fn requires_reset_for_an_older_v2_schema_version() {
        let root = TempDir::new().unwrap();
        let path = root.path().join("old-v2.db");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("CREATE TABLE system_schema_meta(schema_id TEXT,schema_version INTEGER,created_at INTEGER)")
            .execute(&mut conn).await.unwrap();
        sqlx::query("INSERT INTO system_schema_meta VALUES('clipsx-local-v2',1,0)")
            .execute(&mut conn)
            .await
            .unwrap();
        drop(conn);
        assert_eq!(
            inspect_database(&path).await.unwrap(),
            SchemaState::UnsupportedSchema
        );
    }
    #[tokio::test]
    async fn requires_reset_when_an_applied_migration_checksum_changes() {
        let root = TempDir::new().unwrap();
        let roots = AppRoots {
            data: root.path().join("data"),
            config: root.path().join("config"),
        };
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);

        let mut connection =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(roots.database()))
                .await
                .unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum=X'' WHERE version=2")
            .execute(&mut connection)
            .await
            .unwrap();
        drop(connection);

        assert_eq!(
            prepare(&roots).await.unwrap(),
            SchemaState::UnsupportedSchema
        );
    }
    #[test]
    fn reset_requires_exact_confirmation() {
        let root = TempDir::new().unwrap();
        let roots = AppRoots {
            data: root.path().join("data"),
            config: root.path().join("config"),
        };
        assert!(factory_reset(&roots, "no").is_err());
    }
    #[test]
    fn reset_removes_the_owned_search_index_root() {
        let root = TempDir::new().unwrap();
        let roots = AppRoots {
            data: root.path().join("data"),
            config: root.path().join("config"),
        };
        fs::create_dir_all(roots.search_index()).unwrap();
        fs::write(
            roots.search_index().join("generation-test.sqlite"),
            b"derived",
        )
        .unwrap();
        let result = factory_reset(&roots, "RESET CLIPSX").unwrap();
        assert!(!roots.search_index().exists());
        assert!(result
            .deleted
            .iter()
            .any(|path| path.ends_with("search-index")));
    }
    #[test]
    fn managed_file_stages_and_deduplicates_by_hash() {
        let root = TempDir::new().unwrap();
        let store = ManagedFileStore::new(root.path().to_path_buf()).unwrap();
        let one = store.stage("images", b"same").unwrap();
        let path = store.commit(one).unwrap();
        let two = store.stage("images", b"same").unwrap();
        let second = store.commit(two).unwrap();
        assert_eq!(path, second);
        assert_eq!(fs::read(path).unwrap(), b"same");
    }
    #[test]
    fn platform_matrix_has_all_supported_platforms() {
        let matrix: serde_json::Value =
            serde_json::from_str(include_str!("../../../docs/platform-format-matrix.json"))
                .unwrap();
        let formats = matrix["capabilities"].as_array().unwrap();
        for platform in ["macos", "windows", "linux_x11"] {
            assert!(formats.iter().any(|entry| entry["platform"] == platform));
        }
    }
}
