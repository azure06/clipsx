//! Owns the disposable SQLite sidecar for one semantic-index generation.

use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Component, Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
    Connection, Row, SqliteConnection,
};

pub const SIDECAR_SCHEMA_VERSION: i64 = 1;
pub const BACKEND_ID: &str = "builtin.quantized-flat.v1";
pub const VECTOR_ENCODING: &str = "int8_scan_float32_rerank";
pub const DEFAULT_CANDIDATE_LIMIT: i64 = 100;

const SCHEMA: &str = r#"
CREATE TABLE semantic_sidecar_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL,
    generation_id TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    backend_id TEXT NOT NULL,
    vector_encoding TEXT NOT NULL,
    candidate_limit INTEGER NOT NULL CHECK (candidate_limit > 0),
    complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1))
) STRICT;

CREATE TABLE semantic_clips (
    clip_ordinal INTEGER PRIMARY KEY CHECK (clip_ordinal >= 0),
    clip_id TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE semantic_inputs (
    input_ordinal INTEGER PRIMARY KEY CHECK (input_ordinal >= 0),
    input_hash TEXT NOT NULL UNIQUE,
    vector_f32 BLOB NOT NULL,
    vector_i8 BLOB NOT NULL
) STRICT;

CREATE TABLE semantic_chunks (
    chunk_ordinal INTEGER PRIMARY KEY CHECK (chunk_ordinal >= 0),
    chunk_id TEXT NOT NULL UNIQUE,
    clip_ordinal INTEGER NOT NULL REFERENCES semantic_clips(clip_ordinal),
    input_ordinal INTEGER NOT NULL REFERENCES semantic_inputs(input_ordinal),
    ordinal_in_clip INTEGER NOT NULL CHECK (ordinal_in_clip >= 0),
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    representation_id TEXT,
    artifact_id TEXT,
    source_manifest TEXT NOT NULL,
    projection_hash TEXT NOT NULL,
    chunker_id TEXT NOT NULL,
    chunker_version INTEGER NOT NULL CHECK (chunker_version > 0),
    UNIQUE (clip_ordinal, ordinal_in_clip)
) STRICT;

CREATE INDEX semantic_chunks_by_clip ON semantic_chunks(clip_ordinal);
CREATE INDEX semantic_chunks_by_input ON semantic_chunks(input_ordinal);

CREATE TRIGGER semantic_inputs_validate_lengths
BEFORE INSERT ON semantic_inputs
BEGIN
    SELECT CASE
        WHEN length(NEW.vector_f32) != (SELECT dimensions * 4 FROM semantic_sidecar_meta WHERE singleton = 1)
        THEN RAISE(ABORT, 'float32 vector length does not match dimensions')
    END;
    SELECT CASE
        WHEN length(NEW.vector_i8) != (SELECT dimensions FROM semantic_sidecar_meta WHERE singleton = 1)
        THEN RAISE(ABORT, 'int8 vector length does not match dimensions')
    END;
END;
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalizedSidecar {
    pub relative_path: String,
    pub byte_length: u64,
    pub sha256: String,
}

pub struct BuildingSidecar {
    connection: SqliteConnection,
    path: PathBuf,
    relative_path: String,
}

impl BuildingSidecar {
    /// Marks the sidecar complete, closes SQLite, and returns its immutable identity.
    pub async fn finalize(self) -> Result<FinalizedSidecar> {
        let BuildingSidecar {
            mut connection,
            path,
            relative_path,
        } = self;

        sqlx::query("UPDATE semantic_sidecar_meta SET complete = 1 WHERE singleton = 1")
            .execute(&mut connection)
            .await?;
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&mut connection)
            .await?;
        connection.close().await?;

        Ok(FinalizedSidecar {
            relative_path,
            byte_length: fs::metadata(&path)?.len(),
            sha256: file_sha256(&path)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SemanticIndexStore {
    root: PathBuf,
}

impl SemanticIndexStore {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create semantic index root {}", root.display()))?;
        if fs::symlink_metadata(&root)?.file_type().is_symlink() {
            bail!("semantic index root cannot be a symbolic link");
        }
        Ok(Self { root })
    }

    /// Creates a new, incomplete generation. Existing generations are never overwritten.
    pub async fn create(&self, generation_id: &str, dimensions: usize) -> Result<BuildingSidecar> {
        validate_generation_id(generation_id)?;
        if dimensions == 0 {
            bail!("semantic vector dimensions must be greater than zero");
        }
        let relative_path = format!("generation-{generation_id}.sqlite");
        let path = self.resolve(&relative_path)?;
        if path.exists() {
            bail!("semantic generation sidecar already exists");
        }

        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await?;
        if let Err(error) = async {
            sqlx::raw_sql(SCHEMA).execute(&mut connection).await?;
            sqlx::query(
                "INSERT INTO semantic_sidecar_meta
                 (singleton, schema_version, generation_id, dimensions, backend_id,
                  vector_encoding, candidate_limit, complete)
                 VALUES (1, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(SIDECAR_SCHEMA_VERSION)
            .bind(generation_id)
            .bind(i64::try_from(dimensions)?)
            .bind(BACKEND_ID)
            .bind(VECTOR_ENCODING)
            .bind(DEFAULT_CANDIDATE_LIMIT)
            .execute(&mut connection)
            .await?;
            Ok::<_, anyhow::Error>(())
        }
        .await
        {
            let _ = connection.close().await;
            remove_sqlite_files(&path)?;
            return Err(error);
        }

        Ok(BuildingSidecar {
            connection,
            path,
            relative_path,
        })
    }

    /// Validates identity, format, completeness, checksum, and SQLite integrity.
    pub async fn validate(
        &self,
        relative_path: &str,
        generation_id: &str,
        dimensions: usize,
        expected_sha256: Option<&str>,
    ) -> Result<()> {
        validate_generation_id(generation_id)?;
        let path = self.resolve(relative_path)?;
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("semantic sidecar is missing: {}", path.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            bail!("semantic sidecar must be a regular file");
        }
        if let Some(expected) = expected_sha256 {
            if !expected.eq_ignore_ascii_case(&file_sha256(&path)?) {
                bail!("semantic sidecar checksum does not match");
            }
        }

        let options = SqliteConnectOptions::new()
            .filename(&path)
            .read_only(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await?;
        let meta = sqlx::query(
            "SELECT schema_version, generation_id, dimensions, backend_id,
                    vector_encoding, candidate_limit, complete
             FROM semantic_sidecar_meta WHERE singleton = 1",
        )
        .fetch_one(&mut connection)
        .await?;
        if meta.get::<i64, _>("schema_version") != SIDECAR_SCHEMA_VERSION
            || meta.get::<String, _>("generation_id") != generation_id
            || meta.get::<i64, _>("dimensions") != i64::try_from(dimensions)?
            || meta.get::<String, _>("backend_id") != BACKEND_ID
            || meta.get::<String, _>("vector_encoding") != VECTOR_ENCODING
            || meta.get::<i64, _>("candidate_limit") != DEFAULT_CANDIDATE_LIMIT
            || meta.get::<i64, _>("complete") != 1
        {
            bail!("semantic sidecar metadata does not match the requested generation");
        }
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&mut connection)
            .await?;
        if integrity != "ok" {
            bail!("semantic sidecar failed SQLite integrity check: {integrity}");
        }
        connection.close().await?;
        Ok(())
    }

    /// Removes only the validated generation filename and its SQLite transient files.
    pub fn remove(&self, relative_path: &str) -> Result<()> {
        let path = self.resolve(relative_path)?;
        remove_sqlite_files(&path)
    }

    fn resolve(&self, relative_path: &str) -> Result<PathBuf> {
        let relative = Path::new(relative_path);
        if relative.components().count() != 1
            || !matches!(relative.components().next(), Some(Component::Normal(_)))
            || relative.extension().and_then(|value| value.to_str()) != Some("sqlite")
        {
            bail!("semantic sidecar path must be one relative SQLite filename");
        }
        Ok(self.root.join(relative))
    }
}

fn validate_generation_id(generation_id: &str) -> Result<()> {
    if generation_id.is_empty()
        || generation_id.len() > 80
        || !generation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        bail!("generation id must contain only ASCII letters, numbers, and hyphens");
    }
    Ok(())
}

fn remove_sqlite_files(path: &Path) -> Result<()> {
    for candidate in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        match fs::remove_file(&candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn finalized_sidecar_is_valid_disposable_and_isolated_from_canonical_data() {
        let directory = tempdir().unwrap();
        let canonical = directory.path().join("clips.db");
        fs::write(&canonical, b"canonical clip data").unwrap();
        let canonical_before = file_sha256(&canonical).unwrap();
        let store = SemanticIndexStore::new(directory.path().join("search-index")).unwrap();
        let mut building = store.create("generation-01", 3).await.unwrap();

        sqlx::query("INSERT INTO semantic_clips (clip_ordinal, clip_id) VALUES (0, 'clip-1')")
            .execute(&mut building.connection)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO semantic_inputs (input_ordinal, input_hash, vector_f32, vector_i8)
             VALUES (0, 'hash-1', ?, ?)",
        )
        .bind(vec![0_u8; 12])
        .bind(vec![0_u8; 3])
        .execute(&mut building.connection)
        .await
        .unwrap();

        let finalized = building.finalize().await.unwrap();
        assert!(finalized.byte_length > 0);
        store
            .validate(
                &finalized.relative_path,
                "generation-01",
                3,
                Some(&finalized.sha256),
            )
            .await
            .unwrap();

        store.remove(&finalized.relative_path).unwrap();
        store.remove(&finalized.relative_path).unwrap();
        assert_eq!(file_sha256(&canonical).unwrap(), canonical_before);
        assert_eq!(fs::read(&canonical).unwrap(), b"canonical clip data");
    }

    #[tokio::test]
    async fn rejects_unsafe_paths_invalid_dimensions_and_corruption() {
        let directory = tempdir().unwrap();
        let store = SemanticIndexStore::new(directory.path()).unwrap();
        assert!(store.create("bad/id", 3).await.is_err());
        assert!(store.create("valid", 0).await.is_err());
        assert!(store.remove("../clips.db").is_err());

        let finalized = store
            .create("valid", 3)
            .await
            .unwrap()
            .finalize()
            .await
            .unwrap();
        let path = directory.path().join(&finalized.relative_path);
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_len(16).unwrap();
        assert!(store
            .validate(
                &finalized.relative_path,
                "valid",
                3,
                Some(&finalized.sha256),
            )
            .await
            .is_err());
    }
}
