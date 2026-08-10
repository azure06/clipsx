//! Provider-neutral, derived text embeddings. Providers are host-owned; this
//! contract is intentionally the same boundary a future hosted provider uses.
use crate::history::{new_id, now_ms, sha256, HistoryRepository};
use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::{net::IpAddr, time::Duration};
use url::Url;

const CHUNKER_ID: &str = "builtin.chunker.format-aware";
const CHUNKER_VERSION: &str = "1";
const MAX_CHARS: usize = 2_048; // approximately 512 tokens
const OVERLAP_CHARS: usize = 307; // 15 percent

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
    pub active_space_id: Option<String>,
    pub pending_space_id: Option<String>,
    pub diagnostic: Option<String>,
    pub indexed_clips: u64,
    pub pending_jobs: u64,
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
            bail!("Ollama returned {}", response.status())
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
            bail!("Ollama returned {}", response.status())
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
        let value = self
            .request(
                "api/embed",
                serde_json::json!({"model": self.model, "input": input, "truncate": false}),
                Duration::from_secs(60),
            )
            .await?;
        parse_vectors(&value, input.len())
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
    let previous = get_config(&repo.pool).await?;
    let active = previous
        .as_ref()
        .and_then(|value| value["activeSpaceId"].as_str());
    let config = serde_json::json!({"endpoint": endpoint, "model": model, "pendingSpaceId": space_id, "activeSpaceId": active});
    put_config(&repo.pool, "search.embedding.provider", &config).await?;
    enqueue_all(repo, &space_id, 1).await?;
    status(repo).await
}
pub async fn disable(repo: &HistoryRepository) -> Result<()> {
    put_config(
        &repo.pool,
        "search.embedding.provider",
        &serde_json::Value::Null,
    )
    .await
}
pub async fn status(repo: &HistoryRepository) -> Result<ProviderStatus> {
    let config = get_config(&repo.pool).await?;
    let Some(value) = config else {
        return Ok(ProviderStatus {
            enabled: false,
            active_space_id: None,
            pending_space_id: None,
            diagnostic: None,
            indexed_clips: 0,
            pending_jobs: 0,
        });
    };
    let pending = value["pendingSpaceId"].as_str().map(str::to_string);
    let active = value["activeSpaceId"].as_str().map(str::to_string);
    let indexed: i64 =
        sqlx::query_scalar("SELECT count(DISTINCT clip_id) FROM search_chunks WHERE space_id=?")
            .bind(active.as_ref().or(pending.as_ref()))
            .fetch_one(&repo.pool)
            .await?;
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM search_index_jobs WHERE space_id=? AND status IN ('pending','running')").bind(pending.as_ref().or(active.as_ref())).fetch_one(&repo.pool).await?;
    Ok(ProviderStatus {
        enabled: true,
        active_space_id: active,
        pending_space_id: pending,
        diagnostic: None,
        indexed_clips: indexed as u64,
        pending_jobs: jobs as u64,
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
    let provider = OllamaTextEmbeddingProvider::new(
        config["endpoint"].as_str().context("missing endpoint")?,
        config["model"].as_str().context("missing model")?.into(),
    )
    .await?;
    let rows = sqlx::query("SELECT id,clip_id,generation FROM search_index_jobs WHERE space_id=? AND status='pending' ORDER BY requested_at LIMIT 16").bind(&space).fetch_all(&repo.pool).await?;
    let mut count = 0;
    for row in rows {
        let id: String = row.get(0);
        let clip: String = row.get(1);
        let generation: i64 = row.get(2);
        sqlx::query("UPDATE search_index_jobs SET status='running',started_at=?,attempt_count=attempt_count+1 WHERE id=?").bind(now_ms()).bind(&id).execute(&repo.pool).await?;
        match index_clip(repo, &provider, &space, &clip, generation).await {
            Ok(()) => {
                sqlx::query(
                    "UPDATE search_index_jobs SET status='completed',completed_at=? WHERE id=?",
                )
                .bind(now_ms())
                .bind(&id)
                .execute(&repo.pool)
                .await?;
                count += 1;
            }
            Err(error) => {
                sqlx::query("UPDATE search_index_jobs SET status=CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,last_error=?,completed_at=? WHERE id=?").bind(error.to_string()).bind(now_ms()).bind(&id).execute(&repo.pool).await?;
            }
        }
    }
    let pending:i64=sqlx::query_scalar("SELECT count(*) FROM search_index_jobs WHERE space_id=? AND status IN ('pending','running')").bind(&space).fetch_one(&repo.pool).await?;
    if pending == 0 {
        let mut promoted = config;
        promoted["activeSpaceId"] = serde_json::Value::String(space);
        promoted["pendingSpaceId"] = serde_json::Value::Null;
        put_config(&repo.pool, "search.embedding.provider", &promoted).await?;
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
        return Ok(());
    }
    let vectors = provider.embed_documents(&chunks).await?;
    if vectors.len() != chunks.len() {
        bail!("provider returned wrong number of embeddings")
    }
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
    for (ordinal, (text, vector)) in chunks.into_iter().zip(vectors).enumerate() {
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
pub async fn reindex(repo: &HistoryRepository) -> Result<()> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings are disabled")?;
    let space = config["activeSpaceId"]
        .as_str()
        .or(config["pendingSpaceId"].as_str())
        .context("no space")?;
    enqueue_all(repo, space, 2).await
}
pub async fn enqueue_clip(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    let config = match get_config(&repo.pool).await? {
        Some(value) => value,
        None => return Ok(()),
    };
    let Some(space) = config["pendingSpaceId"]
        .as_str()
        .or(config["activeSpaceId"].as_str())
    else {
        return Ok(());
    };
    sqlx::query("INSERT OR IGNORE INTO search_index_jobs(id,space_id,clip_id,status,requested_at,generation,chunker_version) VALUES(?,?,?,'pending',?,?,?)")
        .bind(new_id()).bind(space).bind(clip_id).bind(now_ms()).bind(1_i64).bind(CHUNKER_VERSION).execute(&repo.pool).await?;
    Ok(())
}
pub async fn clear_space(repo: &HistoryRepository, space: &str) -> Result<()> {
    sqlx::query("DELETE FROM search_embedding_spaces WHERE id=?")
        .bind(space)
        .execute(&repo.pool)
        .await?;
    Ok(())
}

pub async fn hybrid_matches(
    repo: &HistoryRepository,
    query: &str,
    limit: usize,
) -> Result<Vec<(String, f64, String)>> {
    let config = get_config(&repo.pool)
        .await?
        .context("embeddings disabled")?;
    let space = config["activeSpaceId"]
        .as_str()
        .context("semantic index is still building")?;
    let provider = provider_for_space(repo, space).await?;
    let query_vector = provider.embed_query(query).await?;
    let rows=sqlx::query("SELECT sc.clip_id,se.vector,sc.text_value FROM search_embeddings se JOIN search_chunks sc ON sc.id=se.chunk_id WHERE se.space_id=? ORDER BY sc.clip_id").bind(space).fetch_all(&repo.pool).await?;
    let mut best = std::collections::HashMap::<String, (f64, String)>::new();
    for row in rows {
        let clip: String = row.get(0);
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
    let mut out = Vec::new();
    let mut current = String::new();
    for paragraph in text.split("\n\n") {
        let p = paragraph.trim();
        if p.is_empty() {
            continue;
        }
        if current.len() + p.len() + 1 > MAX_CHARS && !current.is_empty() {
            out.push(current.clone());
            let start = current.len().saturating_sub(OVERLAP_CHARS);
            current = current[start..].to_string();
        }
        if !current.is_empty() {
            current.push('\n')
        }
        current.push_str(p);
    }
    if !current.is_empty() {
        out.push(current)
    }
    out
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
    let raw: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='search.embedding.provider'",
    )
    .fetch_optional(pool)
    .await?;
    match raw.as_deref() {
        Some("null") | None => Ok(None),
        Some(v) => Ok(Some(serde_json::from_str(v)?)),
    }
}
async fn put_config(pool: &SqlitePool, key: &str, value: &serde_json::Value) -> Result<()> {
    sqlx::query("INSERT INTO config_profile_values(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(key).bind(serde_json::to_string(value)?).bind(now_ms()).execute(pool).await?;
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

    #[test]
    fn chunks_preserve_order_and_overlap() {
        let text = format!("{}\n\n{}", "a".repeat(MAX_CHARS), "b".repeat(32));
        let chunks = chunk_text(&text);
        assert_eq!(chunks.len(), 2);
        assert!(chunks[1].starts_with(&"a".repeat(OVERLAP_CHARS)));
        assert!(chunks[1].ends_with(&"b".repeat(32)));
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
}
