//! Search projection, FTS queries, and hybrid ranking.
pub mod semantic;
use crate::history::{now_ms, ClipSummary, HistoryRepository};
use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};

const PROJECTION_VERSION: i64 = 3;
pub const FTS_SOURCE_ID: &str = "builtin.search.fts";
pub const SEMANTIC_TEXT_SOURCE_ID: &str = "builtin.search.semantic_text";
const RRF_K: f64 = 60.0;
const SOURCE_CANDIDATE_LIMIT: usize = 5_000;
const PROJECTION_REBUILD_BATCH_SIZE: i64 = 100;

// ─── Domain ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub clip: ClipSummary,
    pub snippet: Option<String>,
    pub rank: f64,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub source_id: String,
    pub source_rank: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSourceOutcome {
    pub source_id: String,
    pub status: SearchSourceOutcomeStatus,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchSourceOutcomeStatus {
    Used,
    Unavailable,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSourceDescriptor {
    pub id: String,
    pub label: String,
    pub mandatory: bool,
    pub input_kinds: Vec<String>,
    pub indexing_required: bool,
    pub enabled: bool,
    pub state: SearchSourceState,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchSourceState {
    Ready,
    Indexing,
    Degraded,
    Disabled,
    NotConfigured,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<SearchResult>,
    pub total: u32,
    pub next_cursor: Option<String>,
    pub source_outcomes: Vec<SearchSourceOutcome>,
    pub is_exhaustive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub scope: Option<String>,
    pub tag_id: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    #[serde(default)]
    pub enabled_source_ids: Vec<String>,
    #[serde(default)]
    pub representation_families: Vec<String>,
    #[serde(default)]
    pub facet_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettings {
    pub syntax_mode: SyntaxMode,
    #[serde(default = "default_enabled_sources")]
    pub enabled_source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyntaxMode {
    Simple,
    Advanced,
}

fn default_enabled_sources() -> Vec<String> {
    vec![FTS_SOURCE_ID.into()]
}

// ─── Projection ───────────────────────────────────────────────────────────────

/// Build or refresh `search_documents` for every ready clip that is missing or
/// stale (wrong `projection_version`).
pub async fn rebuild_stale_projections(repo: &HistoryRepository) -> Result<u64> {
    let mut rebuilt = 0;
    let mut after_id: Option<String> = None;
    loop {
        let mut sql = String::from(
            "SELECT c.id FROM clip_items c \
             WHERE c.lifecycle_state = 'ready' \
               AND NOT EXISTS ( \
                   SELECT 1 FROM search_documents sd \
                   WHERE sd.clip_id = c.id \
                     AND sd.projection_version = ? \
               )",
        );
        if after_id.is_some() {
            sql.push_str(" AND c.id > ?");
        }
        sql.push_str(" ORDER BY c.id LIMIT ?");
        let mut query = sqlx::query_scalar(sqlx::AssertSqlSafe(sql)).bind(PROJECTION_VERSION);
        if let Some(id) = &after_id {
            query = query.bind(id);
        }
        let stale_ids: Vec<String> = query
            .bind(PROJECTION_REBUILD_BATCH_SIZE)
            .fetch_all(&repo.pool)
            .await?;
        let Some(last_id) = stale_ids.last().cloned() else {
            break;
        };
        for id in stale_ids {
            match upsert_projection(repo, &id).await {
                Ok(()) => rebuilt += 1,
                Err(error) => {
                    eprintln!("[SEARCH] Failed to rebuild FTS projection for {id}: {error}")
                }
            }
        }
        after_id = Some(last_id);
        tokio::task::yield_now().await;
    }
    Ok(rebuilt)
}

/// Rebuild the search document for a single clip.
pub async fn upsert_projection(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    let text = build_search_text(repo, clip_id).await?;
    let manifest = build_manifest(repo, clip_id).await?;
    let now = now_ms();
    sqlx::query(
        "INSERT INTO search_documents(clip_id,search_text,projection_version,source_manifest_json,created_at,updated_at) \
         VALUES(?,?,?,?,?,?) \
         ON CONFLICT(clip_id) DO UPDATE SET \
           search_text = excluded.search_text, \
           projection_version = excluded.projection_version, \
           source_manifest_json = excluded.source_manifest_json, \
           updated_at = excluded.updated_at",
    )
    .bind(clip_id)
    .bind(&text)
    .bind(PROJECTION_VERSION)
    .bind(&manifest)
    .bind(now)
    .bind(now)
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn build_search_text(repo: &HistoryRepository, clip_id: &str) -> Result<String> {
    let mut parts: Vec<String> = Vec::new();

    // 1. Note
    if let Some(note) =
        sqlx::query_scalar::<_, Option<String>>("SELECT note FROM clip_items WHERE id=?")
            .bind(clip_id)
            .fetch_optional(&repo.pool)
            .await?
            .flatten()
    {
        parts.push(note);
    }

    // 2. User-assigned tags. Tags are searchable intent, not canonical payload.
    let tags: Vec<String> = sqlx::query_scalar(
        "SELECT t.name FROM catalog_tags t \
         JOIN catalog_clip_tags ct ON ct.tag_id=t.id WHERE ct.clip_id=? ORDER BY t.name",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    parts.extend(tags);

    // 3. Every ready text representation contributes only safe visible text.
    // Equivalent normalized text is indexed once per clip, even when a native
    // clipboard offered plain text, HTML, and RTF siblings for the same content.
    let texts = sqlx::query(
        "SELECT r.canonical_mime_type,t.text_value FROM clip_representations r \
         JOIN clip_text_values t ON t.representation_id = r.id \
         WHERE r.clip_id = ? AND r.lifecycle_state = 'ready' AND r.storage_kind = 'text' \
         ORDER BY r.capture_priority, r.ordinal",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    let mut seen_visible_text = HashSet::new();
    for row in texts {
        let mime_type: Option<String> = row.get(0);
        let value: String = row.get(1);
        if let Some(visible) = fts_visible_text(mime_type.as_deref(), &value) {
            if seen_visible_text.insert(visible.clone()) {
                parts.push(visible);
            }
        }
    }

    // 4. Every completed OCR artifact, unless it duplicates captured visible text.
    let ocr_texts: Vec<String> = sqlx::query_scalar(
        "SELECT atv.text_value FROM artifact_records ar \
         JOIN artifact_text_values atv ON atv.artifact_id=ar.id \
         WHERE ar.owner_clip_id=? AND ar.producer_id='builtin.artifact.ocr' \
           AND ar.lifecycle_state='ready' ORDER BY ar.created_at,ar.id",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    for ocr in ocr_texts {
        let visible = crate::text::collapse_whitespace(&ocr);
        if !visible.is_empty() && seen_visible_text.insert(visible.clone()) {
            parts.push(visible);
        }
    }

    Ok(parts.join("\n"))
}

/// Text safe to expose to keyword search. Raw HTML and RTF remain canonical
/// representations for reconstruction, but never become searchable source text.
/// Other captured text formats are already textual payloads and are normalized
/// conservatively without trying to interpret arbitrary native formats.
fn fts_visible_text(mime_type: Option<&str>, value: &str) -> Option<String> {
    let visible = match mime_type {
        Some("text/html") => crate::text::html_visible_text(value),
        Some("text/rtf" | "application/rtf") => crate::text::rtf_visible_text(value)?,
        _ => value.to_string(),
    };
    let normalized = crate::text::collapse_whitespace(&visible);
    (!normalized.is_empty()).then_some(normalized)
}

async fn build_manifest(repo: &HistoryRepository, clip_id: &str) -> Result<String> {
    let source_rows = sqlx::query(
        "SELECT r.id, COALESCE(t.sha256, b.sha256, ''), r.storage_kind \
         FROM clip_representations r \
         LEFT JOIN clip_text_values t ON t.representation_id=r.id \
         LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id \
         WHERE r.clip_id=? AND r.lifecycle_state='ready' \
         ORDER BY r.capture_priority, r.ordinal",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    let mut sources: Vec<serde_json::Value> = source_rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<String, _>(0),
                "sha256": row.get::<String, _>(1),
                "storageKind": row.get::<String, _>(2),
            })
        })
        .collect();
    sources.push(serde_json::json!({ "producer": "builtin.fts", "version": PROJECTION_VERSION }));
    Ok(serde_json::to_string(&sources)?)
}

// ─── Query ────────────────────────────────────────────────────────────────────

// ─── Settings ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct RankedCandidate {
    clip_id: String,
    snippet: Option<String>,
    source_score: Option<f64>,
    updated_at: i64,
}

struct SourceCandidates {
    items: Vec<RankedCandidate>,
    truncated: bool,
}

struct SourceContext<'a> {
    repo: &'a HistoryRepository,
    request: &'a SearchRequest,
    query: &'a str,
    fts_query: Option<&'a str>,
    semantic_eligible: Option<&'a HashMap<String, i64>>,
}

#[async_trait]
trait SearchSource: Send + Sync {
    fn descriptor(&self) -> StaticSearchSourceDescriptor;
    fn id(&self) -> &'static str {
        self.descriptor().id
    }
    fn mandatory(&self) -> bool {
        self.descriptor().mandatory
    }
    async fn candidates(&self, context: &SourceContext<'_>) -> Result<SourceCandidates>;
}

#[derive(Clone, Copy)]
struct StaticSearchSourceDescriptor {
    id: &'static str,
    label: &'static str,
    mandatory: bool,
    input_kinds: &'static [&'static str],
    indexing_required: bool,
}

struct FtsSearchSource;

#[async_trait]
impl SearchSource for FtsSearchSource {
    fn descriptor(&self) -> StaticSearchSourceDescriptor {
        StaticSearchSourceDescriptor {
            id: FTS_SOURCE_ID,
            label: "Keyword Search",
            mandatory: true,
            input_kinds: &["text"],
            indexing_required: true,
        }
    }
    async fn candidates(&self, context: &SourceContext<'_>) -> Result<SourceCandidates> {
        let (filters, bindings) = eligibility_filter(context.request)?;
        let Some(query) = context.fts_query else {
            let sql = format!(
                "SELECT c.id,c.updated_at FROM clip_items c {filters} \
                 ORDER BY c.updated_at DESC,c.id LIMIT ?"
            );
            let mut db_query = sqlx::query(sqlx::AssertSqlSafe(sql));
            for binding in bindings {
                db_query = db_query.bind(binding);
            }
            let rows = db_query
                .bind((SOURCE_CANDIDATE_LIMIT + 1) as i64)
                .fetch_all(&context.repo.pool)
                .await?;
            let truncated = rows.len() > SOURCE_CANDIDATE_LIMIT;
            return Ok(SourceCandidates {
                items: rows
                    .into_iter()
                    .take(SOURCE_CANDIDATE_LIMIT)
                    .map(|row| RankedCandidate {
                        clip_id: row.get(0),
                        snippet: None,
                        source_score: None,
                        updated_at: row.get(1),
                    })
                    .collect(),
                truncated,
            });
        };
        let sql = format!(
            "SELECT fts.clip_id,sd.search_text,c.updated_at \
             FROM search_documents_fts fts \
             JOIN search_documents sd ON sd.clip_id=fts.clip_id \
             JOIN clip_items c ON c.id=fts.clip_id \
             {filters} AND search_documents_fts MATCH ? \
             ORDER BY fts.rank,fts.clip_id LIMIT ?"
        );
        let mut db_query = sqlx::query(sqlx::AssertSqlSafe(sql));
        for binding in bindings {
            db_query = db_query.bind(binding);
        }
        let rows = db_query
            .bind(query)
            .bind((SOURCE_CANDIDATE_LIMIT + 1) as i64)
            .fetch_all(&context.repo.pool)
            .await
            .context("invalid advanced FTS5 query")?;
        let truncated = rows.len() > SOURCE_CANDIDATE_LIMIT;
        Ok(SourceCandidates {
            items: rows
                .into_iter()
                .take(SOURCE_CANDIDATE_LIMIT)
                .map(|row| {
                    let text: String = row.get(1);
                    RankedCandidate {
                        clip_id: row.get(0),
                        snippet: build_snippet(query, Some(&text)),
                        source_score: None,
                        updated_at: row.get(2),
                    }
                })
                .collect(),
            truncated,
        })
    }
}

struct SemanticTextSearchSource;

#[async_trait]
impl SearchSource for SemanticTextSearchSource {
    fn descriptor(&self) -> StaticSearchSourceDescriptor {
        StaticSearchSourceDescriptor {
            id: SEMANTIC_TEXT_SOURCE_ID,
            label: "Meaning Search",
            mandatory: false,
            input_kinds: &["text"],
            indexing_required: true,
        }
    }
    async fn candidates(&self, context: &SourceContext<'_>) -> Result<SourceCandidates> {
        let eligible = context
            .semantic_eligible
            .context("semantic eligibility was not resolved")?;
        let eligible_ids: HashSet<_> = eligible.keys().cloned().collect();
        let rows = semantic::semantic_matches(
            context.repo,
            context.query,
            &eligible_ids,
            SOURCE_CANDIDATE_LIMIT + 1,
        )
        .await?;
        let truncated = rows.len() > SOURCE_CANDIDATE_LIMIT;
        Ok(SourceCandidates {
            items: rows
                .into_iter()
                .take(SOURCE_CANDIDATE_LIMIT)
                .map(|(clip_id, score, text)| {
                    let updated_at = eligible[&clip_id];
                    RankedCandidate {
                        clip_id,
                        snippet: Some(text.chars().take(160).collect()),
                        source_score: Some(score),
                        updated_at,
                    }
                })
                .collect(),
            truncated,
        })
    }
}

fn registered_search_sources() -> Vec<Box<dyn SearchSource>> {
    vec![
        Box::new(FtsSearchSource),
        Box::new(SemanticTextSearchSource),
    ]
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchCursor {
    fingerprint: String,
    score_bits: u64,
    updated_at: i64,
    clip_id: String,
}

struct FusedCandidate {
    clip_id: String,
    score: f64,
    updated_at: i64,
    matches: Vec<SearchMatch>,
    snippet: Option<String>,
}

fn fuse_source(
    fused: &mut HashMap<String, FusedCandidate>,
    source_id: &str,
    candidates: Vec<RankedCandidate>,
) {
    for (index, candidate) in candidates.into_iter().enumerate() {
        let rank = (index + 1) as u32;
        let entry = fused
            .entry(candidate.clip_id.clone())
            .or_insert_with(|| FusedCandidate {
                updated_at: candidate.updated_at,
                clip_id: candidate.clip_id.clone(),
                score: 0.0,
                matches: Vec::new(),
                snippet: None,
            });
        entry.score += 1.0 / (RRF_K + f64::from(rank));
        entry.matches.push(SearchMatch {
            source_id: source_id.into(),
            source_rank: rank,
            source_score: candidate.source_score,
        });
        if entry.snippet.is_none() {
            entry.snippet = candidate.snippet;
        }
    }
}

pub async fn search(
    repo: &HistoryRepository,
    request: &SearchRequest,
    settings: &SearchSettings,
) -> Result<SearchPage> {
    let raw = request.query.trim();
    if raw.is_empty()
        && request.representation_families.is_empty()
        && request.facet_ids.is_empty()
        && request.tag_id.is_none()
        && request.scope.as_deref().unwrap_or("all") == "all"
    {
        return Ok(SearchPage {
            items: Vec::new(),
            total: 0,
            next_cursor: None,
            source_outcomes: vec![SearchSourceOutcome {
                source_id: FTS_SOURCE_ID.into(),
                status: SearchSourceOutcomeStatus::Used,
                diagnostic: None,
            }],
            is_exhaustive: true,
        });
    }
    let fts_query = (!raw.is_empty()).then(|| match settings.syntax_mode {
        SyntaxMode::Simple => to_simple_query(raw),
        SyntaxMode::Advanced => raw.to_string(),
    });
    let mut selected: HashSet<String> = if request.enabled_source_ids.is_empty() {
        settings.enabled_source_ids.iter().cloned().collect()
    } else {
        request.enabled_source_ids.iter().cloned().collect()
    };
    selected.insert(FTS_SOURCE_ID.into());
    let sources: Vec<Box<dyn SearchSource>> = registered_search_sources()
        .into_iter()
        .filter(|source| source.mandatory() || (!raw.is_empty() && selected.contains(source.id())))
        .collect();
    let semantic_eligible = if sources
        .iter()
        .any(|source| source.id() == SEMANTIC_TEXT_SOURCE_ID)
    {
        Some(eligible_clips(repo, request).await?)
    } else {
        None
    };
    let context = SourceContext {
        repo,
        request,
        query: raw,
        fts_query: fts_query.as_deref(),
        semantic_eligible: semantic_eligible.as_ref(),
    };
    let results = join_all(sources.iter().map(|source| source.candidates(&context))).await;
    let mut outcomes = Vec::new();
    let mut fused: HashMap<String, FusedCandidate> = HashMap::new();
    let mut exhaustive = true;
    for (source, result) in sources.iter().zip(results) {
        match result {
            Ok(candidates) => {
                exhaustive &= !candidates.truncated;
                outcomes.push(SearchSourceOutcome {
                    source_id: source.id().into(),
                    status: SearchSourceOutcomeStatus::Used,
                    diagnostic: None,
                });
                fuse_source(&mut fused, source.id(), candidates.items);
            }
            Err(error) if source.mandatory() => return Err(error),
            Err(error) => outcomes.push(SearchSourceOutcome {
                source_id: source.id().into(),
                status: SearchSourceOutcomeStatus::Unavailable,
                diagnostic: Some(error.to_string()),
            }),
        }
    }
    let mut ranked: Vec<_> = fused.into_values().collect();
    ranked.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| a.clip_id.cmp(&b.clip_id))
    });
    let mut selected_for_fingerprint: Vec<_> = selected.iter().collect();
    selected_for_fingerprint.sort();
    let fingerprint = crate::history::sha256(
        serde_json::to_string(&(
            raw,
            request.scope.as_deref(),
            request.tag_id.as_deref(),
            &request.representation_families,
            &request.facet_ids,
            selected_for_fingerprint,
            &settings.syntax_mode,
        ))?
        .as_bytes(),
    );
    let start = if let Some(cursor) = &request.cursor {
        let cursor: SearchCursor = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(cursor)?)?;
        if cursor.fingerprint != fingerprint {
            anyhow::bail!("search cursor does not match the current query")
        }
        ranked
            .iter()
            .position(|item| {
                item.score.to_bits() == cursor.score_bits
                    && item.updated_at == cursor.updated_at
                    && item.clip_id == cursor.clip_id
            })
            .context("search cursor is no longer valid")?
            + 1
    } else {
        0
    };
    let limit = request.limit.unwrap_or(50).clamp(1, 100) as usize;
    let end = (start + limit).min(ranked.len());
    let next_cursor = (end < ranked.len()).then(|| {
        let last = &ranked[end - 1];
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&SearchCursor {
                fingerprint: fingerprint.clone(),
                score_bits: last.score.to_bits(),
                updated_at: last.updated_at,
                clip_id: last.clip_id.clone(),
            })
            .expect("cursor serialization cannot fail"),
        )
    });
    let mut items = Vec::with_capacity(end.saturating_sub(start));
    for candidate in &ranked[start..end] {
        items.push(SearchResult {
            clip: repo.summary(&candidate.clip_id).await?,
            snippet: candidate.snippet.clone(),
            rank: candidate.score,
            matches: candidate.matches.clone(),
        });
    }
    Ok(SearchPage {
        items,
        total: ranked.len().min(u32::MAX as usize) as u32,
        next_cursor,
        source_outcomes: outcomes,
        is_exhaustive: exhaustive,
    })
}

async fn eligible_clips(
    repo: &HistoryRepository,
    request: &SearchRequest,
) -> Result<HashMap<String, i64>> {
    let (filters, bindings) = eligibility_filter(request)?;
    let sql = format!("SELECT c.id,c.updated_at FROM clip_items c {filters}");
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for binding in bindings {
        query = query.bind(binding);
    }
    Ok(query
        .fetch_all(&repo.pool)
        .await?
        .into_iter()
        .map(|row| (row.get(0), row.get(1)))
        .collect())
}

/// SQL predicate shared by FTS and semantic eligibility. The caller chooses the
/// select/order clause, so FTS never needs an in-memory list of every matching clip.
fn eligibility_filter(request: &SearchRequest) -> Result<(String, Vec<String>)> {
    let mut sql = String::from("WHERE c.lifecycle_state='ready'");
    let mut bindings = Vec::new();
    match request.scope.as_deref().unwrap_or("all") {
        "favorites" => sql.push_str(" AND c.is_favorite=1"),
        "pinned" => sql.push_str(" AND c.is_pinned=1"),
        _ => {}
    }
    if let Some(tag_id) = &request.tag_id {
        sql.push_str(
            " AND EXISTS(SELECT 1 FROM catalog_clip_tags ct WHERE ct.clip_id=c.id AND ct.tag_id=?)",
        );
        bindings.push(tag_id.clone());
    }
    if !request.representation_families.is_empty() {
        sql.push_str(" AND EXISTS(SELECT 1 FROM clip_representations sr JOIN json_each(?) families ON ((families.value='text' AND sr.storage_kind='text') OR (families.value='image' AND sr.canonical_mime_type LIKE 'image/%') OR (families.value='files' AND sr.storage_kind='file_list') OR (families.value='html' AND sr.canonical_mime_type='text/html') OR (families.value='rtf' AND sr.canonical_mime_type IN ('text/rtf','application/rtf')) OR (families.value='office' AND sr.format_family='office') OR (families.value='document' AND sr.canonical_mime_type IN ('application/pdf','image/svg+xml'))) WHERE sr.clip_id=c.id AND sr.lifecycle_state='ready')");
        bindings.push(serde_json::to_string(&request.representation_families)?);
    }
    if !request.facet_ids.is_empty() {
        sql.push_str(" AND EXISTS(SELECT 1 FROM content_clip_facets sf JOIN json_each(?) facets ON sf.facet_id=facets.value WHERE sf.clip_id=c.id)");
        bindings.push(serde_json::to_string(&request.facet_ids)?);
    }
    Ok((sql, bindings))
}

pub async fn get_settings(pool: &SqlitePool) -> Result<SearchSettings> {
    let raw: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='search.syntax_mode'",
    )
    .fetch_optional(pool)
    .await?;
    let mode = match raw.as_deref() {
        Some(v) => serde_json::from_str(v).unwrap_or(SyntaxMode::Simple),
        None => SyntaxMode::Simple,
    };
    let sources: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='search.enabled_sources'",
    )
    .fetch_optional(pool)
    .await?;
    let mut enabled_source_ids: Vec<String> = sources
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(default_enabled_sources);
    if !enabled_source_ids.iter().any(|id| id == FTS_SOURCE_ID) {
        enabled_source_ids.insert(0, FTS_SOURCE_ID.into());
    }
    Ok(SearchSettings {
        syntax_mode: mode,
        enabled_source_ids,
    })
}

pub async fn update_settings(pool: &SqlitePool, settings: &SearchSettings) -> Result<()> {
    let value = serde_json::to_string(&settings.syntax_mode)?;
    sqlx::query(
        "INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('search.syntax_mode',?,?,?) \
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
    )
    .bind(&value)
    .bind(now_ms())
    .bind(now_ms())
    .execute(pool)
    .await?;
    let mut enabled = settings.enabled_source_ids.clone();
    if !enabled.iter().any(|id| id == FTS_SOURCE_ID) {
        enabled.insert(0, FTS_SOURCE_ID.into());
    }
    sqlx::query(
        "INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('search.enabled_sources',?,?,?) \
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
    )
    .bind(serde_json::to_string(&enabled)?)
    .bind(now_ms())
    .bind(now_ms())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_sources(repo: &HistoryRepository) -> Result<Vec<SearchSourceDescriptor>> {
    let settings = get_settings(&repo.pool).await?;
    let provider = semantic::status(repo).await?;
    let semantic_state = match provider.phase {
        semantic::ProviderPhase::Ready => SearchSourceState::Ready,
        semantic::ProviderPhase::Indexing
        | semantic::ProviderPhase::Checking
        | semantic::ProviderPhase::ValidatingModel => SearchSourceState::Indexing,
        semantic::ProviderPhase::Degraded => SearchSourceState::Degraded,
        semantic::ProviderPhase::Disabled => SearchSourceState::Disabled,
        semantic::ProviderPhase::NotConfigured => SearchSourceState::NotConfigured,
    };
    Ok(registered_search_sources()
        .into_iter()
        .map(|source| {
            let descriptor = source.descriptor();
            let semantic = descriptor.id == SEMANTIC_TEXT_SOURCE_ID;
            SearchSourceDescriptor {
                id: descriptor.id.into(),
                label: descriptor.label.into(),
                mandatory: descriptor.mandatory,
                input_kinds: descriptor
                    .input_kinds
                    .iter()
                    .map(|kind| (*kind).into())
                    .collect(),
                indexing_required: descriptor.indexing_required,
                enabled: descriptor.mandatory
                    || settings
                        .enabled_source_ids
                        .iter()
                        .any(|id| id == descriptor.id),
                state: if semantic {
                    semantic_state.clone()
                } else {
                    SearchSourceState::Ready
                },
                diagnostic: semantic.then(|| provider.diagnostic.clone()).flatten(),
            }
        })
        .collect())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Convert free text to escaped FTS5 prefix terms joined with implicit AND.
fn to_simple_query(raw: &str) -> String {
    raw.split_whitespace()
        .filter_map(|token| {
            let escaped = token.replace('"', "");
            (!escaped.is_empty()).then(|| format!("\"{escaped}\"*"))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_snippet(query: &str, text: Option<&str>) -> Option<String> {
    let text = text?;
    let first_token = query
        .split_whitespace()
        .next()
        .map(|token| token.trim_end_matches('*').trim_matches('"'))
        .unwrap_or("");
    if first_token.is_empty() {
        return Some(text.chars().take(160).collect());
    }
    let lower = text.to_lowercase();
    let lower_tok = first_token.to_lowercase();
    let pos = lower.find(&lower_tok).unwrap_or(0);
    let start = pos.saturating_sub(40);
    let snippet: String = text.chars().skip(start).take(160).collect();
    Some(snippet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        contributions,
        foundation::AppRoots,
        history::{CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot},
    };

    fn request(query: &str) -> SearchRequest {
        SearchRequest {
            query: query.into(),
            scope: Some("all".into()),
            tag_id: None,
            limit: Some(50),
            cursor: None,
            enabled_source_ids: vec![FTS_SOURCE_ID.into()],
            representation_families: Vec::new(),
            facet_ids: Vec::new(),
        }
    }

    async fn capture(
        repo: &HistoryRepository,
        token: u64,
        representation: CapturedRepresentation,
    ) -> String {
        capture_many(repo, token, vec![representation]).await
    }

    async fn capture_many(
        repo: &HistoryRepository,
        token: u64,
        representations: Vec<CapturedRepresentation>,
    ) -> String {
        repo.capture(
            CapturedSnapshot {
                token,
                source_app_name: None,
                source_app_id: None,
                format_observations: Vec::new(),
                representations,
            },
            &CaptureSettings::default(),
        )
        .await
        .unwrap()
        .0
    }

    #[tokio::test]
    async fn fts_projection_uses_distinct_visible_text_not_rich_text_source() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let clip_id = capture_many(
            &repo,
            1,
            vec![
                CapturedRepresentation {
                    format_key: "text:plain".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Text("Hello world".into()),
                },
                CapturedRepresentation {
                    format_key: "text:html".into(),
                    canonical_mime_type: Some("text/html".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 2,
                    payload: CapturedPayload::Text("<p>Hello <b>world</b></p>".into()),
                },
                CapturedRepresentation {
                    format_key: "text:rtf".into(),
                    canonical_mime_type: Some("text/rtf".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 3,
                    payload: CapturedPayload::Text(r#"{\rtf1\ansi Hello \b world}"#.into()),
                },
                CapturedRepresentation {
                    format_key: "text:unsafe-rtf".into(),
                    canonical_mime_type: Some("application/rtf".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 4,
                    payload: CapturedPayload::Text(r#"{\rtf1\object\objdata secret}"#.into()),
                },
                CapturedRepresentation {
                    format_key: "text:json".into(),
                    canonical_mime_type: Some("application/json".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 5,
                    payload: CapturedPayload::Text(r#"{"status":"ready"}"#.into()),
                },
            ],
        )
        .await;
        upsert_projection(&repo, &clip_id).await.unwrap();

        let text: String =
            sqlx::query_scalar("SELECT search_text FROM search_documents WHERE clip_id=?")
                .bind(&clip_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(text, "Hello world\n{\"status\":\"ready\"}");
        assert!(!text.contains("<p>"));
        assert!(!text.contains("\\rtf"));
        assert!(!text.contains("secret"));

        let settings = SearchSettings {
            syntax_mode: SyntaxMode::Simple,
            enabled_source_ids: vec![FTS_SOURCE_ID.into()],
        };
        assert_eq!(
            search(&repo, &request("world"), &settings)
                .await
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            search(&repo, &request("objdata"), &settings)
                .await
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            search(&repo, &request("status"), &settings)
                .await
                .unwrap()
                .total,
            1
        );
    }

    #[tokio::test]
    async fn stale_projection_rebuilds_in_bounded_batches() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();

        for token in 0..(PROJECTION_REBUILD_BATCH_SIZE as u64 + 1) {
            capture(
                &repo,
                token,
                CapturedRepresentation {
                    format_key: "windows:CF_UNICODETEXT".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: Some("CF_UNICODETEXT".into()),
                    platform: "windows".into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Text(format!("batch document {token}")),
                },
            )
            .await;
        }

        assert_eq!(
            rebuild_stale_projections(&repo).await.unwrap(),
            PROJECTION_REBUILD_BATCH_SIZE as u64 + 1
        );
        let projections: i64 = sqlx::query_scalar("SELECT count(*) FROM search_documents")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(projections, PROJECTION_REBUILD_BATCH_SIZE + 1);
        assert_eq!(rebuild_stale_projections(&repo).await.unwrap(), 0);
    }

    #[test]
    fn simple_query_uses_escaped_prefix_terms_with_implicit_and() {
        assert_eq!(to_simple_query("doc ref"), "\"doc\"* \"ref\"*");
        assert_eq!(to_simple_query("a\"b"), "\"ab\"*");
        assert_eq!(to_simple_query("\"\""), "");
    }

    #[test]
    fn balanced_rrf_unions_any_number_of_sources_and_rewards_consensus() {
        let mut fused = HashMap::new();
        fuse_source(
            &mut fused,
            FTS_SOURCE_ID,
            vec![
                RankedCandidate {
                    clip_id: "keyword".into(),
                    snippet: None,
                    source_score: None,
                    updated_at: 3,
                },
                RankedCandidate {
                    clip_id: "meaning".into(),
                    snippet: None,
                    source_score: None,
                    updated_at: 2,
                },
            ],
        );
        fuse_source(
            &mut fused,
            SEMANTIC_TEXT_SOURCE_ID,
            vec![
                RankedCandidate {
                    clip_id: "meaning".into(),
                    snippet: None,
                    source_score: Some(0.82),
                    updated_at: 2,
                },
                RankedCandidate {
                    clip_id: "visual".into(),
                    snippet: None,
                    source_score: Some(0.74),
                    updated_at: 1,
                },
            ],
        );
        fuse_source(
            &mut fused,
            "test.search.visual",
            vec![RankedCandidate {
                clip_id: "visual".into(),
                snippet: None,
                source_score: None,
                updated_at: 1,
            }],
        );
        assert_eq!(fused.len(), 3);
        assert_eq!(fused["meaning"].matches.len(), 2);
        assert_eq!(fused["meaning"].matches[1].source_score, Some(0.82));
        assert_eq!(fused["visual"].matches.len(), 2);
        assert!(fused["meaning"].score > fused["keyword"].score);
    }

    #[tokio::test]
    async fn prefix_search_and_filter_only_queries_cover_unprojected_clips() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        contributions::initialize(&repo).await.unwrap();

        let text_id = capture(
            &repo,
            1,
            CapturedRepresentation {
                format_key: "windows:CF_UNICODETEXT".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("CF_UNICODETEXT".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Text("documentation reference".into()),
            },
        )
        .await;
        upsert_projection(&repo, &text_id).await.unwrap();

        let file_id = capture(
            &repo,
            2,
            CapturedRepresentation {
                format_key: "windows:CF_HDROP".into(),
                canonical_mime_type: Some("application/x-file-list".into()),
                native_type: Some("CF_HDROP".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Files(vec![r"C:\Temp\example.txt".into()]),
            },
        )
        .await;
        let image_id = capture(
            &repo,
            3,
            CapturedRepresentation {
                format_key: "windows:PNG".into(),
                canonical_mime_type: Some("image/png".into()),
                native_type: Some("PNG".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Binary(vec![1, 2, 3]),
            },
        )
        .await;
        let json_id = capture(
            &repo,
            4,
            CapturedRepresentation {
                format_key: "windows:CF_UNICODETEXT".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("CF_UNICODETEXT".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Text("{\"ready\":true}".into()),
            },
        )
        .await;
        contributions::detect_clip(&repo, &json_id).await.unwrap();

        let settings = SearchSettings {
            syntax_mode: SyntaxMode::Simple,
            enabled_source_ids: vec![FTS_SOURCE_ID.into()],
        };
        let prefix = search(&repo, &request("doc"), &settings).await.unwrap();
        assert_eq!(prefix.items.len(), 1);
        assert_eq!(prefix.items[0].clip.id, text_id);
        assert!(search(&repo, &request("ument"), &settings)
            .await
            .unwrap()
            .items
            .is_empty());

        let mut files = request("");
        files.representation_families.push("files".into());
        let file_results = search(&repo, &files, &settings).await.unwrap();
        assert_eq!(file_results.items.len(), 1);
        assert_eq!(file_results.items[0].clip.id, file_id);
        assert!(file_results.items[0]
            .matches
            .iter()
            .any(|item| item.source_id == FTS_SOURCE_ID));

        let mut images = request("");
        images.representation_families.push("image".into());
        assert_eq!(
            search(&repo, &images, &settings).await.unwrap().items[0]
                .clip
                .id,
            image_id
        );

        let mut facets = request("");
        facets.facet_ids.push("core.data.json".into());
        assert_eq!(
            search(&repo, &facets, &settings).await.unwrap().items[0]
                .clip
                .id,
            json_id
        );

        let advanced = SearchSettings {
            syntax_mode: SyntaxMode::Advanced,
            enabled_source_ids: vec![FTS_SOURCE_ID.into()],
        };
        assert!(search(&repo, &request("doc*"), &advanced)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.clip.id == text_id));
    }
}
