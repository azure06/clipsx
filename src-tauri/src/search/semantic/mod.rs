//! Semantic chunking, indexing, and hybrid vector ranking.
mod chunking;

use crate::history::{new_id, now_ms, sha256, HistoryRepository};
use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::{collections::VecDeque, fmt, net::IpAddr, time::Duration};
use url::Url;

use chunking::{
    deduplicate_inputs, SemanticChunk, SemanticFacet, SemanticInput, MAX_EMBED_BYTES,
    PIPELINE_VERSION,
};

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
            if let Some(oversized) = batch.iter().find(|value| value.len() > MAX_EMBED_BYTES) {
                bail!(
                    "internal embedding chunk exceeds the {}-byte limit ({} bytes)",
                    MAX_EMBED_BYTES,
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
            Ok(projection) => {
                sqlx::query(
                    "UPDATE search_index_jobs SET status='completed',projection_sha256=?,completed_at=?,updated_at=? WHERE id=?",
                )
                .bind(projection)
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

async fn index_clip<P: TextEmbeddingProvider>(
    repo: &HistoryRepository,
    provider: &P,
    space: &str,
    clip: &str,
    generation: i64,
) -> Result<String> {
    let inputs = load_semantic_inputs(repo, clip).await?;
    let mut chunks = Vec::<(SemanticInput, SemanticChunk)>::new();
    for input in deduplicate_inputs(inputs) {
        for chunk in chunking::chunk_input(&input)? {
            chunks.push((input.clone(), chunk));
        }
    }
    let projection = semantic_projection_hash(&chunks)?;
    if chunks.is_empty() {
        sqlx::query("DELETE FROM search_chunks WHERE space_id=? AND clip_id=? AND generation=?")
            .bind(space)
            .bind(clip)
            .bind(generation)
            .execute(&repo.pool)
            .await?;
        return Ok(projection);
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
    for (ordinal, (input, chunk, vector)) in embedded.into_iter().enumerate() {
        validate_vector(&vector, Some(dimensions as usize))?;
        let chunk_id = new_id();
        let manifest = chunk_manifest(&input, &chunk)?;
        let chunk_projection = sha256(
            format!(
                "{}:{}:{}:{}",
                PIPELINE_VERSION, chunk.strategy_id, manifest, chunk.embedding_text
            )
            .as_bytes(),
        );
        sqlx::query("INSERT INTO search_chunks(id,clip_id,space_id,ordinal,chunk_kind,text_value,text_sha256,source_manifest_json,projection_sha256,chunker_id,chunker_version,generation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&chunk_id).bind(clip).bind(space).bind(ordinal as i64).bind(&chunk.kind).bind(&chunk.display_text).bind(sha256(chunk.display_text.as_bytes())).bind(&manifest).bind(&chunk_projection).bind(&chunk.strategy_id).bind(&chunk.strategy_version).bind(generation).bind(now_ms()).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO search_embeddings(id,space_id,clip_id,representation_id,artifact_id,vector,created_at,chunk_id) VALUES(?,?,?,?,?,?,?,?)").bind(new_id()).bind(space).bind(clip).bind(&input.representation_id).bind(&input.artifact_id).bind(vector_blob(&vector)).bind(now_ms()).bind(&chunk_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
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
    if let Some(note) = note.filter(|note| !note.trim().is_empty()) {
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
        "SELECT t.name FROM catalog_tags t JOIN catalog_clip_tags ct ON ct.tag_id=t.id WHERE ct.clip_id=? ORDER BY t.name",
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
        "SELECT r.id,r.canonical_mime_type,r.format_family,r.capture_priority,r.ordinal,t.text_value \
         FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id \
         WHERE r.clip_id=? AND r.lifecycle_state='ready' ORDER BY r.capture_priority,r.ordinal,r.id",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    for row in rows {
        let representation_id: String = row.get(0);
        let facet_rows = sqlx::query(
            "SELECT facet_id,payload_json FROM content_clip_facets WHERE source_representation_id=? ORDER BY facet_id,detector_id,detector_version",
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
        let capture_priority: i64 = row.get(3);
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
            source_ordinal: capture_priority
                .saturating_mul(1_000)
                .saturating_add(ordinal),
        });
    }

    let ocr_rows = sqlx::query(
        "SELECT ar.id,ai.representation_id,atv.text_value \
         FROM artifact_records ar JOIN artifact_inputs ai ON ai.artifact_id=ar.id \
         JOIN artifact_text_values atv ON atv.artifact_id=ar.id \
         JOIN clip_representations r ON r.id=ai.representation_id \
         WHERE r.clip_id=? AND ar.producer_id='builtin.artifact.ocr' AND ar.lifecycle_state='ready' \
         ORDER BY ar.created_at,ar.id",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    for (ordinal, row) in ocr_rows.into_iter().enumerate() {
        let artifact_id: String = row.get(0);
        inputs.push(SemanticInput {
            source_kind: "ocr".into(),
            source_id: artifact_id.clone(),
            representation_id: row.get(1),
            artifact_id: Some(artifact_id),
            mime_type: Some("text/plain".into()),
            format_family: Some("artifact".into()),
            facets: Vec::new(),
            text: row.get(2),
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
async fn enqueue_all(repo: &HistoryRepository, space: &str, generation: i64) -> Result<()> {
    let clips: Vec<String> =
        sqlx::query_scalar("SELECT id FROM clip_items WHERE lifecycle_state='ready'")
            .fetch_all(&repo.pool)
            .await?;
    for clip in clips {
        sqlx::query("INSERT OR IGNORE INTO search_index_jobs(id,space_id,clip_id,status,requested_at,generation,chunker_version) VALUES(?,?,?,'pending',?,?,?)").bind(new_id()).bind(space).bind(clip).bind(now_ms()).bind(generation).bind(PIPELINE_VERSION).execute(&repo.pool).await?;
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
            .bind(new_id()).bind(space).bind(clip).bind(now_ms()).bind(generation).bind(PIPELINE_VERSION)
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
        .bind(new_id()).bind(space).bind(clip_id).bind(now_ms()).bind(generation).bind(PIPELINE_VERSION).execute(&repo.pool).await?;
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
        .bind(PIPELINE_VERSION)
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
        "SELECT \
           (SELECT count(*) FROM search_index_jobs WHERE space_id=? AND generation=? AND chunker_version<>?) + \
           (SELECT count(*) FROM search_chunks WHERE space_id=? AND generation=? AND COALESCE(json_extract(source_manifest_json,'$.pipelineVersion'),'')<>?)",
    )
    .bind(space)
    .bind(generation)
    .bind(PIPELINE_VERSION)
    .bind(space)
    .bind(generation)
    .bind(PIPELINE_VERSION)
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

#[cfg(test)]
fn chunk_text(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    chunking::split_text_windows(
        &normalized,
        MAX_EMBED_BYTES,
        chunking::FALLBACK_OVERLAP_BYTES,
    )
}

fn is_context_length_error(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<OllamaRequestError>()
        .is_some_and(OllamaRequestError::is_context_length)
}

async fn embed_chunks_adaptively<P: TextEmbeddingProvider>(
    provider: &P,
    chunks: Vec<(SemanticInput, SemanticChunk)>,
) -> Result<Vec<(SemanticInput, SemanticChunk, Vec<f32>)>> {
    let texts = chunks
        .iter()
        .map(|(_, chunk)| chunk.embedding_text.clone())
        .collect::<Vec<_>>();
    match provider.embed_documents(&texts).await {
        Ok(vectors) => {
            return Ok(chunks
                .into_iter()
                .zip(vectors)
                .map(|((input, chunk), vector)| (input, chunk, vector))
                .collect())
        }
        Err(error) if !is_context_length_error(&error) => return Err(error),
        Err(_) => {}
    }

    let mut queue: VecDeque<(SemanticInput, SemanticChunk, u8)> = chunks
        .into_iter()
        .map(|(input, chunk)| (input, chunk, 0))
        .collect();
    let mut embedded = Vec::new();
    while let Some((input, chunk, depth)) = queue.pop_front() {
        match provider
            .embed_documents(std::slice::from_ref(&chunk.embedding_text))
            .await
        {
            Ok(mut vectors) => {
                let vector = vectors.pop().context("missing chunk embedding")?;
                embedded.push((input, chunk, vector));
            }
            Err(error)
                if is_context_length_error(&error)
                    && depth < MAX_FALLBACK_DEPTH
                    && chunk.display_text.len() > MIN_FALLBACK_BYTES =>
            {
                let target = (chunk.display_text.len() / 2).max(MIN_FALLBACK_BYTES);
                let split = chunking::subdivide_chunk(&chunk, target);
                if split.len() < 2 {
                    return Err(error);
                }
                for child in split.into_iter().rev() {
                    queue.push_front((input.clone(), child, depth + 1));
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
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingProvider {
        inputs: Mutex<Vec<Vec<String>>>,
    }

    #[async_trait]
    impl TextEmbeddingProvider for RecordingProvider {
        fn id(&self) -> &'static str {
            "test.embedding"
        }
        fn version(&self) -> &'static str {
            "1"
        }
        async fn describe(&self, _: &str) -> Result<EmbeddingProviderDescriptor> {
            Ok(EmbeddingProviderDescriptor {
                provider_kind: self.id().into(),
                provider_version: self.version().into(),
                endpoint: "http://localhost".into(),
                model: "test".into(),
                model_digest: "test".into(),
                dimensions: 2,
                normalization: "l2".into(),
                modality: "text".into(),
                distance_metric: "cosine".into(),
            })
        }
        async fn discover_models(&self) -> Result<Vec<OllamaModelDescriptor>> {
            Ok(Vec::new())
        }
        async fn embed_documents(&self, input: &[String]) -> Result<Vec<Vec<f32>>> {
            self.inputs.lock().unwrap().push(input.to_vec());
            Ok(input.iter().map(|_| vec![1.0, 0.0]).collect())
        }
        async fn embed_query(&self, _: &str) -> Result<Vec<f32>> {
            Ok(vec![1.0, 0.0])
        }
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

    async fn insert_text_clip(repo: &HistoryRepository) {
        let now = now_ms();
        sqlx::query("INSERT INTO clip_items(id,captured_at,updated_at,lifecycle_state) VALUES('clip',?,?,'ready')")
            .bind(now)
            .bind(now)
            .execute(&repo.pool)
            .await
            .unwrap();
        for (id, format, mime, family, priority, ordinal, text) in [
            (
                "html",
                "test:html",
                "text/html",
                "rich_text",
                30_i64,
                0_i64,
                "<h1>Guide</h1><p>First paragraph.</p><p>Second paragraph.</p>",
            ),
            (
                "plain",
                "test:plain",
                "text/plain",
                "text",
                100_i64,
                1_i64,
                "Guide First paragraph. Second paragraph.",
            ),
        ] {
            sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,capability_id,format_family,platform,storage_kind,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,'clip',?,?,'test.capability',?,'windows','text',?,?,'ready',?,?)")
                .bind(id).bind(format).bind(mime).bind(family).bind(ordinal).bind(priority).bind(now).bind(now)
                .execute(&repo.pool).await.unwrap();
            sqlx::query("INSERT INTO clip_text_values(representation_id,text_value,utf8_byte_length,sha256) VALUES(?,?,?,?)")
                .bind(id).bind(text).bind(text.len() as i64).bind(sha256(text.as_bytes()))
                .execute(&repo.pool).await.unwrap();
        }
    }

    #[test]
    fn chunks_are_hard_bounded_even_without_breaks() {
        let text = format!("<div>{}</div>", "a".repeat(MAX_EMBED_BYTES * 4));
        let chunks = chunk_text(&text);
        assert!(chunks.len() > 4);
        assert!(chunks.iter().all(|chunk| chunk.len() <= MAX_EMBED_BYTES));
        assert_eq!(chunks.first().map(|chunk| &chunk[..5]), Some("<div>"));
        assert!(chunks.last().is_some_and(|chunk| chunk.ends_with("</div>")));
    }

    #[test]
    fn chunks_unicode_without_splitting_code_points() {
        let text = format!("{}{}", "文".repeat(1_500), "🙂".repeat(1_500));
        let chunks = chunk_text(&text);
        assert!(chunks.len() > 2);
        assert!(chunks.iter().all(|chunk| chunk.len() <= MAX_EMBED_BYTES));
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
        assert!(chunks.iter().all(|chunk| chunk.len() <= MAX_EMBED_BYTES));
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
    async fn index_clip_embeds_context_but_persists_clean_text_and_source_provenance() {
        let (_temp, repo) = repository().await;
        insert_text_clip(&repo).await;
        sqlx::query("INSERT INTO search_embedding_spaces(id,provider_kind,descriptor_json,descriptor_sha256,modality,dimensions,normalization,distance_metric,created_at) VALUES('space','test.embedding','{}',?,'text',2,'l2','cosine',?)")
            .bind("c".repeat(64)).bind(now_ms()).execute(&repo.pool).await.unwrap();
        let provider = RecordingProvider::default();

        let projection = index_clip(&repo, &provider, "space", "clip", 3)
            .await
            .unwrap();

        assert_eq!(projection.len(), 64);
        let requests = provider.inputs.lock().unwrap().clone();
        assert!(requests
            .iter()
            .flatten()
            .all(|input| input.len() <= MAX_EMBED_BYTES));
        assert!(requests
            .iter()
            .flatten()
            .any(|input| input.contains("Section: Guide")));
        let rows = sqlx::query("SELECT sc.text_value,sc.source_manifest_json,sc.chunker_id,se.representation_id,length(se.vector) FROM search_chunks sc JOIN search_embeddings se ON se.chunk_id=sc.id WHERE sc.clip_id='clip' AND sc.generation=3")
            .fetch_all(&repo.pool).await.unwrap();
        assert!(!rows.is_empty());
        for row in rows {
            let text: String = row.get(0);
            let manifest: String = row.get(1);
            let strategy: String = row.get(2);
            let representation: Option<String> = row.get(3);
            let vector_bytes: i64 = row.get(4);
            assert!(!text.contains("Section:"));
            assert!(manifest.contains("\"pipelineVersion\":\"3\""));
            assert_eq!(strategy, "builtin.chunker.html-dom");
            assert_eq!(representation.as_deref(), Some("html"));
            assert_eq!(vector_bytes, 8);
        }
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
                .bind(format!("job-{generation}")).bind("space").bind(now_ms()).bind(generation).bind(PIPELINE_VERSION).execute(&repo.pool).await.unwrap();
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
    async fn old_pipeline_jobs_trigger_a_generation_three_rebuild() {
        let (_temp, repo) = repository().await;
        insert_text_clip(&repo).await;
        sqlx::query("INSERT INTO search_embedding_spaces(id,provider_kind,descriptor_json,descriptor_sha256,modality,dimensions,normalization,distance_metric,created_at) VALUES('space','builtin.embedding.ollama','{}',?,'text',2,'l2','cosine',?)")
            .bind("d".repeat(64)).bind(now_ms()).execute(&repo.pool).await.unwrap();
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
                "pendingSpaceId":null,"pendingGeneration":null
            }),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO search_index_jobs(id,space_id,clip_id,status,requested_at,generation,chunker_version) VALUES('old','space','clip','completed',?,1,'2')")
            .bind(now_ms()).execute(&repo.pool).await.unwrap();

        assert!(ensure_current_chunker(&repo).await.unwrap());
        let state = get_space_state(&repo.pool).await.unwrap().unwrap();
        assert_eq!(state["pendingSpaceId"].as_str(), Some("space"));
        assert_eq!(state["pendingGeneration"].as_i64(), Some(2));
        let version: String = sqlx::query_scalar("SELECT chunker_version FROM search_index_jobs WHERE space_id='space' AND generation=2 AND clip_id='clip'")
            .fetch_one(&repo.pool).await.unwrap();
        assert_eq!(version, PIPELINE_VERSION);
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
