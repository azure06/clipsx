//! Semantic chunking, indexing, and hybrid vector ranking.
use crate::history::{new_id, now_ms, sha256, HistoryRepository};
use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::{collections::VecDeque, fmt, net::IpAddr, time::Duration};
use url::Url;

const CHUNKER_ID: &str = "builtin.chunker.text-window";
const CHUNKER_VERSION: &str = "2";
const MAX_CHUNK_BYTES: usize = 2_048;
const CHUNK_OVERLAP_BYTES: usize = 256;
const MAX_EMBED_BATCH: usize = 16;
const MIN_FALLBACK_BYTES: usize = 128;
const MAX_FALLBACK_DEPTH: u8 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaEndpointStatus {
    pub reachable: bool,
    pub endpoint: String,
    pub diagnostic: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelDescriptor {
    pub name: String,
    pub digest: Option<String>,
    pub size: Option<u64>,
}
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
    pub total_clips: u64,
    pub endpoint: Option<String>,
    pub model: Option<String>,
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

/// Stable host contribution contract. WASM packages may consume this shape in
/// M5, but they cannot register providers: network and credentials stay host-owned.
#[async_trait]
pub trait TextEmbeddingProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str;
    async fn describe(&self, model: &str) -> Result<EmbeddingProviderDescriptor>;
    async fn discover_models(&self) -> Result<Vec<OllamaModelDescriptor>>;
    async fn embed_documents(&self, input: &[String]) -> Result<Vec<Vec<f32>>>;
    async fn embed_query(&self, input: &str) -> Result<Vec<f32>>;
}

#[allow(dead_code)]
pub struct DisabledTextEmbeddingProvider;
#[async_trait]
impl TextEmbeddingProvider for DisabledTextEmbeddingProvider {
    fn id(&self) -> &'static str {
        "builtin.embedding.disabled"
    }
    fn version(&self) -> &'static str {
        "1"
    }
    async fn describe(&self, _: &str) -> Result<EmbeddingProviderDescriptor> {
        bail!("text embeddings are disabled")
    }
    async fn discover_models(&self) -> Result<Vec<OllamaModelDescriptor>> {
        Ok(vec![])
    }
    async fn embed_documents(&self, _: &[String]) -> Result<Vec<Vec<f32>>> {
        bail!("text embeddings are disabled")
    }
    async fn embed_query(&self, _: &str) -> Result<Vec<f32>> {
        bail!("text embeddings are disabled")
    }
}

pub struct OllamaTextEmbeddingProvider {
    endpoint: Url,
    model: String,
    client: Client,
}
impl OllamaTextEmbeddingProvider {
    pub async fn new(endpoint: &str, model: String) -> Result<Self> {
        let endpoint = validated_endpoint(endpoint).await?;
        let client = Client::builder().redirect(Policy::none()).build()?;
        Ok(Self {
            endpoint,
            model,
            client,
        })
    }
    fn api(&self, path: &str) -> Result<Url> {
        self.endpoint.join(path).map_err(Into::into)
    }
    async fn request(
        &self,
        path: &str,
        value: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value> {
        let response = self
            .client
            .post(self.api(path)?)
            .timeout(timeout)
            .json(&value)
            .send()
            .await?;
        if response.status().is_redirection() {
            bail!("Ollama redirect rejected")
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(OllamaRequestError::new(status.as_u16(), path, &self.model, &body).into());
        }
        Ok(response.json().await?)
    }
}
#[async_trait]
impl TextEmbeddingProvider for OllamaTextEmbeddingProvider {
    fn id(&self) -> &'static str {
        "builtin.embedding.ollama"
    }
    fn version(&self) -> &'static str {
        "1"
    }
    async fn discover_models(&self) -> Result<Vec<OllamaModelDescriptor>> {
        let response = self
            .client
            .get(self.api("api/tags")?)
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(OllamaRequestError::new(status.as_u16(), "api/tags", "", &body).into());
        }
        let json: serde_json::Value = response.json().await?;
        Ok(json["models"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|m| {
                Some(OllamaModelDescriptor {
                    name: m["name"].as_str()?.to_string(),
                    digest: m["digest"].as_str().map(str::to_string),
                    size: m["size"].as_u64(),
                })
            })
            .collect())
    }
    async fn describe(&self, model: &str) -> Result<EmbeddingProviderDescriptor> {
        let show = self
            .request(
                "api/show",
                serde_json::json!({"model": model}),
                Duration::from_secs(10),
            )
            .await?;
        let vector = self
            .embed_query("clipsx embedding capability probe")
            .await?;
        validate_vector(&vector, Some(vector.len()))?;
        Ok(EmbeddingProviderDescriptor {
            provider_kind: self.id().into(),
            provider_version: self.version().into(),
            endpoint: self.endpoint.to_string(),
            model: model.into(),
            model_digest: show["details"]["digest"]
                .as_str()
                .or(show["digest"].as_str())
                .unwrap_or(model)
                .into(),
            dimensions: vector.len() as u32,
            normalization: "l2".into(),
            modality: "text".into(),
            distance_metric: "cosine".into(),
        })
    }
    async fn embed_documents(&self, input: &[String]) -> Result<Vec<Vec<f32>>> {
        let mut vectors = Vec::with_capacity(input.len());
        for batch in input.chunks(MAX_EMBED_BATCH) {
            if let Some(oversized) = batch.iter().find(|value| value.len() > MAX_CHUNK_BYTES) {
                bail!(
                    "internal embedding chunk exceeds the {}-byte limit ({} bytes)",
                    MAX_CHUNK_BYTES,
                    oversized.len()
                )
            }
            let value = self
                .request(
                    "api/embed",
                    serde_json::json!({"model": self.model, "input": batch, "truncate": false}),
                    Duration::from_secs(60),
                )
                .await?;
            vectors.extend(parse_vectors(&value, batch.len())?);
        }
        Ok(vectors)
    }
    async fn embed_query(&self, input: &str) -> Result<Vec<f32>> {
        Ok(self
            .embed_documents(&[input.into()])
            .await?
            .into_iter()
            .next()
            .context("missing query embedding")?)
    }
}

#[derive(Debug)]
struct OllamaRequestError {
    status: u16,
    path: String,
    model: String,
    detail: Option<String>,
}

impl OllamaRequestError {
    fn new(status: u16, path: &str, model: &str, body: &str) -> Self {
        let detail = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value["error"].as_str().map(str::to_owned))
            .or_else(|| (!body.trim().is_empty()).then(|| body.trim().to_owned()))
            .map(|detail| detail.chars().take(300).collect::<String>());
        Self {
            status,
            path: path.into(),
            model: model.into(),
            detail,
        }
    }

    fn is_context_length(&self) -> bool {
        self.status == 400
            && self.path == "api/embed"
            && self.detail.as_deref().is_some_and(|detail| {
                let detail = detail.to_ascii_lowercase();
                detail.contains("context length")
                    || detail.contains("context window")
                    || detail.contains("too long")
            })
    }
}

impl fmt::Display for OllamaRequestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let target = format!("/{}", self.path.trim_start_matches('/'));
        let detail = self
            .detail
            .as_deref()
            .map(|detail| format!(": {detail}"))
            .unwrap_or_default();
        let guidance = if self.status == 400 && self.path == "api/embed" {
            format!(
                " Check that {} is an installed text-embedding model and that Ollama is up to date; the response above may also identify input that exceeds the model context.",
                if self.model.is_empty() {
                    "the selected model"
                } else {
                    &self.model
                }
            )
        } else {
            String::new()
        };
        write!(
            formatter,
            "Ollama rejected {target} (HTTP {}){detail}.{guidance}",
            self.status
        )
    }
}

impl std::error::Error for OllamaRequestError {}

#[cfg(test)]
fn ollama_request_error(status: u16, path: &str, model: &str, body: &str) -> String {
    OllamaRequestError::new(status, path, model, body).to_string()
}

pub async fn probe_endpoint(endpoint: String) -> OllamaEndpointStatus {
    let result = match OllamaTextEmbeddingProvider::new(&endpoint, "unused".into()).await {
        Ok(provider) => provider.discover_models().await.map(|_| ()),
        Err(error) => Err(error),
    };
    match result {
        Ok(_) => OllamaEndpointStatus {
            reachable: true,
            endpoint,
            diagnostic: None,
        },
        Err(error) => OllamaEndpointStatus {
            reachable: false,
            endpoint,
            diagnostic: Some(error.to_string()),
        },
    }
}
pub async fn list_models(endpoint: String) -> Result<Vec<OllamaModelDescriptor>> {
    OllamaTextEmbeddingProvider::new(&endpoint, "unused".into())
        .await?
        .discover_models()
        .await
}
pub async fn probe_model(endpoint: String, model: String) -> Result<EmbeddingProviderDescriptor> {
    OllamaTextEmbeddingProvider::new(&endpoint, model.clone())
        .await?
        .describe(&model)
        .await
}

pub async fn configure(
    repo: &HistoryRepository,
    endpoint: String,
    model: String,
) -> Result<ProviderStatus> {
    let provider = OllamaTextEmbeddingProvider::new(&endpoint, model.clone()).await?;
    let descriptor = provider.describe(&model).await?;
    let descriptor_json = serde_json::to_string(&descriptor)?;
    let fingerprint = sha256(descriptor_json.as_bytes());
    let space_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM search_embedding_spaces WHERE descriptor_sha256=?",
    )
    .bind(&fingerprint)
    .fetch_optional(&repo.pool)
    .await?
    .unwrap_or_else(new_id);
    sqlx::query("INSERT OR IGNORE INTO search_embedding_spaces(id,provider_kind,descriptor_json,descriptor_sha256,modality,dimensions,normalization,distance_metric,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(&space_id).bind(&descriptor.provider_kind).bind(&descriptor_json).bind(&fingerprint).bind("text").bind(descriptor.dimensions as i64).bind("l2").bind("cosine").bind(now_ms()).execute(&repo.pool).await?;
    let previous = get_space_state(&repo.pool).await?;
    let active = previous
        .as_ref()
        .and_then(|value| value["activeSpaceId"].as_str())
        .map(str::to_string);
    let active_generation = previous
        .as_ref()
        .and_then(|value| value["activeGeneration"].as_i64());
    let generation = next_generation(repo, &space_id).await?;
    put_device_config(
        &repo.pool,
        &serde_json::json!({"endpoint": endpoint, "model": model, "enabled": true}),
    )
    .await?;
    put_space_state(
        &repo.pool,
        &serde_json::json!({
            "pendingSpaceId": space_id,
            "pendingGeneration": generation,
            "activeSpaceId": active,
            "activeGeneration": active_generation
        }),
    )
    .await?;
    enqueue_all(repo, &space_id, generation).await?;
    status(repo).await
}
pub async fn disable(repo: &HistoryRepository) -> Result<()> {
    let Some(mut config) = get_device_config(&repo.pool).await? else {
        return Ok(());
    };
    config["enabled"] = serde_json::Value::Bool(false);
    put_device_config(&repo.pool, &config).await
}
pub async fn status(repo: &HistoryRepository) -> Result<ProviderStatus> {
    let device = get_device_config(&repo.pool).await?;
    let state = get_space_state(&repo.pool)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(value) = device else {
        return Ok(ProviderStatus {
            enabled: false,
            phase: ProviderPhase::NotConfigured,
            active_space_id: None,
            pending_space_id: None,
            diagnostic: None,
            indexed_clips: 0,
            pending_jobs: 0,
            failed_jobs: 0,
            total_clips: 0,
            endpoint: None,
            model: None,
        });
    };
    let enabled = value["enabled"].as_bool().unwrap_or(false);
    let pending = state["pendingSpaceId"].as_str().map(str::to_string);
    let pending_generation = state["pendingGeneration"].as_i64();
    let active = state["activeSpaceId"].as_str().map(str::to_string);
    let active_generation = state["activeGeneration"].as_i64();
    let endpoint = value["endpoint"].as_str().map(str::to_string);
    let model = value["model"].as_str().map(str::to_string);
    let target_space = pending.as_ref().or(active.as_ref());
    let target_generation = pending_generation.or(active_generation);
    let indexed: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT clip_id) FROM search_index_jobs WHERE space_id=? AND generation=? AND status='completed'",
    )
    .bind(target_space)
    .bind(target_generation)
    .fetch_one(&repo.pool)
    .await?;
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM search_index_jobs WHERE space_id=? AND generation=? AND status IN ('pending','running')").bind(target_space).bind(target_generation).fetch_one(&repo.pool).await?;
    let failed: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM search_index_jobs WHERE space_id=? AND generation=? AND status='failed'",
    )
    .bind(target_space)
    .bind(target_generation)
    .fetch_one(&repo.pool)
    .await?;
    let total: i64 =
        sqlx::query_scalar("SELECT count(*) FROM clip_items WHERE lifecycle_state='ready'")
            .fetch_one(&repo.pool)
            .await?;
    let job_diagnostic: Option<String> = sqlx::query_scalar("SELECT last_error FROM search_index_jobs WHERE space_id=? AND generation=? AND status='failed' AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(target_space).bind(target_generation).fetch_optional(&repo.pool).await?;
    let diagnostic = value["lastDiagnostic"]
        .as_str()
        .map(str::to_string)
        .or(job_diagnostic);
    let phase = if !enabled {
        ProviderPhase::Disabled
    } else if diagnostic.is_some() || failed > 0 || active.is_none() && pending.is_none() {
        ProviderPhase::Degraded
    } else if pending.is_some() || jobs > 0 {
        ProviderPhase::Indexing
    } else {
        ProviderPhase::Ready
    };
    Ok(ProviderStatus {
        enabled,
        phase,
        active_space_id: active,
        pending_space_id: pending,
        diagnostic,
        indexed_clips: indexed as u64,
        pending_jobs: jobs as u64,
        failed_jobs: failed as u64,
        total_clips: total as u64,
        endpoint,
        model,
    })
}

pub async fn index_pending(repo: &HistoryRepository) -> Result<u64> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings are disabled")?;
    let space = config["pendingSpaceId"]
        .as_str()
        .or(config["activeSpaceId"].as_str())
        .context("no embedding space")?
        .to_string();
    let generation = config["pendingGeneration"]
        .as_i64()
        .or(config["activeGeneration"].as_i64())
        .context("no embedding generation")?;
    let provider = OllamaTextEmbeddingProvider::new(
        config["endpoint"].as_str().context("missing endpoint")?,
        config["model"].as_str().context("missing model")?.into(),
    )
    .await?;
    let rows = sqlx::query("SELECT id,clip_id,generation FROM search_index_jobs WHERE space_id=? AND generation=? AND status='pending' ORDER BY requested_at LIMIT 16").bind(&space).bind(generation).fetch_all(&repo.pool).await?;
    let mut count = 0;
    for row in rows {
        count += 1;
        let id: String = row.get(0);
        let clip: String = row.get(1);
        let generation: i64 = row.get(2);
        sqlx::query("UPDATE search_index_jobs SET status='running',started_at=?,updated_at=?,attempt_count=attempt_count+1 WHERE id=?").bind(now_ms()).bind(now_ms()).bind(&id).execute(&repo.pool).await?;
        match index_clip(repo, &provider, &space, &clip, generation).await {
            Ok(()) => {
                sqlx::query(
                    "UPDATE search_index_jobs SET status='completed',completed_at=?,updated_at=? WHERE id=?",
                )
                .bind(now_ms())
                .bind(now_ms())
                .bind(&id)
                .execute(&repo.pool)
                .await?;
            }
            Err(error) => {
                sqlx::query("UPDATE search_index_jobs SET status=CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,last_error=?,completed_at=?,updated_at=? WHERE id=?").bind(error.to_string()).bind(now_ms()).bind(now_ms()).bind(&id).execute(&repo.pool).await?;
            }
        }
    }
    let pending:i64=sqlx::query_scalar("SELECT count(*) FROM search_index_jobs WHERE space_id=? AND generation=? AND status IN ('pending','running')").bind(&space).bind(generation).fetch_one(&repo.pool).await?;
    if pending == 0 {
        let failed: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM search_index_jobs WHERE space_id=? AND generation=? AND status='failed'",
        )
        .bind(&space)
        .bind(generation)
        .fetch_one(&repo.pool)
        .await?;
        let mut promoted = get_space_state(&repo.pool)
            .await?
            .unwrap_or_else(|| serde_json::json!({}));
        let is_pending_generation = promoted["pendingSpaceId"].as_str() == Some(space.as_str())
            && promoted["pendingGeneration"].as_i64() == Some(generation);
        if failed == 0 && is_pending_generation {
            promoted["activeSpaceId"] = serde_json::Value::String(space.clone());
            promoted["activeGeneration"] = serde_json::Value::Number(generation.into());
            promoted["pendingSpaceId"] = serde_json::Value::Null;
            promoted["pendingGeneration"] = serde_json::Value::Null;
            put_space_state(&repo.pool, &promoted).await?;
            sqlx::query("DELETE FROM search_chunks WHERE space_id=? AND generation<>?")
                .bind(&space)
                .bind(generation)
                .execute(&repo.pool)
                .await?;
            sqlx::query("DELETE FROM search_index_jobs WHERE space_id=? AND generation<>?")
                .bind(&space)
                .bind(generation)
                .execute(&repo.pool)
                .await?;
        }
    }
    Ok(count)
}

async fn index_clip(
    repo: &HistoryRepository,
    provider: &OllamaTextEmbeddingProvider,
    space: &str,
    clip: &str,
    generation: i64,
) -> Result<()> {
    let text: String =
        sqlx::query_scalar("SELECT search_text FROM search_documents WHERE clip_id=?")
            .bind(clip)
            .fetch_optional(&repo.pool)
            .await?
            .unwrap_or_default();
    let manifest: String =
        sqlx::query_scalar("SELECT source_manifest_json FROM search_documents WHERE clip_id=?")
            .bind(clip)
            .fetch_optional(&repo.pool)
            .await?
            .unwrap_or_else(|| "[]".into());
    let projection = sha256(format!("{CHUNKER_VERSION}:{manifest}:{text}").as_bytes());
    let chunks = chunk_text(&text);
    if chunks.is_empty() {
        sqlx::query("DELETE FROM search_chunks WHERE space_id=? AND clip_id=? AND generation=?")
            .bind(space)
            .bind(clip)
            .bind(generation)
            .execute(&repo.pool)
            .await?;
        return Ok(());
    }
    let embedded = embed_chunks_adaptively(provider, chunks).await?;
    let dimensions: i64 =
        sqlx::query_scalar("SELECT dimensions FROM search_embedding_spaces WHERE id=?")
            .bind(space)
            .fetch_one(&repo.pool)
            .await?;
    let mut tx = repo.pool.begin().await?;
    sqlx::query("DELETE FROM search_chunks WHERE space_id=? AND clip_id=? AND generation=?")
        .bind(space)
        .bind(clip)
        .bind(generation)
        .execute(&mut *tx)
        .await?;
    for (ordinal, (text, vector)) in embedded.into_iter().enumerate() {
        validate_vector(&vector, Some(dimensions as usize))?;
        let chunk_id = new_id();
        sqlx::query("INSERT INTO search_chunks(id,clip_id,space_id,ordinal,chunk_kind,text_value,text_sha256,source_manifest_json,projection_sha256,chunker_id,chunker_version,generation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&chunk_id).bind(clip).bind(space).bind(ordinal as i64).bind("text").bind(&text).bind(sha256(text.as_bytes())).bind(&manifest).bind(&projection).bind(CHUNKER_ID).bind(CHUNKER_VERSION).bind(generation).bind(now_ms()).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO search_embeddings(id,space_id,clip_id,representation_id,artifact_id,vector,created_at,chunk_id) VALUES(?,?,?,?,?,?,?,?)").bind(new_id()).bind(space).bind(clip).bind(Option::<String>::None).bind(Option::<String>::None).bind(vector_blob(&vector)).bind(now_ms()).bind(&chunk_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
async fn enqueue_all(repo: &HistoryRepository, space: &str, generation: i64) -> Result<()> {
    let clips: Vec<String> =
        sqlx::query_scalar("SELECT id FROM clip_items WHERE lifecycle_state='ready'")
            .fetch_all(&repo.pool)
            .await?;
    for clip in clips {
        sqlx::query("INSERT OR IGNORE INTO search_index_jobs(id,space_id,clip_id,status,requested_at,generation,chunker_version) VALUES(?,?,?,'pending',?,?,?)").bind(new_id()).bind(space).bind(clip).bind(now_ms()).bind(generation).bind(CHUNKER_VERSION).execute(&repo.pool).await?;
    }
    Ok(())
}

async fn next_generation(repo: &HistoryRepository, space: &str) -> Result<i64> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(MAX(generation),0)+1 FROM search_index_jobs WHERE space_id=?",
    )
    .bind(space)
    .fetch_one(&repo.pool)
    .await?)
}

pub async fn reindex(repo: &HistoryRepository) -> Result<()> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings are disabled")?;
    let space = config["pendingSpaceId"]
        .as_str()
        .or(config["activeSpaceId"].as_str())
        .context("no space")?
        .to_string();
    let generation = next_generation(repo, &space).await?;
    sqlx::query("UPDATE search_index_jobs SET status='cancelled',updated_at=? WHERE status IN ('pending','running')")
        .bind(now_ms()).execute(&repo.pool).await?;
    let mut state = get_space_state(&repo.pool)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    state["pendingSpaceId"] = serde_json::Value::String(space.clone());
    state["pendingGeneration"] = serde_json::Value::Number(generation.into());
    put_space_state(&repo.pool, &state).await?;
    enqueue_all(repo, &space, generation).await
}
pub async fn index_missing(repo: &HistoryRepository) -> Result<()> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings are disabled")?;
    if config["pendingSpaceId"].is_string() {
        return Ok(());
    }
    let space = config["activeSpaceId"]
        .as_str()
        .context("no active space")?;
    let generation = config["activeGeneration"]
        .as_i64()
        .context("no active generation")?;
    let clips: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM clip_items WHERE lifecycle_state='ready' \
         AND NOT EXISTS (SELECT 1 FROM search_chunks sc WHERE sc.clip_id=clip_items.id AND sc.space_id=? AND sc.generation=?)"
    )
    .bind(space)
    .bind(generation)
    .fetch_all(&repo.pool)
    .await?;
    for clip in clips {
        sqlx::query("INSERT OR IGNORE INTO search_index_jobs(id,space_id,clip_id,status,requested_at,generation,chunker_version) VALUES(?,?,?,'pending',?,?,?)")
            .bind(new_id()).bind(space).bind(clip).bind(now_ms()).bind(generation).bind(CHUNKER_VERSION)
            .execute(&repo.pool).await?;
    }
    Ok(())
}
pub async fn enqueue_clip(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    let config = match get_config(&repo.pool).await? {
        Some(value) => value,
        None => return Ok(()),
    };
    let (Some(space), Some(generation)) = (
        config["pendingSpaceId"]
            .as_str()
            .or(config["activeSpaceId"].as_str()),
        config["pendingGeneration"]
            .as_i64()
            .or(config["activeGeneration"].as_i64()),
    ) else {
        return Ok(());
    };
    sqlx::query("INSERT OR IGNORE INTO search_index_jobs(id,space_id,clip_id,status,requested_at,generation,chunker_version) VALUES(?,?,?,'pending',?,?,?)")
        .bind(new_id()).bind(space).bind(clip_id).bind(now_ms()).bind(generation).bind(CHUNKER_VERSION).execute(&repo.pool).await?;
    Ok(())
}
pub async fn clear_space(repo: &HistoryRepository, space: &str) -> Result<()> {
    sqlx::query("DELETE FROM search_embedding_spaces WHERE id=?")
        .bind(space)
        .execute(&repo.pool)
        .await?;
    if let Some(mut state) = get_space_state(&repo.pool).await? {
        if state["activeSpaceId"].as_str() == Some(space) {
            state["activeSpaceId"] = serde_json::Value::Null;
            state["activeGeneration"] = serde_json::Value::Null;
        }
        if state["pendingSpaceId"].as_str() == Some(space) {
            state["pendingSpaceId"] = serde_json::Value::Null;
            state["pendingGeneration"] = serde_json::Value::Null;
        }
        put_space_state(&repo.pool, &state).await?;
    }
    Ok(())
}

pub async fn recover_interrupted(repo: &HistoryRepository) -> Result<()> {
    sqlx::query("UPDATE search_index_jobs SET status='pending',started_at=NULL,updated_at=? WHERE status='running'")
        .bind(now_ms()).execute(&repo.pool).await?;
    Ok(())
}

pub async fn ensure_current_chunker(repo: &HistoryRepository) -> Result<bool> {
    let Some(config) = get_config(&repo.pool).await? else {
        return Ok(false);
    };
    if config["pendingSpaceId"].is_string() {
        let current_pending: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM search_index_jobs WHERE space_id=? AND generation=? AND chunker_version=? AND status IN ('pending','running','completed')",
        )
        .bind(config["pendingSpaceId"].as_str())
        .bind(config["pendingGeneration"].as_i64())
        .bind(CHUNKER_VERSION)
        .fetch_one(&repo.pool)
        .await?;
        if current_pending > 0 {
            return Ok(false);
        }
    }
    let (Some(space), Some(generation)) = (
        config["activeSpaceId"].as_str(),
        config["activeGeneration"].as_i64(),
    ) else {
        return Ok(false);
    };
    let stale: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM search_chunks WHERE space_id=? AND generation=? AND (chunker_id<>? OR chunker_version<>?)",
    )
    .bind(space)
    .bind(generation)
    .bind(CHUNKER_ID)
    .bind(CHUNKER_VERSION)
    .fetch_one(&repo.pool)
    .await?;
    if stale == 0 {
        return Ok(false);
    }
    reindex(repo).await?;
    Ok(true)
}

pub async fn retry_failed(repo: &HistoryRepository) -> Result<()> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings are disabled")?;
    let space = config["pendingSpaceId"]
        .as_str()
        .or(config["activeSpaceId"].as_str())
        .context("no embedding space")?;
    let generation = config["pendingGeneration"]
        .as_i64()
        .or(config["activeGeneration"].as_i64())
        .context("no embedding generation")?;
    sqlx::query("UPDATE search_index_jobs SET status='pending',attempt_count=0,last_error=NULL,completed_at=NULL,updated_at=? WHERE space_id=? AND generation=? AND status='failed'")
        .bind(now_ms()).bind(space).bind(generation).execute(&repo.pool).await?;
    Ok(())
}

pub async fn validate_configured_provider(repo: &HistoryRepository) -> Result<()> {
    let Some(mut device) = get_device_config(&repo.pool).await? else {
        bail!("embeddings are not configured");
    };
    if !device["enabled"].as_bool().unwrap_or(false) {
        bail!("embeddings are disabled");
    }
    let endpoint = device["endpoint"]
        .as_str()
        .context("missing endpoint")?
        .to_string();
    let model = device["model"]
        .as_str()
        .context("missing model")?
        .to_string();
    match probe_model(endpoint, model).await {
        Ok(_) => {
            device["lastDiagnostic"] = serde_json::Value::Null;
            put_device_config(&repo.pool, &device).await?;
            Ok(())
        }
        Err(error) => {
            device["lastDiagnostic"] = serde_json::Value::String(error.to_string());
            put_device_config(&repo.pool, &device).await?;
            Err(error)
        }
    }
}

pub async fn semantic_matches(
    repo: &HistoryRepository,
    query: &str,
    eligible_ids: &HashSet<String>,
    limit: usize,
) -> Result<Vec<(String, f64, String)>> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings disabled")?;
    let space = config["activeSpaceId"]
        .as_str()
        .context("semantic index is still building")?;
    let generation = config["activeGeneration"]
        .as_i64()
        .context("semantic index generation is unavailable")?;
    let provider = provider_for_space(repo, space).await?;
    let query_vector = provider.embed_query(query).await?;
    let rows=sqlx::query("SELECT sc.clip_id,se.vector,sc.text_value FROM search_embeddings se JOIN search_chunks sc ON sc.id=se.chunk_id WHERE se.space_id=? AND sc.generation=? ORDER BY sc.clip_id").bind(space).bind(generation).fetch_all(&repo.pool).await?;
    let mut best = std::collections::HashMap::<String, (f64, String)>::new();
    for row in rows {
        let clip: String = row.get(0);
        if !eligible_ids.contains(&clip) {
            continue;
        }
        let vector: Vec<u8> = row.get(1);
        let score = cosine(&query_vector, &read_blob(&vector)?);
        let text: String = row.get(2);
        if best.get(&clip).map(|v| score > v.0).unwrap_or(true) {
            best.insert(clip, (score, text));
        }
    }
    let mut out: Vec<_> = best
        .into_iter()
        .map(|(id, (score, text))| (id, score, text))
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out.truncate(limit);
    Ok(out)
}

async fn provider_for_space(
    repo: &HistoryRepository,
    space: &str,
) -> Result<OllamaTextEmbeddingProvider> {
    let raw: String =
        sqlx::query_scalar("SELECT descriptor_json FROM search_embedding_spaces WHERE id=?")
            .bind(space)
            .fetch_one(&repo.pool)
            .await?;
    let descriptor: EmbeddingProviderDescriptor = serde_json::from_str(&raw)?;
    if descriptor.provider_kind != "builtin.embedding.ollama" {
        bail!("active embedding provider is unavailable")
    }
    OllamaTextEmbeddingProvider::new(&descriptor.endpoint, descriptor.model).await
}

fn chunk_text(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    split_text_windows(&normalized, MAX_CHUNK_BYTES, CHUNK_OVERLAP_BYTES)
}

fn split_text_windows(text: &str, max_bytes: usize, overlap_bytes: usize) -> Vec<String> {
    debug_assert!(max_bytes > 0);
    debug_assert!(overlap_bytes < max_bytes);
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let hard_end = floor_char_boundary(text, (start + max_bytes).min(text.len()));
        let mut end = hard_end;
        if hard_end < text.len() {
            let window = &text[start..hard_end];
            let minimum = window.len() / 2;
            end = window
                .rfind("\n\n")
                .map(|index| index + start + 2)
                .filter(|index| *index - start >= minimum)
                .or_else(|| {
                    window
                        .rfind('\n')
                        .map(|index| index + start + 1)
                        .filter(|index| *index - start >= minimum)
                })
                .or_else(|| {
                    window
                        .char_indices()
                        .rev()
                        .find(|(index, value)| *index >= minimum && value.is_whitespace())
                        .map(|(index, value)| index + start + value.len_utf8())
                })
                .unwrap_or(hard_end);
        }
        if end <= start {
            end = hard_end;
        }
        let chunk = text[start..end].trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }
        if end >= text.len() {
            break;
        }
        let proposed = end.saturating_sub(overlap_bytes).max(start + 1);
        let next = ceil_char_boundary(text, proposed);
        start = if next >= end { end } else { next };
    }
    chunks
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn is_context_length_error(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<OllamaRequestError>()
        .is_some_and(OllamaRequestError::is_context_length)
}

async fn embed_chunks_adaptively(
    provider: &OllamaTextEmbeddingProvider,
    chunks: Vec<String>,
) -> Result<Vec<(String, Vec<f32>)>> {
    match provider.embed_documents(&chunks).await {
        Ok(vectors) => return Ok(chunks.into_iter().zip(vectors).collect()),
        Err(error) if !is_context_length_error(&error) => return Err(error),
        Err(_) => {}
    }

    let mut queue: VecDeque<(String, u8)> = chunks.into_iter().map(|chunk| (chunk, 0)).collect();
    let mut embedded = Vec::new();
    while let Some((chunk, depth)) = queue.pop_front() {
        match provider.embed_documents(std::slice::from_ref(&chunk)).await {
            Ok(mut vectors) => {
                let vector = vectors.pop().context("missing chunk embedding")?;
                embedded.push((chunk, vector));
            }
            Err(error)
                if is_context_length_error(&error)
                    && depth < MAX_FALLBACK_DEPTH
                    && chunk.len() > MIN_FALLBACK_BYTES =>
            {
                let target = (chunk.len() / 2).max(MIN_FALLBACK_BYTES);
                let overlap = (target / 8).min(CHUNK_OVERLAP_BYTES);
                let split = split_text_windows(&chunk, target, overlap);
                if split.len() < 2 {
                    return Err(error);
                }
                for child in split.into_iter().rev() {
                    queue.push_front((child, depth + 1));
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(embedded)
}
fn validate_vector(v: &[f32], dimension: Option<usize>) -> Result<()> {
    if v.is_empty() || dimension.is_some_and(|d| d != v.len()) || v.iter().any(|n| !n.is_finite()) {
        bail!("invalid embedding vector")
    }
    let norm = v.iter().map(|n| n * n).sum::<f32>().sqrt();
    if !(0.98..=1.02).contains(&norm) {
        bail!("embedding vector is not L2 normalized")
    }
    Ok(())
}
fn parse_vectors(v: &serde_json::Value, count: usize) -> Result<Vec<Vec<f32>>> {
    let vectors = v["embeddings"]
        .as_array()
        .context("Ollama response has no embeddings")?;
    if vectors.len() != count {
        bail!("Ollama returned wrong vector count")
    }
    vectors
        .iter()
        .map(|vector| {
            vector
                .as_array()
                .context("invalid embedding")
                .and_then(|x| {
                    x.iter()
                        .map(|n| {
                            n.as_f64()
                                .map(|n| n as f32)
                                .context("invalid embedding value")
                        })
                        .collect()
                })
        })
        .collect()
}
fn vector_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}
fn read_blob(bytes: &[u8]) -> Result<Vec<f32>> {
    if !bytes.len().is_multiple_of(4) {
        bail!("invalid embedding blob")
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|x| f32::from_le_bytes(x.try_into().unwrap()))
        .collect())
}
fn cosine(a: &[f32], b: &[f32]) -> f64 {
    a.iter().zip(b).map(|(x, y)| *x as f64 * *y as f64).sum()
}
async fn get_config(pool: &SqlitePool) -> Result<Option<serde_json::Value>> {
    let Some(device) = get_device_config(pool).await? else {
        return Ok(None);
    };
    if !device["enabled"].as_bool().unwrap_or(false) {
        return Ok(None);
    }
    let state = get_space_state(pool)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    Ok(Some(serde_json::json!({
        "endpoint": device["endpoint"], "model": device["model"],
        "activeSpaceId": state["activeSpaceId"], "activeGeneration": state["activeGeneration"],
        "pendingSpaceId": state["pendingSpaceId"], "pendingGeneration": state["pendingGeneration"]
    })))
}
async fn get_device_config(pool: &SqlitePool) -> Result<Option<serde_json::Value>> {
    read_config(pool, "config_device_values", "search.ollama.text_embedding").await
}
async fn get_space_state(pool: &SqlitePool) -> Result<Option<serde_json::Value>> {
    read_config(pool, "config_profile_values", "search.embedding.state").await
}
async fn read_config(
    pool: &SqlitePool,
    table: &str,
    key: &str,
) -> Result<Option<serde_json::Value>> {
    let sql = format!("SELECT value_json FROM {table} WHERE key=?");
    let raw: Option<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(key)
        .fetch_optional(pool)
        .await?;
    match raw.as_deref() {
        Some("null") | None => Ok(None),
        Some(value) => Ok(Some(serde_json::from_str(value)?)),
    }
}
async fn put_device_config(pool: &SqlitePool, value: &serde_json::Value) -> Result<()> {
    put_config(
        pool,
        "config_device_values",
        "search.ollama.text_embedding",
        value,
    )
    .await
}
async fn put_space_state(pool: &SqlitePool, value: &serde_json::Value) -> Result<()> {
    put_config(
        pool,
        "config_profile_values",
        "search.embedding.state",
        value,
    )
    .await
}
async fn put_config(
    pool: &SqlitePool,
    table: &str,
    key: &str,
    value: &serde_json::Value,
) -> Result<()> {
    let now = now_ms();
    let sql = format!("INSERT INTO {table}(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at");
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(key)
        .bind(serde_json::to_string(value)?)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
    Ok(())
}
async fn validated_endpoint(raw: &str) -> Result<Url> {
    let mut url = Url::parse(raw)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
    {
        bail!("invalid Ollama endpoint")
    };
    let host = url.host_str().context("endpoint host required")?;
    let loopback = if host.eq_ignore_ascii_case("localhost") {
        true
    } else {
        host.parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
    };
    if !loopback {
        bail!("remote_consent_required")
    };
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()))
    };
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::AppRoots;

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

    #[test]
    fn chunks_are_hard_bounded_even_without_breaks() {
        let text = format!("<div>{}</div>", "a".repeat(MAX_CHUNK_BYTES * 4));
        let chunks = chunk_text(&text);
        assert!(chunks.len() > 4);
        assert!(chunks.iter().all(|chunk| chunk.len() <= MAX_CHUNK_BYTES));
        assert_eq!(chunks.first().map(|chunk| &chunk[..5]), Some("<div>"));
        assert!(chunks.last().is_some_and(|chunk| chunk.ends_with("</div>")));
    }

    #[test]
    fn chunks_unicode_without_splitting_code_points() {
        let text = format!("{}{}", "文".repeat(1_500), "🙂".repeat(1_500));
        let chunks = chunk_text(&text);
        assert!(chunks.len() > 2);
        assert!(chunks.iter().all(|chunk| chunk.len() <= MAX_CHUNK_BYTES));
        assert!(chunks
            .iter()
            .all(|chunk| std::str::from_utf8(chunk.as_bytes()).is_ok()));
    }

    #[test]
    fn chunks_prefer_paragraph_boundaries_and_normalize_lines() {
        let first = "a".repeat(1_700);
        let second = "b".repeat(700);
        let chunks = chunk_text(&format!("{first}\r\n\r\n{second}"));
        assert!(chunks.len() >= 2);
        assert!(chunks[0].ends_with('a'));
        assert!(!chunks.iter().any(|chunk| chunk.contains('\r')));
        assert!(chunks.iter().all(|chunk| chunk.len() <= MAX_CHUNK_BYTES));
    }

    #[test]
    fn rejects_non_unit_and_bad_dimension_vectors() {
        assert!(validate_vector(&[1.0, 0.0], Some(3)).is_err());
        assert!(validate_vector(&[2.0, 0.0], Some(2)).is_err());
        assert!(validate_vector(&[1.0, 0.0], Some(2)).is_ok());
    }

    #[tokio::test]
    async fn only_loopback_endpoints_are_accepted() {
        assert!(validated_endpoint("http://localhost:11434").await.is_ok());
        assert!(validated_endpoint("http://127.0.0.1:11434").await.is_ok());
        assert!(validated_endpoint("https://api.example.com").await.is_err());
        assert!(validated_endpoint("http://user@localhost:11434")
            .await
            .is_err());
    }

    #[test]
    fn describes_ollama_embedding_bad_requests() {
        let message = ollama_request_error(
            400,
            "api/embed",
            "nomic-embed-text:latest",
            r#"{"error":"input length exceeds the context length"}"#,
        );
        assert!(message.contains("/api/embed (HTTP 400)"));
        assert!(message.contains("input length exceeds the context length"));
        assert!(message.contains("nomic-embed-text:latest"));
    }

    #[tokio::test]
    async fn status_and_retry_are_scoped_to_the_pending_generation() {
        let (_temp, repo) = repository().await;
        sqlx::query("INSERT INTO search_embedding_spaces(id,provider_kind,descriptor_json,descriptor_sha256,modality,dimensions,normalization,distance_metric,created_at) VALUES('space','builtin.embedding.ollama','{}',?,'text',2,'l2','cosine',?)")
            .bind("a".repeat(64)).bind(now_ms()).execute(&repo.pool).await.unwrap();
        put_device_config(
            &repo.pool,
            &serde_json::json!({"enabled":true,"endpoint":"http://localhost:11434","model":"test"}),
        )
        .await
        .unwrap();
        put_space_state(
            &repo.pool,
            &serde_json::json!({
                "activeSpaceId":"space","activeGeneration":1,
                "pendingSpaceId":"space","pendingGeneration":2
            }),
        )
        .await
        .unwrap();
        for generation in [1_i64, 2] {
            sqlx::query("INSERT INTO search_index_jobs(id,space_id,status,attempt_count,last_error,requested_at,generation,chunker_version) VALUES(?,?,'failed',3,'context error',?,?,?)")
                .bind(format!("job-{generation}")).bind("space").bind(now_ms()).bind(generation).bind(CHUNKER_VERSION).execute(&repo.pool).await.unwrap();
        }

        let before = status(&repo).await.unwrap();
        assert_eq!(before.failed_jobs, 1);
        retry_failed(&repo).await.unwrap();
        let old_status: String =
            sqlx::query_scalar("SELECT status FROM search_index_jobs WHERE id='job-1'")
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let current_status: String =
            sqlx::query_scalar("SELECT status FROM search_index_jobs WHERE id='job-2'")
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(old_status, "failed");
        assert_eq!(current_status, "pending");
    }

    #[tokio::test]
    async fn historical_failure_does_not_block_pending_generation_promotion() {
        let (_temp, repo) = repository().await;
        sqlx::query("INSERT INTO search_embedding_spaces(id,provider_kind,descriptor_json,descriptor_sha256,modality,dimensions,normalization,distance_metric,created_at) VALUES('space','builtin.embedding.ollama','{}',?,'text',2,'l2','cosine',?)")
            .bind("b".repeat(64)).bind(now_ms()).execute(&repo.pool).await.unwrap();
        put_device_config(
            &repo.pool,
            &serde_json::json!({"enabled":true,"endpoint":"http://localhost:11434","model":"test"}),
        )
        .await
        .unwrap();
        put_space_state(
            &repo.pool,
            &serde_json::json!({
                "activeSpaceId":"space","activeGeneration":1,
                "pendingSpaceId":"space","pendingGeneration":2
            }),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO search_index_jobs(id,space_id,status,attempt_count,last_error,requested_at,generation,chunker_version) VALUES('old-failure','space','failed',3,'old error',?,1,'1')")
            .bind(now_ms()).execute(&repo.pool).await.unwrap();

        assert_eq!(index_pending(&repo).await.unwrap(), 0);
        let state = get_space_state(&repo.pool).await.unwrap().unwrap();
        assert_eq!(state["activeGeneration"].as_i64(), Some(2));
        assert!(state["pendingGeneration"].is_null());
        let old_jobs: i64 =
            sqlx::query_scalar("SELECT count(*) FROM search_index_jobs WHERE generation=1")
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(old_jobs, 0);
    }
}
