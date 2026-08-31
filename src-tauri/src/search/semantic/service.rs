use super::chunking::{
    self, deduplicate_inputs, SemanticChunk, SemanticFacet, SemanticInput, PIPELINE_VERSION,
};
use super::store::{BuildingSidecar, SemanticIndexStore, SidecarChunk};
use crate::{
    history::{new_id, now_ms, sha256, ClipSummary, HistoryRepository},
    providers::{
        self,
        contracts::text_embedding::{TextEmbeddingProvider, TextEmbeddingSpace},
        error::ProviderError,
        ollama, TextEmbeddingProviderConfig, OLLAMA_TEXT_EMBEDDING_ID,
    },
    search::SEMANTIC_TEXT_SOURCE_ID,
};

pub use crate::providers::ollama::{OllamaEndpointStatus, OllamaModelDescriptor};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet, VecDeque};

const PROVIDER_CONFIG_KEY: &str = "providers.text_embedding.active";
const MIN_FALLBACK_BYTES: usize = 128;
const MAX_FALLBACK_DEPTH: u8 = 4;
const MAX_EMBED_REQUESTS_PER_CLIP: usize = 128;
const ELIGIBLE_CLIP_PREDICATE: &str = "c.lifecycle_state='ready' AND (
  trim(COALESCE(c.note,'')) <> ''
  OR EXISTS(SELECT 1 FROM catalog_clip_tags ct WHERE ct.clip_id=c.id)
  OR EXISTS(
    SELECT 1 FROM clip_representations r
    JOIN clip_text_values t ON t.representation_id=r.id
    WHERE r.clip_id=c.id AND r.lifecycle_state='ready'
  )
  OR EXISTS(
    SELECT 1 FROM artifact_records ar
    JOIN artifact_text_values atv ON atv.artifact_id=ar.id
    WHERE ar.owner_clip_id=c.id AND ar.producer_id='builtin.artifact.ocr'
    AND ar.lifecycle_state='ready'
  )
)";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProviderDescriptor {
    pub provider_kind: String,
    pub provider_version: String,
    pub endpoint: String,
    pub model: String,
    pub model_digest: String,
    pub dimensions: u32,
    pub normalization: String,
    pub modality: String,
    pub distance_metric: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub enabled: bool,
    pub phase: ProviderPhase,
    pub active_space_id: Option<String>,
    pub pending_space_id: Option<String>,
    pub diagnostic: Option<String>,
    pub indexed_clips: u64,
    pub pending_jobs: u64,
    pub failed_jobs: u64,
    pub eligible_clips: u64,
    pub endpoint: Option<String>,
    pub model: Option<String>,
}

/// A compact, read-only view of an existing failed indexing job. The clip
/// preview is resolved from canonical history data at read time; it is not
/// another persisted projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedEmbeddingJob {
    pub clip: ClipSummary,
    pub attempt_count: u32,
    pub last_error: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderPhase {
    NotConfigured,
    Checking,
    ValidatingModel,
    Indexing,
    Ready,
    Degraded,
    Disabled,
}

#[derive(Debug, Clone)]
struct Generation {
    id: String,
    space_id: String,
    status: String,
    dimensions: usize,
    sidecar_relative_path: String,
}

pub async fn probe_endpoint(endpoint: String) -> OllamaEndpointStatus {
    ollama::probe_endpoint(endpoint).await
}

pub async fn list_models(endpoint: String) -> Result<Vec<OllamaModelDescriptor>> {
    Ok(ollama::list_models(endpoint).await?)
}

pub async fn probe_model(endpoint: String, model: String) -> Result<EmbeddingProviderDescriptor> {
    let space = ollama::probe_model(endpoint.clone(), model.clone()).await?;
    Ok(EmbeddingProviderDescriptor {
        provider_kind: space.provider.provider_id.clone(),
        provider_version: space.provider.provider_version.clone(),
        endpoint,
        model,
        model_digest: space.provider.model_revision.clone(),
        dimensions: space.dimensions as u32,
        normalization: space.normalization.clone(),
        modality: "text".into(),
        distance_metric: space.distance_metric.clone(),
    })
}

pub async fn configure(
    repo: &HistoryRepository,
    endpoint: String,
    model: String,
) -> Result<ProviderStatus> {
    let config = TextEmbeddingProviderConfig {
        provider_id: OLLAMA_TEXT_EMBEDDING_ID.into(),
        endpoint,
        model,
        enabled: true,
    };
    let provider = providers::text_embedding_provider(&config, None)?;
    let descriptor = provider.describe().await?;
    let compatibility = compatibility_sha256(&descriptor)?;
    let space_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM search_embedding_spaces WHERE compatibility_sha256=?",
    )
    .bind(&compatibility)
    .fetch_optional(&repo.pool)
    .await?
    .unwrap_or_else(new_id);
    sqlx::query(
        "INSERT OR IGNORE INTO search_embedding_spaces(
            id,provider_id,provider_version,model_id,model_revision,compatibility_sha256,
            modality,dimensions,normalization,distance_metric,created_at
         ) VALUES(?,?,?,?,?,?,'text',?,?,?,?)",
    )
    .bind(&space_id)
    .bind(&descriptor.provider.provider_id)
    .bind(&descriptor.provider.provider_version)
    .bind(&descriptor.provider.model_id)
    .bind(&descriptor.provider.model_revision)
    .bind(&compatibility)
    .bind(descriptor.dimensions as i64)
    .bind(&descriptor.normalization)
    .bind(&descriptor.distance_metric)
    .bind(now_ms())
    .execute(&repo.pool)
    .await?;
    put_device_config(&repo.pool, &config).await?;
    record_provider_success(repo, &config.provider_id).await?;
    create_building_generation(repo, &space_id).await?;
    status(repo).await
}

pub async fn disable(repo: &HistoryRepository) -> Result<()> {
    let Some(mut config) = get_device_config(&repo.pool).await? else {
        return Ok(());
    };
    config.enabled = false;
    put_device_config(&repo.pool, &config).await
}

pub async fn status(repo: &HistoryRepository) -> Result<ProviderStatus> {
    let config = get_device_config(&repo.pool).await?;
    let eligible = eligible_clip_count(repo).await?;
    let Some(config) = config else {
        return Ok(ProviderStatus {
            enabled: false,
            phase: ProviderPhase::NotConfigured,
            active_space_id: None,
            pending_space_id: None,
            diagnostic: None,
            indexed_clips: 0,
            pending_jobs: 0,
            failed_jobs: 0,
            eligible_clips: eligible as u64,
            endpoint: None,
            model: None,
        });
    };
    let active = generation_by_status(repo, "active").await?;
    let building = generation_by_status(repo, "building").await?;
    let failed_generation = generation_by_status(repo, "failed").await?;
    // A retained failed rebuild is diagnostic history, not the live index.
    // Prefer the active generation once no rebuild is currently running.
    let target = building
        .as_ref()
        .or(active.as_ref())
        .or(failed_generation.as_ref());
    let (indexed, pending, failed, job_diagnostic) = generation_counts(repo, target).await?;
    let diagnostic = provider_diagnostic(repo, &config.provider_id)
        .await?
        .or(job_diagnostic);
    let phase = if !config.enabled {
        ProviderPhase::Disabled
    } else if diagnostic.is_some() || failed > 0 || (active.is_none() && building.is_none()) {
        ProviderPhase::Degraded
    } else if building.is_some() || pending > 0 {
        ProviderPhase::Indexing
    } else {
        ProviderPhase::Ready
    };
    Ok(ProviderStatus {
        enabled: config.enabled,
        phase,
        active_space_id: active.map(|value| value.space_id),
        pending_space_id: building.or(failed_generation).map(|value| value.space_id),
        diagnostic,
        indexed_clips: indexed as u64,
        pending_jobs: pending as u64,
        failed_jobs: failed as u64,
        eligible_clips: eligible as u64,
        endpoint: Some(config.endpoint),
        model: Some(config.model),
    })
}

/// Count clips that can actually contribute a semantic input. Images without
/// OCR, for example, are valid clipboard history but cannot yet be embedded by
/// the text provider, so they must not make text-index coverage look incomplete.
async fn eligible_clip_count(repo: &HistoryRepository) -> Result<i64> {
    let sql = format!("SELECT count(*) FROM clip_items c WHERE {ELIGIBLE_CLIP_PREDICATE}");
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .fetch_one(&repo.pool)
        .await?)
}

pub async fn failed_jobs(repo: &HistoryRepository, limit: u32) -> Result<Vec<FailedEmbeddingJob>> {
    // Mirror `status`: an active generation can have an individual failed job
    // after an index-missing run, while a rebuilding generation becomes failed
    // only once it settles.
    let generation = generation_by_status(repo, "building")
        .await?
        .or(generation_by_status(repo, "active").await?)
        .or(generation_by_status(repo, "failed").await?);
    let Some(generation) = generation else {
        return Ok(Vec::new());
    };
    let rows = sqlx::query(
        "SELECT clip_id,attempt_count,last_error,updated_at FROM search_index_jobs
         WHERE generation_id=? AND status='failed' ORDER BY updated_at DESC,id LIMIT ?",
    )
    .bind(generation.id)
    .bind(i64::from(limit.clamp(1, 20)))
    .fetch_all(&repo.pool)
    .await?;
    let mut jobs = Vec::with_capacity(rows.len());
    for row in rows {
        let clip_id: String = row.get(0);
        // A clip can disappear through normal retention while its failed job is
        // still visible. Ignore that stale row instead of failing the whole view.
        let Ok(clip) = repo.summary(&clip_id).await else {
            continue;
        };
        jobs.push(FailedEmbeddingJob {
            clip,
            attempt_count: row.get::<i64, _>(1).max(0) as u32,
            last_error: row.get(2),
            updated_at: row.get(3),
        });
    }
    Ok(jobs)
}

async fn generation_counts(
    repo: &HistoryRepository,
    generation: Option<&Generation>,
) -> Result<(i64, i64, i64, Option<String>)> {
    let Some(generation) = generation else {
        return Ok((0, 0, 0, None));
    };
    let indexed = completed_eligible_job_count(repo, &generation.id).await?;
    let pending = job_count(repo, &generation.id, "status IN ('pending','running')").await?;
    let failed = job_count(repo, &generation.id, "status='failed'").await?;
    let diagnostic = sqlx::query_scalar(
        "SELECT last_error FROM search_index_jobs WHERE generation_id=? AND status='failed'
         AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&generation.id)
    .fetch_optional(&repo.pool)
    .await?;
    Ok((indexed, pending, failed, diagnostic))
}

async fn completed_eligible_job_count(repo: &HistoryRepository, generation: &str) -> Result<i64> {
    let sql = format!(
        "SELECT count(*) FROM search_index_jobs j
         JOIN clip_items c ON c.id=j.clip_id
         WHERE j.generation_id=? AND j.status='completed' AND {ELIGIBLE_CLIP_PREDICATE}"
    );
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(generation)
        .fetch_one(&repo.pool)
        .await?)
}

async fn job_count(repo: &HistoryRepository, generation: &str, predicate: &str) -> Result<i64> {
    let sql =
        format!("SELECT count(*) FROM search_index_jobs WHERE generation_id=? AND {predicate}");
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(generation)
        .fetch_one(&repo.pool)
        .await?)
}

pub async fn index_pending(repo: &HistoryRepository) -> Result<u64> {
    let config = enabled_config(repo).await?;
    let generation = target_generation_for_work(repo)
        .await?
        .context("no embedding generation")?;
    let rows = sqlx::query(
        "SELECT id,clip_id FROM search_index_jobs WHERE generation_id=? AND status='pending'
         ORDER BY requested_at,id LIMIT 16",
    )
    .bind(&generation.id)
    .fetch_all(&repo.pool)
    .await?;
    if rows.is_empty() {
        settle_generation(repo, &generation).await?;
        return Ok(0);
    }
    let model: String =
        sqlx::query_scalar("SELECT model_id FROM search_embedding_spaces WHERE id=?")
            .bind(&generation.space_id)
            .fetch_one(&repo.pool)
            .await?;
    let provider = providers::text_embedding_provider(&config, Some(&model))?;
    let store = SemanticIndexStore::new(&repo.semantic_index_root)?;
    if generation.status == "active" {
        sqlx::query(
            "UPDATE search_index_generations
             SET sidecar_byte_length=NULL,sidecar_sha256=NULL,updated_at=? WHERE id=?",
        )
        .bind(now_ms())
        .bind(&generation.id)
        .execute(&repo.pool)
        .await?;
    }
    let mut writer = if generation.status == "building" {
        store
            .open_building(
                &generation.sidecar_relative_path,
                &generation.id,
                generation.dimensions,
            )
            .await?
    } else {
        store
            .open_active(
                &generation.sidecar_relative_path,
                &generation.id,
                generation.dimensions,
            )
            .await?
    };
    let mut count = 0;
    let mut first_error = None;
    for row in rows {
        count += 1;
        let id: String = row.get(0);
        let clip: String = row.get(1);
        let now = now_ms();
        sqlx::query(
            "UPDATE search_index_jobs SET status='running',started_at=?,updated_at=?,
             attempt_count=attempt_count+1 WHERE id=?",
        )
        .bind(now)
        .bind(now)
        .bind(&id)
        .execute(&repo.pool)
        .await?;
        match index_clip(repo, &mut writer, provider.as_ref(), &clip).await {
            Ok(projection) => {
                sqlx::query(
                    "UPDATE search_index_jobs SET status='completed',projection_sha256=?,
                     completed_at=?,updated_at=?,last_error=NULL WHERE id=?",
                )
                .bind(projection)
                .bind(now_ms())
                .bind(now_ms())
                .bind(&id)
                .execute(&repo.pool)
                .await?;
            }
            Err(error) => {
                let error_message = error.to_string();
                sqlx::query(
                    "UPDATE search_index_jobs SET
                     status=CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,
                     last_error=?,completed_at=?,updated_at=? WHERE id=?",
                )
                .bind(error_message.chars().take(512).collect::<String>())
                .bind(now_ms())
                .bind(now_ms())
                .bind(&id)
                .execute(&repo.pool)
                .await?;
                // Return one failure after this batch is persisted. The worker
                // then validates the provider again and applies its bounded
                // backoff, rather than consuming all three attempts in a tight
                // loop during a temporary Ollama outage.
                if first_error.is_none() {
                    first_error = Some(error_message);
                }
            }
        }
    }
    writer.close().await?;
    settle_generation(repo, &generation).await?;
    if let Some(error) = first_error {
        bail!(error);
    }
    Ok(count)
}

async fn settle_generation(repo: &HistoryRepository, generation: &Generation) -> Result<()> {
    if generation.status != "building"
        || job_count(repo, &generation.id, "status IN ('pending','running')").await? != 0
    {
        return Ok(());
    }
    if job_count(repo, &generation.id, "status='failed'").await? > 0 {
        sqlx::query(
            "UPDATE search_index_generations SET status='failed',completed_at=?,updated_at=? WHERE id=?",
        )
        .bind(now_ms())
        .bind(now_ms())
        .bind(&generation.id)
        .execute(&repo.pool)
        .await?;
        return Ok(());
    }
    let store = SemanticIndexStore::new(&repo.semantic_index_root)?;
    let finalized = match store
        .open_building(
            &generation.sidecar_relative_path,
            &generation.id,
            generation.dimensions,
        )
        .await
    {
        Ok(writer) => writer.finalize().await?,
        Err(open_error) => {
            store
                .validate(
                    &generation.sidecar_relative_path,
                    &generation.id,
                    generation.dimensions,
                    None,
                )
                .await
                .with_context(|| format!("cannot recover finalized sidecar: {open_error}"))?;
            store.checkpoint_identity(&generation.sidecar_relative_path)?
        }
    };
    let now = now_ms();
    let mut tx = repo.pool.begin().await?;
    sqlx::query(
        "UPDATE search_index_generations SET status='superseded',updated_at=?
         WHERE source_id=? AND status='active'",
    )
    .bind(now)
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE search_index_generations SET status='active',activated_at=?,completed_at=?,updated_at=?,
         sidecar_byte_length=?,sidecar_sha256=? WHERE id=?",
    )
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(i64::try_from(finalized.byte_length)?)
    .bind(finalized.sha256)
    .bind(&generation.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM search_index_jobs WHERE generation_id IN (
            SELECT id FROM search_index_generations WHERE source_id=?
            AND status IN ('superseded','cancelled'))",
    )
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    remove_disposable_generation_sidecars(repo).await?;
    Ok(())
}

async fn index_clip(
    repo: &HistoryRepository,
    writer: &mut BuildingSidecar,
    provider: &dyn TextEmbeddingProvider,
    clip_id: &str,
) -> Result<String> {
    let mut chunks = Vec::<(SemanticInput, SemanticChunk)>::new();
    for input in deduplicate_inputs(load_semantic_inputs(repo, clip_id).await?) {
        for chunk in chunking::chunk_input(&input)? {
            chunks.push((input.clone(), chunk));
        }
    }
    let chunks = chunking::bound_clip_chunks(clip_id, chunks);
    let projection = semantic_projection_hash(&chunks)?;
    if chunks.is_empty() {
        writer.replace_clip(clip_id, &[]).await?;
        return Ok(projection);
    }
    let embedded = embed_chunks_adaptively(provider, chunks).await?;
    let mut sidecar_chunks = Vec::with_capacity(embedded.len());
    for (input, chunk, vector) in embedded {
        validate_vector(&vector, None)?;
        let manifest = chunk_manifest(&input, &chunk)?;
        let chunk_projection = sha256(
            format!(
                "{}:{}:{}:{}",
                PIPELINE_VERSION, chunk.strategy_id, manifest, chunk.embedding_text
            )
            .as_bytes(),
        );
        sidecar_chunks.push(SidecarChunk {
            input_hash: sha256(chunk.embedding_text.as_bytes()),
            vector,
            kind: chunk.kind,
            text: chunk.display_text,
            representation_id: input.representation_id,
            artifact_id: input.artifact_id,
            source_manifest: manifest,
            projection_hash: chunk_projection,
            chunker_id: chunk.strategy_id,
            chunker_version: chunk.strategy_version,
        });
    }
    writer.replace_clip(clip_id, &sidecar_chunks).await?;
    Ok(projection)
}

async fn load_semantic_inputs(
    repo: &HistoryRepository,
    clip_id: &str,
) -> Result<Vec<SemanticInput>> {
    let mut inputs = Vec::new();
    let note: Option<String> = sqlx::query_scalar("SELECT note FROM clip_items WHERE id=?")
        .bind(clip_id)
        .fetch_optional(&repo.pool)
        .await?
        .flatten();
    if let Some(note) = note.filter(|value| !value.trim().is_empty()) {
        inputs.push(SemanticInput {
            source_kind: "note".into(),
            source_id: format!("{clip_id}:note"),
            representation_id: None,
            artifact_id: None,
            mime_type: Some("text/plain".into()),
            format_family: Some("metadata".into()),
            facets: Vec::new(),
            text: note,
            source_ordinal: -2,
        });
    }
    let tags: Vec<String> = sqlx::query_scalar(
        "SELECT t.name FROM catalog_tags t JOIN catalog_clip_tags ct ON ct.tag_id=t.id
         WHERE ct.clip_id=? ORDER BY t.name",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    if !tags.is_empty() {
        inputs.push(SemanticInput {
            source_kind: "tags".into(),
            source_id: format!("{clip_id}:tags"),
            representation_id: None,
            artifact_id: None,
            mime_type: Some("text/plain".into()),
            format_family: Some("metadata".into()),
            facets: Vec::new(),
            text: tags.join(", "),
            source_ordinal: -1,
        });
    }
    let rows = sqlx::query(
        "SELECT r.id,r.canonical_mime_type,r.format_family,r.capture_priority,r.ordinal,t.text_value
         FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id
         WHERE r.clip_id=? AND r.lifecycle_state='ready'
         ORDER BY r.capture_priority,r.ordinal,r.id",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    for row in rows {
        let representation_id: String = row.get(0);
        let facet_rows = sqlx::query(
            "SELECT facet_id,payload_json FROM content_clip_facets
             WHERE source_representation_id=? ORDER BY facet_id,detector_id,detector_version",
        )
        .bind(&representation_id)
        .fetch_all(&repo.pool)
        .await?;
        let facets = facet_rows
            .into_iter()
            .map(|facet| {
                let raw: Option<String> = facet.get(1);
                Ok(SemanticFacet {
                    id: facet.get(0),
                    payload: raw
                        .as_deref()
                        .map(serde_json::from_str)
                        .transpose()?
                        .unwrap_or_else(|| serde_json::json!({})),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let priority: i64 = row.get(3);
        let ordinal: i64 = row.get(4);
        inputs.push(SemanticInput {
            source_kind: "representation".into(),
            source_id: representation_id.clone(),
            representation_id: Some(representation_id),
            artifact_id: None,
            mime_type: row.get(1),
            format_family: Some(row.get(2)),
            facets,
            text: row.get(5),
            source_ordinal: priority.saturating_mul(1_000).saturating_add(ordinal),
        });
    }
    let ocr_rows = sqlx::query(
        "SELECT ar.id,atv.text_value
         FROM artifact_records ar
         JOIN artifact_text_values atv ON atv.artifact_id=ar.id
         WHERE ar.owner_clip_id=? AND ar.producer_id='builtin.artifact.ocr'
         AND ar.lifecycle_state='ready' ORDER BY ar.created_at,ar.id",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    for (ordinal, row) in ocr_rows.into_iter().enumerate() {
        let artifact_id: String = row.get(0);
        inputs.push(SemanticInput {
            source_kind: "ocr".into(),
            source_id: artifact_id.clone(),
            representation_id: None,
            artifact_id: Some(artifact_id),
            mime_type: Some("text/plain".into()),
            format_family: Some("artifact".into()),
            facets: Vec::new(),
            text: row.get(1),
            source_ordinal: 1_000_000 + ordinal as i64,
        });
    }
    Ok(inputs)
}

fn semantic_projection_hash(chunks: &[(SemanticInput, SemanticChunk)]) -> Result<String> {
    let values = chunks
        .iter()
        .map(|(input, chunk)| {
            serde_json::json!({
                "sourceId": input.source_id,
                "strategyId": chunk.strategy_id,
                "strategyVersion": chunk.strategy_version,
                "kind": chunk.kind,
                "contextPath": chunk.context_path,
                "displaySha256": sha256(chunk.display_text.as_bytes()),
                "embeddingSha256": sha256(chunk.embedding_text.as_bytes()),
            })
        })
        .collect::<Vec<_>>();
    Ok(sha256(
        serde_json::to_string(&(PIPELINE_VERSION, values))?.as_bytes(),
    ))
}

fn chunk_manifest(input: &SemanticInput, chunk: &SemanticChunk) -> Result<String> {
    let value = serde_json::json!({
        "pipelineVersion": PIPELINE_VERSION,
        "sourceKind": input.source_kind,
        "sourceId": input.source_id,
        "representationId": input.representation_id,
        "artifactId": input.artifact_id,
        "mimeType": input.mime_type,
        "formatFamily": input.format_family,
        "facetIds": input.facets.iter().map(|facet| &facet.id).collect::<Vec<_>>(),
        "contextPath": chunk.context_path,
        "strategyId": chunk.strategy_id,
        "strategyVersion": chunk.strategy_version,
        "fallbackReason": chunk.fallback_reason,
    });
    let encoded = serde_json::to_string(&value)?;
    if encoded.len() <= 4_096 {
        return Ok(encoded);
    }
    Ok(serde_json::to_string(&serde_json::json!({
        "pipelineVersion": PIPELINE_VERSION,
        "sourceKind": input.source_kind,
        "sourceId": input.source_id,
        "strategyId": chunk.strategy_id,
        "strategyVersion": chunk.strategy_version,
        "manifestTruncated": true,
    }))?)
}

async fn enqueue_all(repo: &HistoryRepository, generation_id: &str) -> Result<()> {
    let clips: Vec<String> =
        sqlx::query_scalar("SELECT id FROM clip_items WHERE lifecycle_state='ready'")
            .fetch_all(&repo.pool)
            .await?;
    for clip in clips {
        enqueue_job(repo, generation_id, &clip).await?;
    }
    Ok(())
}

async fn enqueue_job(repo: &HistoryRepository, generation_id: &str, clip_id: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO search_index_jobs(id,generation_id,clip_id,status,requested_at)
         VALUES(?,?,?,'pending',?)
         ON CONFLICT(generation_id,clip_id) DO UPDATE SET
           status='pending',attempt_count=0,last_error=NULL,completed_at=NULL,
           updated_at=excluded.requested_at",
    )
    .bind(new_id())
    .bind(generation_id)
    .bind(clip_id)
    .bind(now_ms())
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn next_generation(repo: &HistoryRepository) -> Result<i64> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(MAX(generation),0)+1 FROM search_index_generations WHERE source_id=?",
    )
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .fetch_one(&repo.pool)
    .await?)
}

async fn create_building_generation(
    repo: &HistoryRepository,
    space_id: &str,
) -> Result<Generation> {
    cancel_building(repo).await?;
    cancel_failed_generations(repo).await?;
    let generation = next_generation(repo).await?;
    let id = new_id();
    let dimensions: i64 =
        sqlx::query_scalar("SELECT dimensions FROM search_embedding_spaces WHERE id=?")
            .bind(space_id)
            .fetch_one(&repo.pool)
            .await?;
    let store = SemanticIndexStore::new(&repo.semantic_index_root)?;
    let building = store.create(&id, usize::try_from(dimensions)?).await?;
    let sidecar_relative_path = format!("generation-{id}.sqlite");
    building.close().await?;
    let now = now_ms();
    let inserted = sqlx::query(
        "INSERT INTO search_index_generations(
            id,source_id,space_id,generation,pipeline_version,status,sidecar_relative_path,
            created_at,updated_at
         ) VALUES(?,?,?,?,?,'building',?,?,?)",
    )
    .bind(&id)
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .bind(space_id)
    .bind(generation)
    .bind(PIPELINE_VERSION)
    .bind(&sidecar_relative_path)
    .bind(now)
    .bind(now)
    .execute(&repo.pool)
    .await;
    if let Err(error) = inserted {
        store.remove(&sidecar_relative_path)?;
        return Err(error.into());
    }
    enqueue_all(repo, &id).await?;
    Ok(Generation {
        id,
        space_id: space_id.into(),
        status: "building".into(),
        dimensions: usize::try_from(dimensions)?,
        sidecar_relative_path,
    })
}

async fn cancel_failed_generations(repo: &HistoryRepository) -> Result<()> {
    let now = now_ms();
    sqlx::query(
        "UPDATE search_index_generations SET status='cancelled',completed_at=?,updated_at=?
         WHERE source_id=? AND status='failed'",
    )
    .bind(now)
    .bind(now)
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .execute(&repo.pool)
    .await?;
    sqlx::query(
        "DELETE FROM search_index_jobs WHERE generation_id IN (
            SELECT id FROM search_index_generations WHERE source_id=? AND status='cancelled')",
    )
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .execute(&repo.pool)
    .await?;
    remove_disposable_generation_sidecars(repo).await?;
    Ok(())
}

async fn cancel_building(repo: &HistoryRepository) -> Result<()> {
    let now = now_ms();
    sqlx::query(
        "UPDATE search_index_generations SET status='cancelled',completed_at=?,updated_at=?
         WHERE source_id=? AND status='building'",
    )
    .bind(now)
    .bind(now)
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .execute(&repo.pool)
    .await?;
    sqlx::query(
        "DELETE FROM search_index_jobs WHERE generation_id IN (
            SELECT id FROM search_index_generations WHERE source_id=? AND status='cancelled')",
    )
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .execute(&repo.pool)
    .await?;
    remove_disposable_generation_sidecars(repo).await?;
    Ok(())
}

async fn remove_disposable_generation_sidecars(repo: &HistoryRepository) -> Result<()> {
    let retained = sqlx::query_scalar::<_, String>(
        "SELECT sidecar_relative_path FROM search_index_generations
         WHERE source_id=? AND status IN ('active','building','failed')
         AND sidecar_relative_path IS NOT NULL",
    )
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .fetch_all(&repo.pool)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();
    SemanticIndexStore::new(&repo.semantic_index_root)?.remove_orphans(&retained)?;
    Ok(())
}

pub async fn reindex(repo: &HistoryRepository) -> Result<()> {
    enabled_config(repo).await?;
    let target = generation_by_status(repo, "active")
        .await?
        .or(generation_by_status(repo, "failed").await?)
        .context("no embedding space")?;
    create_building_generation(repo, &target.space_id).await?;
    Ok(())
}

pub async fn index_missing(repo: &HistoryRepository) -> Result<()> {
    enabled_config(repo).await?;
    if generation_by_status(repo, "building").await?.is_some() {
        return Ok(());
    }
    let active = generation_by_status(repo, "active")
        .await?
        .context("no active embedding generation")?;
    let sql = format!(
        "SELECT c.id FROM clip_items c WHERE {ELIGIBLE_CLIP_PREDICATE} AND NOT EXISTS(
           SELECT 1 FROM search_index_jobs j WHERE j.clip_id=c.id
           AND j.generation_id=? AND j.status='completed')"
    );
    let clips: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(&active.id)
        .fetch_all(&repo.pool)
        .await?;
    for clip in clips {
        enqueue_job(repo, &active.id, &clip).await?;
    }
    Ok(())
}

pub async fn enqueue_clip(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    if get_device_config(&repo.pool)
        .await?
        .is_none_or(|config| !config.enabled)
    {
        return Ok(());
    }
    if let Some(target) = target_generation_for_work(repo).await? {
        enqueue_job(repo, &target.id, clip_id).await?;
    }
    Ok(())
}

pub async fn clear_space(repo: &HistoryRepository, space: &str) -> Result<()> {
    sqlx::query("DELETE FROM search_embedding_spaces WHERE id=?")
        .bind(space)
        .execute(&repo.pool)
        .await?;
    remove_disposable_generation_sidecars(repo).await?;
    Ok(())
}

pub async fn recover_interrupted(repo: &HistoryRepository) -> Result<()> {
    sqlx::query(
        "UPDATE search_index_jobs SET status='pending',started_at=NULL,updated_at=? WHERE status='running'",
    )
    .bind(now_ms())
    .execute(&repo.pool)
    .await?;
    remove_disposable_generation_sidecars(repo).await?;
    Ok(())
}

pub async fn ensure_current_chunker(repo: &HistoryRepository) -> Result<bool> {
    let Some(config) = get_device_config(&repo.pool).await? else {
        return Ok(false);
    };
    if !config.enabled || generation_by_status(repo, "building").await?.is_some() {
        return Ok(false);
    }
    let Some(active) = generation_by_status(repo, "active").await? else {
        return Ok(false);
    };
    let version: String =
        sqlx::query_scalar("SELECT pipeline_version FROM search_index_generations WHERE id=?")
            .bind(&active.id)
            .fetch_one(&repo.pool)
            .await?;
    if version == PIPELINE_VERSION {
        return Ok(false);
    }
    create_building_generation(repo, &active.space_id).await?;
    Ok(true)
}

pub async fn retry_failed(repo: &HistoryRepository) -> Result<()> {
    enabled_config(repo).await?;
    cancel_building(repo).await?;
    let failed = generation_by_status(repo, "failed")
        .await?
        .context("no failed embedding generation")?;
    let mut tx = repo.pool.begin().await?;
    sqlx::query(
        "UPDATE search_index_generations SET status='building',completed_at=NULL,updated_at=? WHERE id=?",
    )
    .bind(now_ms())
    .bind(&failed.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE search_index_jobs SET status='pending',attempt_count=0,last_error=NULL,
         completed_at=NULL,updated_at=? WHERE generation_id=? AND status='failed'",
    )
    .bind(now_ms())
    .bind(&failed.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn validate_configured_provider(repo: &HistoryRepository) -> Result<()> {
    let config = enabled_config(repo).await?;
    let provider = providers::text_embedding_provider(&config, None)?;
    match provider.describe().await {
        Ok(_) => {
            record_provider_success(repo, &config.provider_id).await?;
            Ok(())
        }
        Err(error) => {
            record_provider_failure(repo, &config.provider_id, &error).await?;
            Err(error.into())
        }
    }
}

pub async fn semantic_matches(
    repo: &HistoryRepository,
    query: &str,
    eligible_ids: &HashSet<String>,
    limit: usize,
) -> Result<Vec<(String, f64, String)>> {
    let config = enabled_config(repo).await?;
    let active = generation_by_status(repo, "active")
        .await?
        .context("semantic index is still building")?;
    let model: String =
        sqlx::query_scalar("SELECT model_id FROM search_embedding_spaces WHERE id=?")
            .bind(&active.space_id)
            .fetch_one(&repo.pool)
            .await?;
    let provider = providers::text_embedding_provider(&config, Some(&model))?;
    semantic_matches_with_provider(repo, &active, provider.as_ref(), query, eligible_ids, limit)
        .await
}

async fn semantic_matches_with_provider(
    repo: &HistoryRepository,
    generation: &Generation,
    provider: &dyn TextEmbeddingProvider,
    query: &str,
    eligible_ids: &HashSet<String>,
    limit: usize,
) -> Result<Vec<(String, f64, String)>> {
    if limit == 0 || eligible_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query_vectors = provider.embed_queries(&[query.into()]).await?;
    let query_vector = query_vectors.pop().context("missing query embedding")?;
    validate_vector(&query_vector, Some(generation.dimensions))?;
    Ok(SemanticIndexStore::new(&repo.semantic_index_root)?
        .search(
            &generation.sidecar_relative_path,
            &generation.id,
            generation.dimensions,
            &query_vector,
            eligible_ids,
            limit,
        )
        .await?
        .into_iter()
        .map(|hit| (hit.clip_id, hit.score, hit.text))
        .collect())
}

async fn generation_by_status(
    repo: &HistoryRepository,
    status: &str,
) -> Result<Option<Generation>> {
    Ok(sqlx::query(
        "SELECT g.id,g.space_id,g.status,s.dimensions,g.sidecar_relative_path
         FROM search_index_generations g
         JOIN search_embedding_spaces s ON s.id=g.space_id
         WHERE g.source_id=? AND g.status=? ORDER BY g.generation DESC LIMIT 1",
    )
    .bind(SEMANTIC_TEXT_SOURCE_ID)
    .bind(status)
    .fetch_optional(&repo.pool)
    .await?
    .map(|row| Generation {
        id: row.get(0),
        space_id: row.get(1),
        status: row.get(2),
        dimensions: row.get::<i64, _>(3) as usize,
        sidecar_relative_path: row.get(4),
    }))
}

async fn target_generation_for_work(repo: &HistoryRepository) -> Result<Option<Generation>> {
    if let Some(building) = generation_by_status(repo, "building").await? {
        return Ok(Some(building));
    }
    generation_by_status(repo, "active").await
}

fn compatibility_sha256(space: &TextEmbeddingSpace) -> Result<String> {
    Ok(sha256(
        serde_json::to_string(&(
            &space.provider,
            space.dimensions,
            &space.normalization,
            &space.distance_metric,
            "text",
        ))?
        .as_bytes(),
    ))
}

async fn enabled_config(repo: &HistoryRepository) -> Result<TextEmbeddingProviderConfig> {
    let config = get_device_config(&repo.pool)
        .await?
        .context("embeddings are not configured")?;
    if !config.enabled {
        bail!("embeddings are disabled");
    }
    Ok(config)
}

async fn get_device_config(pool: &SqlitePool) -> Result<Option<TextEmbeddingProviderConfig>> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM config_device_values WHERE key=?")
            .bind(PROVIDER_CONFIG_KEY)
            .fetch_optional(pool)
            .await?;
    match raw.as_deref() {
        None | Some("null") => Ok(None),
        Some(value) => Ok(Some(serde_json::from_str(value)?)),
    }
}

async fn put_device_config(pool: &SqlitePool, config: &TextEmbeddingProviderConfig) -> Result<()> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO config_device_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
    )
    .bind(PROVIDER_CONFIG_KEY)
    .bind(serde_json::to_string(config)?)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

async fn record_provider_success(repo: &HistoryRepository, provider_id: &str) -> Result<()> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO provider_runtime_diagnostics(provider_id,capability,last_checked_at,last_success_at)
         VALUES(?,'text_embedding',?,?) ON CONFLICT(provider_id,capability) DO UPDATE SET
         last_checked_at=excluded.last_checked_at,last_success_at=excluded.last_success_at,
         last_error_code=NULL,last_error_message=NULL",
    )
    .bind(provider_id)
    .bind(now)
    .bind(now)
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn record_provider_failure(
    repo: &HistoryRepository,
    provider_id: &str,
    error: &ProviderError,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO provider_runtime_diagnostics(
           provider_id,capability,last_checked_at,last_error_code,last_error_message)
         VALUES(?,'text_embedding',?,?,?) ON CONFLICT(provider_id,capability) DO UPDATE SET
         last_checked_at=excluded.last_checked_at,last_error_code=excluded.last_error_code,
         last_error_message=excluded.last_error_message",
    )
    .bind(provider_id)
    .bind(now_ms())
    .bind(error.code())
    .bind(error.to_string().chars().take(512).collect::<String>())
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn provider_diagnostic(
    repo: &HistoryRepository,
    provider_id: &str,
) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT last_error_message FROM provider_runtime_diagnostics
         WHERE provider_id=? AND capability='text_embedding'",
    )
    .bind(provider_id)
    .fetch_optional(&repo.pool)
    .await?
    .flatten())
}

async fn embed_chunks_adaptively(
    provider: &dyn TextEmbeddingProvider,
    chunks: Vec<(SemanticInput, SemanticChunk)>,
) -> Result<Vec<(SemanticInput, SemanticChunk, Vec<f32>)>> {
    let groups = group_equal_embedding_inputs(chunks);
    let texts = groups
        .iter()
        .map(|group| group[0].1.embedding_text.clone())
        .collect::<Vec<_>>();
    match provider.embed_documents(&texts).await {
        Ok(vectors) => {
            if vectors.len() != groups.len() {
                bail!("embedding provider returned a different vector count than requested");
            }
            return Ok(groups
                .into_iter()
                .zip(vectors)
                .flat_map(|(group, vector)| {
                    group
                        .into_iter()
                        .map(move |(input, chunk)| (input, chunk, vector.clone()))
                })
                .collect());
        }
        Err(error) if !error.is_context_overflow() => return Err(error.into()),
        Err(_) => {}
    }
    let mut requests = 1;
    let mut queue: VecDeque<(Vec<(SemanticInput, SemanticChunk)>, u8)> =
        groups.into_iter().map(|group| (group, 0)).collect();
    let mut embedded = Vec::new();
    while let Some((group, depth)) = queue.pop_front() {
        if requests >= MAX_EMBED_REQUESTS_PER_CLIP {
            bail!("embedding provider retry budget exceeded for one clip");
        }
        requests += 1;
        let representative = &group[0].1;
        match provider
            .embed_documents(std::slice::from_ref(&representative.embedding_text))
            .await
        {
            Ok(mut vectors) if vectors.len() == 1 => {
                let vector = vectors.pop().expect("one vector was checked");
                embedded.extend(
                    group
                        .into_iter()
                        .map(|(input, chunk)| (input, chunk, vector.clone())),
                );
            }
            Ok(_) => bail!("embedding provider returned a different vector count than requested"),
            Err(error)
                if error.is_context_overflow()
                    && depth < MAX_FALLBACK_DEPTH
                    && representative.display_text.len() > MIN_FALLBACK_BYTES =>
            {
                let target = (representative.display_text.len() / 2).max(MIN_FALLBACK_BYTES);
                let mut children = Vec::new();
                for (input, chunk) in group {
                    children.extend(
                        chunking::subdivide_chunk(&chunk, target)
                            .into_iter()
                            .map(|child| (input.clone(), child)),
                    );
                }
                let child_groups = group_equal_embedding_inputs(children);
                if child_groups.len() < 2 {
                    return Err(error.into());
                }
                for child_group in child_groups.into_iter().rev() {
                    queue.push_front((child_group, depth + 1));
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    if embedded.len() > chunking::MAX_CHUNKS_PER_CLIP {
        bail!("provider subdivision exceeded the per-clip semantic chunk budget");
    }
    Ok(embedded)
}

fn group_equal_embedding_inputs(
    chunks: Vec<(SemanticInput, SemanticChunk)>,
) -> Vec<Vec<(SemanticInput, SemanticChunk)>> {
    let mut positions = HashMap::<String, usize>::new();
    let mut groups = Vec::<Vec<(SemanticInput, SemanticChunk)>>::new();
    for item in chunks {
        let text = item.1.embedding_text.clone();
        if let Some(position) = positions.get(&text) {
            groups[*position].push(item);
        } else {
            positions.insert(text, groups.len());
            groups.push(vec![item]);
        }
    }
    groups
}

fn validate_vector(vector: &[f32], dimensions: Option<usize>) -> Result<()> {
    if vector.is_empty()
        || dimensions.is_some_and(|expected| expected != vector.len())
        || vector.iter().any(|value| !value.is_finite())
    {
        bail!("invalid embedding vector");
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if !(0.98..=1.02).contains(&norm) {
        bail!("embedding vector is not L2 normalized");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        foundation::AppRoots,
        history::{CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot},
        providers::{contracts::ProviderDescriptor, error::ProviderResult},
    };
    use async_trait::async_trait;
    use sqlx::{Connection, SqliteConnection};
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    struct FakeProvider;

    struct CountingProvider {
        embedded_inputs: AtomicUsize,
    }

    #[async_trait]
    impl TextEmbeddingProvider for FakeProvider {
        async fn describe(&self) -> ProviderResult<TextEmbeddingSpace> {
            Ok(test_space())
        }
        async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
            Ok(inputs.iter().map(|_| vec![1.0, 0.0]).collect())
        }
        async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
            Ok(inputs.iter().map(|_| vec![1.0, 0.0]).collect())
        }
    }

    #[async_trait]
    impl TextEmbeddingProvider for CountingProvider {
        async fn describe(&self) -> ProviderResult<TextEmbeddingSpace> {
            Ok(test_space())
        }
        async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
            self.embedded_inputs
                .fetch_add(inputs.len(), AtomicOrdering::SeqCst);
            Ok(inputs.iter().map(|_| vec![1.0, 0.0]).collect())
        }
        async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
            Ok(inputs.iter().map(|_| vec![1.0, 0.0]).collect())
        }
    }

    fn test_space() -> TextEmbeddingSpace {
        TextEmbeddingSpace {
            provider: ProviderDescriptor {
                provider_id: "test.embedding".into(),
                provider_version: "1".into(),
                model_id: "test".into(),
                model_revision: "sha256:test".into(),
            },
            dimensions: 2,
            normalization: "l2".into(),
            distance_metric: "cosine".into(),
        }
    }

    fn duplicate_embedding_chunk(source_id: &str) -> (SemanticInput, SemanticChunk) {
        (
            SemanticInput {
                source_kind: "representation".into(),
                source_id: source_id.into(),
                representation_id: Some(source_id.into()),
                artifact_id: None,
                mime_type: Some("text/plain".into()),
                format_family: Some("text".into()),
                facets: Vec::new(),
                text: "same visible text".into(),
                source_ordinal: 0,
            },
            SemanticChunk {
                display_text: "same visible text".into(),
                embedding_text: "Section: shared\n\nsame visible text".into(),
                kind: "paragraph".into(),
                context_path: vec!["shared".into()],
                strategy_id: "test".into(),
                strategy_version: "1".into(),
                fallback_reason: None,
            },
        )
    }

    #[tokio::test]
    async fn complete_embedding_inputs_are_sent_to_provider_once() {
        let provider = CountingProvider {
            embedded_inputs: AtomicUsize::new(0),
        };
        let embedded = embed_chunks_adaptively(
            &provider,
            vec![
                duplicate_embedding_chunk("first"),
                duplicate_embedding_chunk("second"),
            ],
        )
        .await
        .unwrap();
        assert_eq!(embedded.len(), 2);
        assert_eq!(provider.embedded_inputs.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(embedded[0].2, embedded[1].2);
    }

    async fn repository() -> (tempfile::TempDir, HistoryRepository) {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        (temp, repo)
    }

    async fn insert_text_clip(repo: &HistoryRepository, text: &str) -> String {
        repo.capture(
            CapturedSnapshot {
                token: 1,
                source_app_name: None,
                source_app_id: None,
                representations: vec![CapturedRepresentation {
                    format_key: "mime:text/plain".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 0,
                    payload: CapturedPayload::Text(text.into()),
                }],
                format_observations: Vec::new(),
            },
            &CaptureSettings::default(),
        )
        .await
        .unwrap()
        .0
    }

    async fn insert_generation(repo: &HistoryRepository) -> (Generation, BuildingSidecar) {
        let compatibility = compatibility_sha256(&test_space()).unwrap();
        sqlx::query(
            "INSERT INTO search_embedding_spaces(
              id,provider_id,provider_version,model_id,model_revision,compatibility_sha256,
              modality,dimensions,normalization,distance_metric,created_at)
             VALUES('space','test.embedding','1','test','sha256:test',?,'text',2,'l2','cosine',?)",
        )
        .bind(compatibility)
        .bind(now_ms())
        .execute(&repo.pool)
        .await
        .unwrap();
        let store = SemanticIndexStore::new(&repo.semantic_index_root).unwrap();
        let finalized = store
            .create("generation", 2)
            .await
            .unwrap()
            .finalize()
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO search_index_generations(
              id,source_id,space_id,generation,pipeline_version,status,sidecar_relative_path,
              sidecar_byte_length,sidecar_sha256,created_at,updated_at,activated_at)
             VALUES('generation',?,'space',1,?,'active',?,?,?,?,?,?)",
        )
        .bind(SEMANTIC_TEXT_SOURCE_ID)
        .bind(PIPELINE_VERSION)
        .bind(&finalized.relative_path)
        .bind(finalized.byte_length as i64)
        .bind(&finalized.sha256)
        .bind(now_ms())
        .bind(now_ms())
        .bind(now_ms())
        .execute(&repo.pool)
        .await
        .unwrap();
        let generation = generation_by_status(repo, "active").await.unwrap().unwrap();
        let writer = store
            .open_active(&finalized.relative_path, "generation", 2)
            .await
            .unwrap();
        (generation, writer)
    }

    #[tokio::test]
    async fn normalized_chunks_and_exact_filtering_work() {
        let (_temp, repo) = repository().await;
        let first = insert_text_clip(&repo, "first semantic paragraph").await;
        let second = insert_text_clip(&repo, "second semantic paragraph").await;
        let (generation, mut writer) = insert_generation(&repo).await;
        index_clip(&repo, &mut writer, &FakeProvider, &first)
            .await
            .unwrap();
        index_clip(&repo, &mut writer, &FakeProvider, &second)
            .await
            .unwrap();
        writer.close().await.unwrap();
        let matches = semantic_matches_with_provider(
            &repo,
            &generation,
            &FakeProvider,
            "query",
            &HashSet::from([second.clone()]),
            10,
        )
        .await
        .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].0, second);
    }

    #[tokio::test]
    async fn ocr_chunks_are_owned_only_by_the_artifact() {
        let (_temp, repo) = repository().await;
        let clip_id = insert_text_clip(&repo, "source representation").await;
        let representation_id: String =
            sqlx::query_scalar("SELECT id FROM clip_representations WHERE clip_id=?")
                .bind(&clip_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO artifact_records(
                id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,
                input_manifest_sha256,lifecycle_state,created_at,updated_at
             ) VALUES('ocr-artifact',?,'ocr','builtin.artifact.ocr','1',?,?,'ready',?,?)",
        )
        .bind(&clip_id)
        .bind("a".repeat(64))
        .bind("b".repeat(64))
        .bind(now)
        .bind(now)
        .execute(&repo.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256)
             VALUES('ocr-artifact',0,?,?)",
        )
        .bind(&representation_id)
        .bind("c".repeat(64))
        .execute(&repo.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO artifact_text_values(artifact_id,text_value,utf8_byte_length,sha256)
             VALUES('ocr-artifact','recognized words',16,?)",
        )
        .bind(sha256(b"recognized words"))
        .execute(&repo.pool)
        .await
        .unwrap();
        let (generation, mut writer) = insert_generation(&repo).await;

        index_clip(&repo, &mut writer, &FakeProvider, &clip_id)
            .await
            .unwrap();
        writer.close().await.unwrap();

        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(
                repo.semantic_index_root
                    .join(&generation.sidecar_relative_path),
            )
            .read_only(true);
        let mut sidecar = SqliteConnection::connect_with(&options).await.unwrap();
        let row = sqlx::query(
            "SELECT representation_id,artifact_id FROM semantic_chunks
             WHERE artifact_id='ocr-artifact'",
        )
        .fetch_one(&mut sidecar)
        .await
        .unwrap();
        assert_eq!(row.get::<Option<String>, _>(0), None);
        assert_eq!(
            row.get::<Option<String>, _>(1).as_deref(),
            Some("ocr-artifact")
        );
    }

    #[tokio::test]
    async fn completed_build_is_finalized_before_atomic_activation() {
        let (_temp, repo) = repository().await;
        let clip_id = insert_text_clip(&repo, "activation content").await;
        let compatibility = compatibility_sha256(&test_space()).unwrap();
        sqlx::query(
            "INSERT INTO search_embedding_spaces(
              id,provider_id,provider_version,model_id,model_revision,compatibility_sha256,
              modality,dimensions,normalization,distance_metric,created_at)
             VALUES('activation-space','test.embedding','1','test','sha256:test',?,
                    'text',2,'l2','cosine',?)",
        )
        .bind(compatibility)
        .bind(now_ms())
        .execute(&repo.pool)
        .await
        .unwrap();
        let generation = create_building_generation(&repo, "activation-space")
            .await
            .unwrap();
        let store = SemanticIndexStore::new(&repo.semantic_index_root).unwrap();
        let mut writer = store
            .open_building(
                &generation.sidecar_relative_path,
                &generation.id,
                generation.dimensions,
            )
            .await
            .unwrap();
        index_clip(&repo, &mut writer, &FakeProvider, &clip_id)
            .await
            .unwrap();
        writer.close().await.unwrap();
        sqlx::query(
            "UPDATE search_index_jobs SET status='completed',completed_at=?,updated_at=?
             WHERE generation_id=?",
        )
        .bind(now_ms())
        .bind(now_ms())
        .bind(&generation.id)
        .execute(&repo.pool)
        .await
        .unwrap();

        settle_generation(&repo, &generation).await.unwrap();
        let active = generation_by_status(&repo, "active")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(active.id, generation.id);
        let checksum: String =
            sqlx::query_scalar("SELECT sidecar_sha256 FROM search_index_generations WHERE id=?")
                .bind(&active.id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        store
            .validate(
                &active.sidecar_relative_path,
                &active.id,
                active.dimensions,
                Some(&checksum),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn schema_rejects_two_active_generations() {
        let (_temp, repo) = repository().await;
        let (_, writer) = insert_generation(&repo).await;
        writer.close().await.unwrap();
        let result = sqlx::query(
            "INSERT INTO search_index_generations(
             id,source_id,space_id,generation,pipeline_version,status,sidecar_relative_path,
             created_at,updated_at)
             VALUES('other',?,'space',2,?,'active','generation-other.sqlite',?,?)",
        )
        .bind(SEMANTIC_TEXT_SOURCE_ID)
        .bind(PIPELINE_VERSION)
        .bind(now_ms())
        .bind(now_ms())
        .execute(&repo.pool)
        .await;
        assert!(result.is_err());
    }
}
