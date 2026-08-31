//! Owns the disposable SQLite sidecar for one semantic-index generation.

use std::{
    cmp::{Ordering, Reverse},
    collections::{BTreeMap, BinaryHeap, HashMap, HashSet},
    fs::{self, File},
    io::{BufReader, Read},
    path::{Component, Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use futures::{future::try_join_all, TryStreamExt};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Connection, QueryBuilder, Row, Sqlite, SqliteConnection,
};

pub const SIDECAR_SCHEMA_VERSION: i64 = 3;
pub const BACKEND_ID: &str = "builtin.binary-flat.v1";
pub const VECTOR_ENCODING: &str = "binary_sign_scan_float32_rerank";
pub const DEFAULT_CANDIDATE_LIMIT: i64 = 100;
const SCAN_PAGE_CLIPS: i64 = 256;

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
    vector_f32 BLOB NOT NULL
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

CREATE TABLE semantic_clip_scans (
    page_ordinal INTEGER PRIMARY KEY CHECK (page_ordinal >= 0),
    payload BLOB NOT NULL
) STRICT;

CREATE TRIGGER semantic_inputs_validate_lengths
BEFORE INSERT ON semantic_inputs
BEGIN
    SELECT CASE
        WHEN length(NEW.vector_f32) != (SELECT dimensions * 4 FROM semantic_sidecar_meta WHERE singleton = 1)
        THEN RAISE(ABORT, 'float32 vector length does not match dimensions')
    END;
END;

"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalizedSidecar {
    pub relative_path: String,
    pub byte_length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticHit {
    pub clip_id: String,
    pub score: f64,
    pub text: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct ApproximateHit {
    clip_ordinal: i64,
    ordinal_in_clip: i64,
    score: i32,
}

impl Ord for ApproximateHit {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .cmp(&other.score)
            .then_with(|| other.clip_ordinal.cmp(&self.clip_ordinal))
            .then_with(|| other.ordinal_in_clip.cmp(&self.ordinal_in_clip))
    }
}

impl PartialOrd for ApproximateHit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone)]
struct OrdinalBitSet {
    words: Vec<u64>,
}

impl OrdinalBitSet {
    fn with_max_ordinal(max_ordinal: i64) -> Result<Self> {
        let bits = usize::try_from(max_ordinal)?
            .checked_add(1)
            .context("semantic clip ordinal overflow")?;
        Ok(Self {
            words: vec![0; bits.div_ceil(64)],
        })
    }

    fn insert(&mut self, ordinal: i64) -> Result<()> {
        let ordinal = usize::try_from(ordinal)?;
        let word = self
            .words
            .get_mut(ordinal / 64)
            .context("semantic clip ordinal exceeds generation mapping")?;
        *word |= 1_u64 << (ordinal % 64);
        Ok(())
    }

    fn contains(&self, ordinal: i64) -> bool {
        usize::try_from(ordinal).ok().is_some_and(|ordinal| {
            self.words
                .get(ordinal / 64)
                .is_some_and(|word| word & (1_u64 << (ordinal % 64)) != 0)
        })
    }
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
        let routing_signature = aggregate_binary_vectors(
            prepared.iter().map(|chunk| chunk.vector_binary.as_slice()),
            dimensions,
        )?;

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
                     (input_ordinal, input_hash, vector_f32) VALUES (?, ?, ?)",
                )
                .bind(ordinal)
                .bind(&chunk.source.input_hash)
                .bind(&chunk.vector_f32)
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
        let page_ordinal = clip_ordinal / SCAN_PAGE_CLIPS;
        let existing_payload: Option<Vec<u8>> =
            sqlx::query_scalar("SELECT payload FROM semantic_clip_scans WHERE page_ordinal = ?")
                .bind(page_ordinal)
                .fetch_optional(&mut *transaction)
                .await?;
        let vector_bytes = dimensions.div_ceil(8);
        let mut page = existing_payload
            .as_deref()
            .map(|payload| decode_scan_page(payload, page_ordinal, vector_bytes))
            .transpose()?
            .unwrap_or_default();
        if let Some(routing_signature) = routing_signature {
            page.insert(clip_ordinal, routing_signature);
        } else {
            page.remove(&clip_ordinal);
        }
        sqlx::query(
            "INSERT OR REPLACE INTO semantic_clip_scans (page_ordinal, payload) VALUES (?, ?)",
        )
        .bind(page_ordinal)
        .bind(encode_scan_page(&page, page_ordinal, vector_bytes)?)
        .execute(&mut *transaction)
        .await?;
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

    /// Closes an incomplete build without marking it ready for activation.
    pub async fn close(self) -> Result<()> {
        self.connection.close().await?;
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
    vector_binary: Vec<u8>,
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
    let mut vector_binary = vec![0_u8; dimensions.div_ceil(8)];
    for (index, value) in chunk.vector.iter().enumerate() {
        vector_f32.extend_from_slice(&value.to_le_bytes());
        if *value >= 0.0 {
            vector_binary[index / 8] |= 1 << (index % 8);
        }
    }
    Ok(PreparedChunk {
        source: chunk,
        vector_f32,
        vector_binary,
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

    /// Reopens an interrupted incomplete generation for its single writer.
    pub async fn open_building(
        &self,
        relative_path: &str,
        generation_id: &str,
        dimensions: usize,
    ) -> Result<BuildingSidecar> {
        self.open_writer(relative_path, generation_id, dimensions, 0)
            .await
    }

    /// Opens an activated generation for a bounded incremental clip update.
    pub async fn open_active(
        &self,
        relative_path: &str,
        generation_id: &str,
        dimensions: usize,
    ) -> Result<BuildingSidecar> {
        self.open_writer(relative_path, generation_id, dimensions, 1)
            .await
    }

    async fn open_writer(
        &self,
        relative_path: &str,
        generation_id: &str,
        dimensions: usize,
        complete: i64,
    ) -> Result<BuildingSidecar> {
        validate_generation_id(generation_id)?;
        let path = self.resolve(relative_path)?;
        require_regular_file(&path)?;
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await?;
        validate_meta(&mut connection, generation_id, dimensions, complete).await?;
        quick_check(&mut connection).await?;
        Ok(BuildingSidecar {
            connection,
            path,
            relative_path: relative_path.into(),
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
        require_regular_file(&path)?;
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
        validate_meta(&mut connection, generation_id, dimensions, 1).await?;
        quick_check(&mut connection).await?;
        connection.close().await?;
        Ok(())
    }

    pub fn checkpoint_identity(&self, relative_path: &str) -> Result<FinalizedSidecar> {
        let path = self.resolve(relative_path)?;
        require_regular_file(&path)?;
        Ok(FinalizedSidecar {
            relative_path: relative_path.into(),
            byte_length: fs::metadata(&path)?.len(),
            sha256: file_sha256(&path)?,
        })
    }

    /// Runs the selected two-stage retrieval path against one complete generation.
    pub async fn search<F>(
        &self,
        relative_path: &str,
        generation_id: &str,
        dimensions: usize,
        query_vector: &[f32],
        is_eligible: F,
        limit: usize,
    ) -> Result<Vec<SemanticHit>>
    where
        F: Fn(&str) -> bool,
    {
        if limit == 0 {
            return Ok(Vec::new());
        }
        validate_query_vector(query_vector, dimensions)?;
        validate_generation_id(generation_id)?;
        let path = self.resolve(relative_path)?;
        require_regular_file(&path)?;
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .read_only(true)
            .foreign_keys(true);
        let workers = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
            // More read-only SQLite connections add measurable setup and page-cache
            // contention on the compact routing file; four saturates the scan on
            // desktop CPUs without paying that per-query overhead.
            .clamp(1, 4);
        let pool = SqlitePoolOptions::new()
            .max_connections(workers as u32)
            .connect_with(options)
            .await?;
        {
            let mut connection = pool.acquire().await?;
            validate_meta(&mut connection, generation_id, dimensions, 1).await?;
        }
        let max_ordinal: Option<i64> =
            sqlx::query_scalar("SELECT MAX(clip_ordinal) FROM semantic_clips")
                .fetch_one(&pool)
                .await?;
        let Some(max_ordinal) = max_ordinal else {
            pool.close().await;
            return Ok(Vec::new());
        };

        let mut eligible_ordinals = OrdinalBitSet::with_max_ordinal(max_ordinal)?;
        let mut eligible_count = 0_usize;
        for row in sqlx::query("SELECT clip_ordinal,clip_id FROM semantic_clips")
            .fetch_all(&pool)
            .await?
        {
            let clip_id: String = row.get(1);
            if is_eligible(&clip_id) {
                eligible_ordinals.insert(row.get(0))?;
                eligible_count += 1;
            }
        }
        if eligible_count == 0 {
            pool.close().await;
            return Ok(Vec::new());
        }

        let query_binary = std::sync::Arc::new(binary_sign_vector(query_vector));
        let eligible = std::sync::Arc::new(eligible_ordinals);
        let page_count = max_ordinal / SCAN_PAGE_CLIPS + 1;
        let range_size = (page_count + workers as i64 - 1) / workers as i64;
        let tasks = (0..workers).map(|worker| {
            let pool = pool.clone();
            let query_binary = query_binary.clone();
            let eligible = eligible.clone();
            tokio::spawn(async move {
                let start = worker as i64 * range_size;
                let end = ((worker as i64 + 1) * range_size).min(page_count);
                scan_partition(&pool, start, end, &query_binary, &eligible).await
            })
        });
        let mut candidates = try_join_all(tasks)
            .await?
            .into_iter()
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| right.cmp(left));
        candidates.truncate(DEFAULT_CANDIDATE_LIMIT as usize);

        let candidate_clips = candidates
            .iter()
            .map(|candidate| candidate.clip_ordinal)
            .collect::<HashSet<_>>();
        let mut rerank_rows = Vec::<(String, Vec<u8>, String)>::new();
        if !candidate_clips.is_empty() {
            let mut query = QueryBuilder::<Sqlite>::new(
                "SELECT clips.clip_id, inputs.vector_f32, c.text
                 FROM semantic_chunks c
                 JOIN semantic_clips clips ON clips.clip_ordinal = c.clip_ordinal
                 JOIN semantic_inputs inputs ON inputs.input_ordinal = c.input_ordinal
                 WHERE c.clip_ordinal IN (",
            );
            let mut separated = query.separated(",");
            for ordinal in candidate_clips {
                separated.push_bind(ordinal);
            }
            separated.push_unseparated(")");
            for row in query.build().fetch_all(&pool).await? {
                rerank_rows.push((row.get(0), row.get(1), row.get(2)));
            }
        }
        pool.close().await;

        let mut best_by_clip = HashMap::<String, SemanticHit>::new();
        for (clip_id, vector, text) in rerank_rows {
            let score = dot_f32_blob(query_vector, &vector)?;
            let hit = SemanticHit {
                clip_id: clip_id.clone(),
                score,
                text,
            };
            match best_by_clip.get(&clip_id) {
                Some(existing) if existing.score >= score => {}
                _ => {
                    best_by_clip.insert(clip_id, hit);
                }
            }
        }
        let mut hits = best_by_clip.into_values().collect::<Vec<_>>();
        hits.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.clip_id.cmp(&right.clip_id))
        });
        hits.truncate(limit);
        Ok(hits)
    }

    /// Deletes unreferenced files that match the store's exact owned naming contract.
    pub fn remove_orphans(
        &self,
        retained_relative_paths: &std::collections::HashSet<String>,
    ) -> Result<Vec<String>> {
        let mut removed = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(relative_path) = file_name.to_str() else {
                continue;
            };
            if retained_relative_paths.contains(relative_path)
                || !owned_generation_filename(relative_path)
            {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.is_file() && !metadata.file_type().is_symlink() {
                self.remove(relative_path)?;
                removed.push(relative_path.into());
            }
        }
        removed.sort();
        Ok(removed)
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

fn encode_scan_page(
    page: &BTreeMap<i64, Vec<u8>>,
    page_ordinal: i64,
    vector_bytes: usize,
) -> Result<Vec<u8>> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&u16::try_from(page.len())?.to_le_bytes());
    let base = page_ordinal * SCAN_PAGE_CLIPS;
    for (&clip_ordinal, vectors) in page {
        let offset = clip_ordinal
            .checked_sub(base)
            .context("scan-page clip precedes its page")?;
        if !(0..SCAN_PAGE_CLIPS).contains(&offset) || vectors.len() % vector_bytes != 0 {
            bail!("invalid semantic scan-page record");
        }
        let chunk_count = vectors.len() / vector_bytes;
        payload.extend_from_slice(&u16::try_from(offset)?.to_le_bytes());
        payload.push(u8::try_from(chunk_count)?);
        payload.extend_from_slice(vectors);
    }
    Ok(payload)
}

fn decode_scan_page(
    payload: &[u8],
    page_ordinal: i64,
    vector_bytes: usize,
) -> Result<BTreeMap<i64, Vec<u8>>> {
    let mut page = BTreeMap::new();
    visit_scan_page(
        payload,
        page_ordinal,
        vector_bytes,
        |clip_ordinal, vectors| {
            if page.insert(clip_ordinal, vectors.to_vec()).is_some() {
                bail!("duplicate clip in semantic scan page");
            }
            Ok(())
        },
    )?;
    Ok(page)
}

fn visit_scan_page(
    payload: &[u8],
    page_ordinal: i64,
    vector_bytes: usize,
    mut visitor: impl FnMut(i64, &[u8]) -> Result<()>,
) -> Result<()> {
    if payload.len() < 2 || vector_bytes == 0 {
        bail!("invalid semantic scan-page header");
    }
    let count = usize::from(u16::from_le_bytes([payload[0], payload[1]]));
    let base = page_ordinal * SCAN_PAGE_CLIPS;
    let mut cursor = 2;
    let mut previous_offset = None;
    for _ in 0..count {
        if payload.len().saturating_sub(cursor) < 3 {
            bail!("truncated semantic scan-page record");
        }
        let offset = i64::from(u16::from_le_bytes([payload[cursor], payload[cursor + 1]]));
        let chunk_count = usize::from(payload[cursor + 2]);
        cursor += 3;
        if offset >= SCAN_PAGE_CLIPS {
            bail!("semantic scan-page offset exceeds page");
        }
        let length = chunk_count
            .checked_mul(vector_bytes)
            .context("semantic scan-page length overflow")?;
        let end = cursor
            .checked_add(length)
            .filter(|end| *end <= payload.len())
            .context("truncated semantic scan-page vectors")?;
        if previous_offset.is_some_and(|previous| offset <= previous) {
            bail!("semantic scan-page records are not strictly ordered");
        }
        visitor(base + offset, &payload[cursor..end])?;
        previous_offset = Some(offset);
        cursor = end;
    }
    if cursor != payload.len() {
        bail!("trailing bytes in semantic scan page");
    }
    Ok(())
}

async fn scan_partition(
    pool: &sqlx::SqlitePool,
    start: i64,
    end: i64,
    query: &[u8],
    eligible: &OrdinalBitSet,
) -> Result<Vec<ApproximateHit>> {
    if start >= end {
        return Ok(Vec::new());
    }
    let mut rows = sqlx::query(
        "SELECT page_ordinal,payload FROM semantic_clip_scans
         WHERE page_ordinal >= ? AND page_ordinal < ? ORDER BY page_ordinal",
    )
    .bind(start)
    .bind(end)
    .fetch(pool);
    let mut heap = BinaryHeap::<Reverse<ApproximateHit>>::new();
    while let Some(row) = rows.try_next().await? {
        let page_ordinal: i64 = row.get(0);
        let payload: Vec<u8> = row.get(1);
        visit_scan_page(
            &payload,
            page_ordinal,
            query.len(),
            |clip_ordinal, vectors| {
                if !eligible.contains(clip_ordinal) {
                    return Ok(());
                }
                for (ordinal_in_clip, vector) in vectors.chunks_exact(query.len()).enumerate() {
                    let differing_bits: u32 = query
                        .iter()
                        .zip(vector)
                        .map(|(left, right)| (left ^ right).count_ones())
                        .sum();
                    let score = -i32::try_from(differing_bits)?;
                    let hit = ApproximateHit {
                        clip_ordinal,
                        ordinal_in_clip: i64::try_from(ordinal_in_clip)?,
                        score,
                    };
                    if heap.len() < DEFAULT_CANDIDATE_LIMIT as usize {
                        heap.push(Reverse(hit));
                    } else if heap.peek().is_some_and(|Reverse(worst)| hit > *worst) {
                        heap.pop();
                        heap.push(Reverse(hit));
                    }
                }
                Ok(())
            },
        )?;
    }
    Ok(heap.into_iter().map(|Reverse(hit)| hit).collect())
}

fn validate_query_vector(vector: &[f32], dimensions: usize) -> Result<()> {
    if dimensions == 0
        || vector.len() != dimensions
        || vector.iter().any(|value| !value.is_finite())
    {
        bail!("semantic query vector dimensions or values are invalid");
    }
    Ok(())
}

fn binary_sign_vector(vector: &[f32]) -> Vec<u8> {
    let mut binary = vec![0_u8; vector.len().div_ceil(8)];
    for (index, value) in vector.iter().enumerate() {
        if *value >= 0.0 {
            binary[index / 8] |= 1 << (index % 8);
        }
    }
    binary
}

fn aggregate_binary_vectors<'a>(
    vectors: impl Iterator<Item = &'a [u8]>,
    dimensions: usize,
) -> Result<Option<Vec<u8>>> {
    let vector_bytes = dimensions.div_ceil(8);
    let mut counts = vec![0_i32; dimensions];
    let mut count = 0_i32;
    for vector in vectors {
        if vector.len() != vector_bytes {
            bail!("semantic routing vector dimensions do not match generation");
        }
        count += 1;
        for bit in 0..dimensions {
            counts[bit] += i32::from((vector[bit / 8] >> (bit % 8)) & 1);
        }
    }
    if count == 0 {
        return Ok(None);
    }
    let mut aggregate = vec![0_u8; vector_bytes];
    for (bit, positives) in counts.into_iter().enumerate() {
        if positives * 2 >= count {
            aggregate[bit / 8] |= 1 << (bit % 8);
        }
    }
    Ok(Some(aggregate))
}

fn dot_f32_blob(query: &[f32], bytes: &[u8]) -> Result<f64> {
    if bytes.len() != query.len() * 4 {
        bail!("stored float32 vector dimensions do not match query");
    }
    Ok(query
        .iter()
        .zip(bytes.chunks_exact(4))
        .map(|(left, right)| {
            f64::from(*left)
                * f64::from(f32::from_le_bytes(
                    right.try_into().expect("four-byte chunk"),
                ))
        })
        .sum())
}

async fn validate_meta(
    connection: &mut SqliteConnection,
    generation_id: &str,
    dimensions: usize,
    complete: i64,
) -> Result<()> {
    let meta = sqlx::query(
        "SELECT schema_version, generation_id, dimensions, backend_id,
                vector_encoding, candidate_limit, complete
         FROM semantic_sidecar_meta WHERE singleton = 1",
    )
    .fetch_one(&mut *connection)
    .await?;
    if meta.get::<i64, _>("schema_version") != SIDECAR_SCHEMA_VERSION
        || meta.get::<String, _>("generation_id") != generation_id
        || meta.get::<i64, _>("dimensions") != i64::try_from(dimensions)?
        || meta.get::<String, _>("backend_id") != BACKEND_ID
        || meta.get::<String, _>("vector_encoding") != VECTOR_ENCODING
        || meta.get::<i64, _>("candidate_limit") != DEFAULT_CANDIDATE_LIMIT
        || meta.get::<i64, _>("complete") != complete
    {
        bail!("semantic sidecar metadata does not match the requested generation");
    }
    Ok(())
}

async fn quick_check(connection: &mut SqliteConnection) -> Result<()> {
    let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(connection)
        .await?;
    if integrity != "ok" {
        bail!("semantic sidecar failed SQLite integrity check: {integrity}");
    }
    Ok(())
}

fn require_regular_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("semantic sidecar is missing: {}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("semantic sidecar must be a regular file");
    }
    Ok(())
}

fn owned_generation_filename(relative_path: &str) -> bool {
    relative_path
        .strip_prefix("generation-")
        .and_then(|value| value.strip_suffix(".sqlite"))
        .is_some_and(|generation_id| validate_generation_id(generation_id).is_ok())
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

    #[test]
    fn eligibility_bitset_is_compact_and_handles_sparse_ordinals() {
        let mut eligible = OrdinalBitSet::with_max_ordinal(59_999).unwrap();
        eligible.insert(0).unwrap();
        eligible.insert(31_337).unwrap();
        eligible.insert(59_999).unwrap();
        assert!(eligible.contains(0));
        assert!(eligible.contains(31_337));
        assert!(eligible.contains(59_999));
        assert!(!eligible.contains(31_338));
        assert_eq!(eligible.words.len() * size_of::<u64>(), 7_504);
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
            "INSERT INTO semantic_inputs (input_ordinal, input_hash, vector_f32)
             VALUES (0, 'hash-1', ?)",
        )
        .bind(vec![0_u8; 12])
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

        let payload: Vec<u8> =
            sqlx::query_scalar("SELECT payload FROM semantic_clip_scans WHERE page_ordinal = 0")
                .fetch_one(&mut building.connection)
                .await
                .unwrap();
        let page = decode_scan_page(&payload, 0, 1).unwrap();
        assert_eq!(page.get(&1), Some(&vec![0b0000_0011]));
    }

    #[tokio::test]
    async fn interrupted_build_reopens_and_orphan_cleanup_is_strictly_scoped() {
        let directory = tempdir().unwrap();
        let store = SemanticIndexStore::new(directory.path()).unwrap();
        let relative_path = "generation-interrupted.sqlite";
        let mut building = store.create("interrupted", 3).await.unwrap();
        building
            .replace_clip("clip-1", &[chunk('a', "before restart", vec![0.0; 3])])
            .await
            .unwrap();
        building.close().await.unwrap();

        let mut reopened = store
            .open_building(relative_path, "interrupted", 3)
            .await
            .unwrap();
        reopened
            .replace_clip("clip-1", &[chunk('b', "after restart", vec![0.5; 3])])
            .await
            .unwrap();
        let finalized = reopened.finalize().await.unwrap();
        store
            .validate(relative_path, "interrupted", 3, Some(&finalized.sha256))
            .await
            .unwrap();

        store
            .create("orphan", 3)
            .await
            .unwrap()
            .close()
            .await
            .unwrap();
        fs::write(directory.path().join("notes.sqlite"), b"not owned").unwrap();
        fs::write(
            directory.path().join("generation-invalid_name.sqlite"),
            b"not owned",
        )
        .unwrap();
        let retained = std::collections::HashSet::from([relative_path.into()]);
        assert_eq!(
            store.remove_orphans(&retained).unwrap(),
            vec!["generation-orphan.sqlite"]
        );
        assert!(directory.path().join(relative_path).exists());
        assert!(directory.path().join("notes.sqlite").exists());
        assert!(directory
            .path()
            .join("generation-invalid_name.sqlite")
            .exists());
    }

    #[tokio::test]
    async fn binary_routing_candidates_match_the_exact_float_ranking() {
        let directory = tempdir().unwrap();
        let store = SemanticIndexStore::new(directory.path()).unwrap();
        let mut building = store.create("retrieval", 2).await.unwrap();
        let mut exact = Vec::new();
        let mut eligible = HashSet::new();
        for index in 0..150 {
            let angle = index as f32 * std::f32::consts::TAU / 150.0;
            let vector = vec![angle.cos(), angle.sin()];
            let clip_id = format!("clip-{index:03}");
            if index % 7 != 0 {
                eligible.insert(clip_id.clone());
                exact.push((clip_id.clone(), f64::from(vector[0])));
            }
            let input_hash = format!("{:x}", Sha256::digest(format!("input-{index}").as_bytes()));
            let mut value = chunk('a', &format!("text {index}"), vector);
            value.input_hash = input_hash;
            building.replace_clip(&clip_id, &[value]).await.unwrap();
        }
        let finalized = building.finalize().await.unwrap();
        exact.sort_by(|left, right| {
            right
                .1
                .total_cmp(&left.1)
                .then_with(|| left.0.cmp(&right.0))
        });

        let hits = store
            .search(
                &finalized.relative_path,
                "retrieval",
                2,
                &[1.0, 0.0],
                |clip_id| eligible.contains(clip_id),
                10,
            )
            .await
            .unwrap();
        assert_eq!(
            hits.iter()
                .map(|hit| hit.clip_id.as_str())
                .collect::<Vec<_>>(),
            exact
                .iter()
                .take(10)
                .map(|(clip_id, _)| clip_id.as_str())
                .collect::<Vec<_>>()
        );
        assert!(hits.windows(2).all(|pair| pair[0].score >= pair[1].score));
    }

    /// Full physical-layout gate. Run in release mode:
    /// `cargo test --release packed_sqlite_scale_qualification -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn packed_sqlite_scale_qualification() {
        use std::time::Instant;

        const CLIPS: usize = 60_000;
        const CHUNKS_PER_CLIP: usize = 9;
        const DIMENSIONS: usize = 1_024;
        const RUNS: usize = 21;
        const P95_LIMIT_MICROS: u128 = 125_000;

        let directory = tempdir().unwrap();
        let store = SemanticIndexStore::new(directory.path()).unwrap();
        let mut building = store.create("packed-scale", DIMENSIONS).await.unwrap();
        let vector = vec![1.0_f32 / (DIMENSIONS as f32).sqrt(); DIMENSIONS];
        let vector_f32 = vector
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect::<Vec<_>>();
        let vector_binary = binary_sign_vector(&vector);
        let packed_scan = vector_binary;
        let mut transaction = building.connection.begin().await.unwrap();
        sqlx::query(
            "WITH RECURSIVE sequence(value) AS (
                SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?
             )
             INSERT INTO semantic_clips(clip_ordinal,clip_id)
             SELECT value,printf('clip-%05d',value) FROM sequence",
        )
        .bind(CLIPS as i64)
        .execute(&mut *transaction)
        .await
        .unwrap();
        let page_count = (CLIPS as i64 + SCAN_PAGE_CLIPS - 1) / SCAN_PAGE_CLIPS;
        for page_ordinal in 0..page_count {
            let first = page_ordinal * SCAN_PAGE_CLIPS;
            let end = (first + SCAN_PAGE_CLIPS).min(CLIPS as i64);
            let page = (first..end)
                .map(|clip_ordinal| (clip_ordinal, packed_scan.clone()))
                .collect();
            sqlx::query("INSERT INTO semantic_clip_scans(page_ordinal,payload) VALUES(?,?)")
                .bind(page_ordinal)
                .bind(encode_scan_page(&page, page_ordinal, DIMENSIONS.div_ceil(8)).unwrap())
                .execute(&mut *transaction)
                .await
                .unwrap();
        }
        sqlx::query(
            "INSERT INTO semantic_inputs(input_ordinal,input_hash,vector_f32)
             VALUES(0,?,?)",
        )
        .bind("a".repeat(64))
        .bind(vector_f32)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            "WITH RECURSIVE sequence(value) AS (
                SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < 200
             )
             INSERT INTO semantic_chunks(
                chunk_ordinal,chunk_id,clip_ordinal,input_ordinal,ordinal_in_clip,kind,text,
                source_manifest,projection_hash,chunker_id,chunker_version)
             SELECT value,printf('chunk-%04d',value),value / ?,0,value % ?,
                    'text','qualification','{}','projection','qualification','1'
             FROM sequence",
        )
        .bind(CHUNKS_PER_CLIP as i64)
        .bind(CHUNKS_PER_CLIP as i64)
        .execute(&mut *transaction)
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        let finalized = building.finalize().await.unwrap();

        let mut elapsed = Vec::with_capacity(RUNS);
        for _ in 0..RUNS {
            let started = Instant::now();
            let hits = store
                .search(
                    &finalized.relative_path,
                    "packed-scale",
                    DIMENSIONS,
                    &vector,
                    |_| true,
                    10,
                )
                .await
                .unwrap();
            assert_eq!(hits.len(), 10);
            elapsed.push(started.elapsed().as_micros());
        }
        elapsed.sort_unstable();
        let p50 = elapsed[RUNS / 2];
        let p95 = elapsed[(RUNS - 1) * 95 / 100];
        eprintln!(
            "packed-sqlite clips={CLIPS} chunks={} dimensions={DIMENSIONS} bytes={} runs={RUNS} p50_us={p50} p95_us={p95}",
            CLIPS * CHUNKS_PER_CLIP,
            fs::metadata(directory.path().join(&finalized.relative_path))
                .unwrap()
                .len()
        );
        assert!(
            p95 <= P95_LIMIT_MICROS,
            "packed SQLite p95 {p95}us exceeds {P95_LIMIT_MICROS}us gate"
        );
    }
}
