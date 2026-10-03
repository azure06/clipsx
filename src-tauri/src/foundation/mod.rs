//! Storage roots, database preparation, managed files, and reset behavior.
mod migrations;
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

pub const SCHEMA_ID: &str = "clipsx-local-v3";
pub const SCHEMA_VERSION: i64 = 15;
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemaState {
    Ready,
    LegacyResetRequired,
    UnsupportedSchema,
    NewerSchema(i64),
    MigrationChanged(i64),
    MissingMigration(i64),
    IncompleteMigration(i64),
    StartupFailed,
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
    pub fn share_staging(&self) -> PathBuf {
        self.data.join("share-staging")
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
    let migrator = migrations::canonical();
    migrations::repair_line_endings(&mut connection, &database, &migrator).await?;
    match migrator.run(&mut connection).await {
        Ok(()) => Ok(SchemaState::Ready),
        Err(sqlx::migrate::MigrateError::Dirty(version)) => {
            Ok(SchemaState::IncompleteMigration(version))
        }
        Err(sqlx::migrate::MigrateError::VersionMissing(version)) => {
            Ok(SchemaState::MissingMigration(version))
        }
        Err(sqlx::migrate::MigrateError::VersionMismatch(version)) => {
            Ok(SchemaState::MigrationChanged(version))
        }
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
            if row.as_ref().is_some_and(|(id, version)| {
                id == SCHEMA_ID && (15..=SCHEMA_VERSION).contains(version)
            }) {
                SchemaState::Ready
            } else {
                match row {
                    Some((id, version)) if id == SCHEMA_ID && version > SCHEMA_VERSION => {
                        SchemaState::NewerSchema(version)
                    }
                    _ => SchemaState::UnsupportedSchema,
                }
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
    let (code, message, version) = match state {
        SchemaState::Ready => ("ready", "ClipsX storage is ready.", None),
        SchemaState::LegacyResetRequired => ("legacy_reset_required", "This database uses a retired schema. Your data has been preserved. Export diagnostics before deciding whether to reset.", None),
        SchemaState::UnsupportedSchema => ("unsupported_schema", "This database schema is not supported. Your data has been preserved. Use a compatible build or export diagnostics.", None),
        SchemaState::NewerSchema(version) => ("newer_schema", "This database requires a newer ClipsX build. Open it with that build; do not reset your data.", Some(version)),
        SchemaState::MigrationChanged(version) => ("migration_changed", "An applied migration differs from this build. Your data has been preserved. Rebuild from the matching migration source or export diagnostics.", Some(version)),
        SchemaState::MissingMigration(version) => ("missing_migration", "This database contains a migration unavailable in this build. Use a newer compatible build; your data has been preserved.", Some(version)),
        SchemaState::IncompleteMigration(version) => ("incomplete_migration", "A database migration did not finish. Your data has been preserved. Export diagnostics before attempting recovery.", Some(version)),
        SchemaState::StartupFailed => ("startup_failed", "ClipsX could not finish starting. Your data has been preserved. Open logs or export diagnostics for the technical details.", None),
    };
    StartupStatus {
        state: code.into(),
        message: message.into(),
        reset_available: matches!(
            state,
            SchemaState::LegacyResetRequired
                | SchemaState::UnsupportedSchema
                | SchemaState::MigrationChanged(_)
                | SchemaState::IncompleteMigration(_)
        ),
        migration_version: version,
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
        // Reopening must accept both the metadata and migration checksums.
        // A successful first creation alone can conceal a reset loop.
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
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
    async fn blocks_unknown_older_baseline_without_deleting_data() {
        let root = TempDir::new().unwrap();
        let path = root.path().join("old-v2.db");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("CREATE TABLE system_schema_meta(schema_id TEXT,schema_version INTEGER,created_at INTEGER)")
            .execute(&mut conn).await.unwrap();
        sqlx::query("INSERT INTO system_schema_meta VALUES('clipsx-local-v3',1,0)")
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
    async fn reports_changed_migration_without_deleting_data() {
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
            SchemaState::MigrationChanged(2)
        );
    }

    #[tokio::test]
    async fn repairs_only_published_crlf_checksums_and_keeps_wal_data() {
        let temp = TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
        let mut connection = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(roots.database())
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO config_device_values VALUES('test-preserved','true',0,0)")
            .execute(&mut connection)
            .await
            .unwrap();
        let migrator = migrations::canonical();
        for migration in migrator.iter() {
            let crlf = migration.sql.as_str().replace("\n", "\r\n");
            let hash = sha2::Sha384::digest(crlf.as_bytes()).to_vec();
            sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
                .bind(hash)
                .bind(migration.version)
                .execute(&mut connection)
                .await
                .unwrap();
        }
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT value_json FROM config_device_values WHERE key='test-preserved'"
            )
            .fetch_one(&mut connection)
            .await
            .unwrap(),
            "true"
        );
        let backups = fs::read_dir(&roots.data)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("clips-before-checksum-repair-")
            })
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        let mut backup = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(backups[0].path())
                .read_only(true),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT value_json FROM config_device_values WHERE key='test-preserved'"
            )
            .fetch_one(&mut backup)
            .await
            .unwrap(),
            "true"
        );
    }

    #[tokio::test]
    async fn interrupted_checksum_repair_rolls_back_all_updates() {
        let temp = TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        prepare(&roots).await.unwrap();
        let mut connection =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(roots.database()))
                .await
                .unwrap();
        for migration in migrations::canonical().iter().take(2) {
            let hash = sha2::Sha384::digest(migration.sql.as_str().replace("\n", "\r\n")).to_vec();
            sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
                .bind(hash)
                .bind(migration.version)
                .execute(&mut connection)
                .await
                .unwrap();
        }
        let before: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&mut connection)
                .await
                .unwrap();
        sqlx::query("CREATE TRIGGER fail_repair BEFORE UPDATE ON _sqlx_migrations WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'test interruption'); END").execute(&mut connection).await.unwrap();
        assert!(prepare(&roots).await.is_err());
        let after: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&mut connection)
                .await
                .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn completes_pending_known_migrations_and_rejects_newer_ledgers() {
        let temp = TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        fs::create_dir_all(&roots.data).unwrap();
        let mut connection = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(roots.database())
                .create_if_missing(true),
        )
        .await
        .unwrap();
        let mut partial = migrations::canonical();
        partial.migrations = std::borrow::Cow::Owned(partial.iter().take(1).cloned().collect());
        partial.run(&mut connection).await.unwrap();
        assert_eq!(prepare(&roots).await.unwrap(), SchemaState::Ready);
        sqlx::query("UPDATE _sqlx_migrations SET success=0 WHERE version=2")
            .execute(&mut connection)
            .await
            .unwrap();
        assert_eq!(
            prepare(&roots).await.unwrap(),
            SchemaState::IncompleteMigration(2)
        );
        sqlx::query("UPDATE _sqlx_migrations SET success=1 WHERE version=2")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(999,'future',1,X'',0)").execute(&mut connection).await.unwrap();
        assert_eq!(
            prepare(&roots).await.unwrap(),
            SchemaState::MissingMigration(999)
        );
        assert!(!startup_status(SchemaState::NewerSchema(16)).reset_available);
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
