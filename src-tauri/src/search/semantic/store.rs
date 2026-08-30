//! Owns the disposable SQLite sidecar for one semantic-index generation.

use std::{
    collections::HashMap,
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
    chunker_version TEXT NOT NULL,
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

/// One fully prepared chunk written through the generation's single writer.
/// The input hash covers the complete provider input, including bounded context.
#[derive(Debug, Clone)]
pub struct SidecarChunk {
    pub input_hash: String,
    pub vector: Vec<f32>,
    pub kind: String,
    pub text: String,
    pub representation_id: Option<String>,
    pub artifact_id: Option<String>,
    pub source_manifest: String,
    pub projection_hash: String,
    pub chunker_id: String,
    pub chunker_version: String,
}

impl BuildingSidecar {
    /// Atomically replaces all derived semantic rows for one clip.
    ///
    /// Clip ordinals survive replacements. Equal complete embedding inputs share
    /// one vector row, and inputs no longer referenced by any chunk are removed.
    pub async fn replace_clip(&mut self, clip_id: &str, chunks: &[SidecarChunk]) -> Result<()> {
        if clip_id.is_empty() {
            bail!("semantic clip id cannot be empty");
        }
        let dimensions: i64 =
            sqlx::query_scalar("SELECT dimensions FROM semantic_sidecar_meta WHERE singleton = 1")
                .fetch_one(&mut self.connection)
                .await?;
        let dimensions = usize::try_from(dimensions)?;
        let prepared = chunks
            .iter()
            .map(|chunk| prepare_chunk(chunk, dimensions))
            .collect::<Result<Vec<_>>>()?;

        let mut transaction = self.connection.begin().await?;
        let clip_ordinal = if let Some(ordinal) = sqlx::query_scalar::<_, i64>(
            "SELECT clip_ordinal FROM semantic_clips WHERE clip_id = ?",
        )
        .bind(clip_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            ordinal
        } else {
            let ordinal: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(clip_ordinal) + 1, 0) FROM semantic_clips")
                    .fetch_one(&mut *transaction)
                    .await?;
            sqlx::query("INSERT INTO semantic_clips (clip_ordinal, clip_id) VALUES (?, ?)")
                .bind(ordinal)
                .bind(clip_id)
                .execute(&mut *transaction)
                .await?;
            ordinal
        };

        let old_chunk_ordinals: HashMap<i64, i64> = sqlx::query_as(
            "SELECT ordinal_in_clip, chunk_ordinal FROM semantic_chunks WHERE clip_ordinal = ?",
        )
        .bind(clip_ordinal)
        .fetch_all(&mut *transaction)
        .await?
        .into_iter()
        .collect();
        let mut next_chunk_ordinal: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(chunk_ordinal) + 1, 0) FROM semantic_chunks")
                .fetch_one(&mut *transaction)
                .await?;
        sqlx::query("DELETE FROM semantic_chunks WHERE clip_ordinal = ?")
            .bind(clip_ordinal)
            .execute(&mut *transaction)
            .await?;

        for (ordinal_in_clip, chunk) in prepared.into_iter().enumerate() {
            let ordinal_in_clip = i64::try_from(ordinal_in_clip)?;
            let chunk_ordinal = old_chunk_ordinals
                .get(&ordinal_in_clip)
                .copied()
                .unwrap_or_else(|| {
                    let ordinal = next_chunk_ordinal;
                    next_chunk_ordinal += 1;
                    ordinal
                });
            let input_ordinal = if let Some(ordinal) = sqlx::query_scalar::<_, i64>(
                "SELECT input_ordinal FROM semantic_inputs WHERE input_hash = ?",
            )
            .bind(&chunk.source.input_hash)
            .fetch_optional(&mut *transaction)
            .await?
            {
                ordinal
            } else {
                let ordinal: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(input_ordinal) + 1, 0) FROM semantic_inputs",
                )
                .fetch_one(&mut *transaction)
                .await?;
                sqlx::query(
                    "INSERT INTO semantic_inputs
                     (input_ordinal, input_hash, vector_f32, vector_i8) VALUES (?, ?, ?, ?)",
                )
                .bind(ordinal)
                .bind(&chunk.source.input_hash)
                .bind(&chunk.vector_f32)
                .bind(&chunk.vector_i8)
                .execute(&mut *transaction)
                .await?;
                ordinal
            };
            sqlx::query(
                "INSERT INTO semantic_chunks (
                    chunk_ordinal, chunk_id, clip_ordinal, input_ordinal, ordinal_in_clip,
                    kind, text, representation_id, artifact_id, source_manifest,
                    projection_hash, chunker_id, chunker_version
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(chunk_ordinal)
            .bind(format!("{clip_id}:{ordinal_in_clip}"))
            .bind(clip_ordinal)
            .bind(input_ordinal)
            .bind(ordinal_in_clip)
            .bind(&chunk.source.kind)
            .bind(&chunk.source.text)
            .bind(&chunk.source.representation_id)
            .bind(&chunk.source.artifact_id)
            .bind(&chunk.source.source_manifest)
            .bind(&chunk.source.projection_hash)
            .bind(&chunk.source.chunker_id)
            .bind(&chunk.source.chunker_version)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "DELETE FROM semantic_inputs
             WHERE NOT EXISTS (
                 SELECT 1 FROM semantic_chunks
                 WHERE semantic_chunks.input_ordinal = semantic_inputs.input_ordinal
             )",
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

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

struct PreparedChunk<'a> {
    source: &'a SidecarChunk,
    vector_f32: Vec<u8>,
    vector_i8: Vec<u8>,
}

fn prepare_chunk(chunk: &SidecarChunk, dimensions: usize) -> Result<PreparedChunk<'_>> {
    if chunk.input_hash.len() != 64
        || !chunk
            .input_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        bail!("semantic input hash must be a 64-character hexadecimal SHA-256");
    }
    if chunk.vector.len() != dimensions || chunk.vector.iter().any(|value| !value.is_finite()) {
        bail!("semantic vector dimensions or values are invalid");
    }
    if chunk.kind.is_empty()
        || chunk.text.is_empty()
        || chunk.source_manifest.is_empty()
        || chunk.projection_hash.is_empty()
        || chunk.chunker_id.is_empty()
        || chunk.chunker_version.is_empty()
    {
        bail!("semantic chunk metadata cannot be empty");
    }
    let mut vector_f32 = Vec::with_capacity(dimensions * 4);
    let mut vector_i8 = Vec::with_capacity(dimensions);
    for value in &chunk.vector {
        vector_f32.extend_from_slice(&value.to_le_bytes());
        let quantized = (value.clamp(-1.0, 1.0) * 127.0).round() as i8;
        vector_i8.push(quantized as u8);
    }
    Ok(PreparedChunk {
        source: chunk,
        vector_f32,
        vector_i8,
    })
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

    fn chunk(hash_digit: char, text: &str, vector: Vec<f32>) -> SidecarChunk {
        SidecarChunk {
            input_hash: hash_digit.to_string().repeat(64),
            vector,
            kind: "paragraph".into(),
            text: text.into(),
            representation_id: Some("representation-1".into()),
            artifact_id: None,
            source_manifest: "{}".into(),
            projection_hash: "projection".into(),
            chunker_id: "builtin.chunker.plain".into(),
            chunker_version: "1".into(),
        }
    }

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

    #[tokio::test]
    async fn replacement_is_atomic_idempotent_and_deduplicates_inputs() {
        let directory = tempdir().unwrap();
        let store = SemanticIndexStore::new(directory.path()).unwrap();
        let mut building = store.create("replace", 3).await.unwrap();
        let shared = chunk('a', "shared", vec![1.0, 0.0, -1.0]);

        building
            .replace_clip("clip-1", &[shared.clone(), chunk('b', "old", vec![0.0; 3])])
            .await
            .unwrap();
        let original_first_chunk_ordinal: i64 = sqlx::query_scalar(
            "SELECT chunk_ordinal FROM semantic_chunks
             WHERE clip_ordinal = 0 AND ordinal_in_clip = 0",
        )
        .fetch_one(&mut building.connection)
        .await
        .unwrap();
        building
            .replace_clip("clip-2", std::slice::from_ref(&shared))
            .await
            .unwrap();
        building
            .replace_clip("clip-1", &[chunk('c', "new", vec![0.5; 3])])
            .await
            .unwrap();

        let clip_ordinals: Vec<(String, i64)> = sqlx::query_as(
            "SELECT clip_id, clip_ordinal FROM semantic_clips ORDER BY clip_ordinal",
        )
        .fetch_all(&mut building.connection)
        .await
        .unwrap();
        assert_eq!(
            clip_ordinals,
            vec![("clip-1".into(), 0), ("clip-2".into(), 1)]
        );
        let texts: Vec<String> =
            sqlx::query_scalar("SELECT text FROM semantic_chunks ORDER BY clip_ordinal")
                .fetch_all(&mut building.connection)
                .await
                .unwrap();
        assert_eq!(texts, vec!["new", "shared"]);
        let replaced_first_chunk_ordinal: i64 = sqlx::query_scalar(
            "SELECT chunk_ordinal FROM semantic_chunks
             WHERE clip_ordinal = 0 AND ordinal_in_clip = 0",
        )
        .fetch_one(&mut building.connection)
        .await
        .unwrap();
        assert_eq!(replaced_first_chunk_ordinal, original_first_chunk_ordinal);
        let input_hashes: Vec<String> =
            sqlx::query_scalar("SELECT input_hash FROM semantic_inputs ORDER BY input_hash")
                .fetch_all(&mut building.connection)
                .await
                .unwrap();
        assert_eq!(input_hashes, vec!["a".repeat(64), "c".repeat(64)]);

        let invalid = chunk('d', "invalid", vec![f32::NAN, 0.0, 0.0]);
        assert!(building.replace_clip("clip-1", &[invalid]).await.is_err());
        let retained: String = sqlx::query_scalar(
            "SELECT text FROM semantic_chunks c JOIN semantic_clips s USING (clip_ordinal)
             WHERE s.clip_id = 'clip-1'",
        )
        .fetch_one(&mut building.connection)
        .await
        .unwrap();
        assert_eq!(retained, "new");

        let stored_i8: Vec<u8> =
            sqlx::query_scalar("SELECT vector_i8 FROM semantic_inputs WHERE input_hash = ?")
                .bind("a".repeat(64))
                .fetch_one(&mut building.connection)
                .await
                .unwrap();
        assert_eq!(stored_i8, vec![127, 0, 129]);
    }
}
