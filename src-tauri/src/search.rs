//! FTS5-backed search: projection, queries, and settings.
use crate::history::{now_ms, ClipSummary, HistoryRepository};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

const PROJECTION_VERSION: i64 = 1;

// ─── Domain ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub clip: ClipSummary,
    pub snippet: Option<String>,
    pub rank: f64,
    pub fts_match: bool,
    pub semantic_match: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<SearchResult>,
    pub total: u32,
    pub next_cursor: Option<String>,
    pub effective_mode: SearchMode,
    pub provider_diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub scope: Option<String>,
    pub tag_id: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    pub mode: Option<SearchMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Fts,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettings {
    pub syntax_mode: SyntaxMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyntaxMode {
    Simple,
    Advanced,
}

// ─── Projection ───────────────────────────────────────────────────────────────

/// Build or refresh `search_documents` for every ready clip that is missing or
/// stale (wrong `projection_version`).
pub async fn rebuild_stale_projections(repo: &HistoryRepository) -> Result<u64> {
    let stale_ids: Vec<String> = sqlx::query_scalar(
        "SELECT c.id FROM clip_items c \
         WHERE c.lifecycle_state = 'ready' \
           AND NOT EXISTS ( \
               SELECT 1 FROM search_documents sd \
               WHERE sd.clip_id = c.id \
                 AND sd.projection_version = ? \
           )",
    )
    .bind(PROJECTION_VERSION)
    .fetch_all(&repo.pool)
    .await?;

    let count = stale_ids.len() as u64;
    for id in stale_ids {
        let _ = upsert_projection(repo, &id).await;
    }
    Ok(count)
}

/// Rebuild the search document for a single clip.
pub async fn upsert_projection(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    let text = build_search_text(repo, clip_id).await?;
    let manifest = build_manifest(repo, clip_id).await?;
    let now = now_ms();
    sqlx::query(
        "INSERT INTO search_documents(clip_id,search_text,projection_version,source_manifest_json,updated_at) \
         VALUES(?,?,?,?,?) \
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

    // 2. Plain-text representations (ordered by capture_priority, ordinal)
    let texts: Vec<String> = sqlx::query_scalar(
        "SELECT t.text_value FROM clip_representations r \
         JOIN clip_text_values t ON t.representation_id = r.id \
         WHERE r.clip_id = ? AND r.lifecycle_state = 'ready' \
           AND r.canonical_mime_type IN ('text/plain','text/html','text/rtf','application/rtf') \
         ORDER BY r.capture_priority, r.ordinal",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    parts.extend(texts);

    // 3. OCR text from artifact (if any)
    if let Some(ocr) = crate::artifacts::ocr_text(repo, clip_id).await {
        parts.push(ocr);
    }

    Ok(parts.join("\n"))
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

pub async fn search(
    repo: &HistoryRepository,
    request: &SearchRequest,
    settings: &SearchSettings,
) -> Result<SearchPage> {
    let raw = request.query.trim();
    if raw.is_empty() {
        return Ok(SearchPage {
            items: Vec::new(),
            total: 0,
            next_cursor: None,
            effective_mode: SearchMode::Fts,
            provider_diagnostic: None,
        });
    }

    let fts_query = match settings.syntax_mode {
        SyntaxMode::Simple => to_simple_query(raw),
        SyntaxMode::Advanced => raw.to_string(),
    };

    let limit = request.limit.unwrap_or(50).clamp(1, 100) as i64;
    let scope = request.scope.as_deref().unwrap_or("all");

    // Build the query with optional scope / tag filters.
    // We use a CTe so the scope filter applies before the FTS join.
    let mut sql = String::from(
        "SELECT c.id, c.source_app_name, c.source_app_id, c.captured_at, c.updated_at, \
         c.is_pinned, c.is_favorite, c.note, \
         (SELECT count(*) FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready'), \
         COALESCE((SELECT substr(t.text_value,1,180) FROM clip_representations r \
                   JOIN clip_text_values t ON t.representation_id=r.id \
                   WHERE r.clip_id=c.id AND r.lifecycle_state='ready' \
                   ORDER BY r.ordinal LIMIT 1),'Binary or file content'), \
         fts.rank \
         FROM search_documents_fts fts \
         JOIN clip_items c ON c.id = fts.clip_id \
         WHERE fts.search_text MATCH ? \
           AND c.lifecycle_state = 'ready'",
    );
    if scope == "favorites" {
        sql.push_str(" AND c.is_favorite=1");
    } else if scope == "pinned" {
        sql.push_str(" AND c.is_pinned=1");
    }
    if request.tag_id.is_some() {
        sql.push_str(
            " AND EXISTS(SELECT 1 FROM catalog_clip_tags ct WHERE ct.clip_id=c.id AND ct.tag_id=?)",
        );
    }
    if request.cursor.is_some() {
        sql.push_str(" AND (fts.rank > ? OR (fts.rank = ? AND c.id < ?))");
    }
    sql.push_str(" ORDER BY fts.rank, c.id DESC LIMIT ?");

    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(&fts_query);
    if let Some(tag) = &request.tag_id {
        q = q.bind(tag);
    }
    if let Some(cursor) = &request.cursor {
        let (rank_s, id) = cursor.split_once('|').context("invalid search cursor")?;
        let rank: f64 = rank_s.parse()?;
        q = q.bind(rank).bind(rank).bind(id);
    }
    let rows = q.bind(limit + 1).fetch_all(&repo.pool).await?;
    let has_more = rows.len() as i64 > limit;
    let total = rows.len().min(limit as usize) as u32;

    let mut items = Vec::new();
    let mut next_cursor = None;
    for (index, row) in rows.into_iter().take(limit as usize).enumerate() {
        let clip_id: String = row.get(0);
        let tags = sqlx::query(
            "SELECT t.id, t.name, t.color FROM catalog_tags t \
             JOIN catalog_clip_tags ct ON ct.tag_id=t.id \
             WHERE ct.clip_id=? ORDER BY t.name",
        )
        .bind(&clip_id)
        .fetch_all(&repo.pool)
        .await?
        .into_iter()
        .map(|r| crate::history::Tag {
            id: r.get(0),
            name: r.get(1),
            color: r.get(2),
        })
        .collect();
        let rank: f64 = row.get(10);
        let snippet = build_snippet(&fts_query, row.get::<Option<String>, _>(9).as_deref());
        items.push(SearchResult {
            clip: ClipSummary {
                id: clip_id,
                source_app_name: row.get(1),
                source_app_id: row.get(2),
                captured_at: row.get(3),
                updated_at: row.get(4),
                is_pinned: row.get::<i64, _>(5) != 0,
                is_favorite: row.get::<i64, _>(6) != 0,
                note: row.get(7),
                representation_count: row.get(8),
                safe_summary: row.get(9),
                tags,
            },
            snippet,
            rank,
            fts_match: true,
            semantic_match: None,
        });
        if has_more && index + 1 == limit as usize {
            next_cursor = Some(format!(
                "{rank}|{}",
                items.last().expect("just inserted").clip.id
            ));
        }
    }
    let requested_hybrid = match request.mode {
        Some(SearchMode::Fts) => false,
        Some(SearchMode::Hybrid) => true,
        None => crate::embeddings::status(repo)
            .await
            .map(|status| status.active_space_id.is_some())
            .unwrap_or(false),
    };
    let mut diagnostic = None;
    let effective_mode = if requested_hybrid {
        match crate::embeddings::hybrid_matches(repo, raw, (limit * 4).max(100) as usize).await {
            Ok(semantic) => {
                let semantic_scores: std::collections::HashMap<_, _> = semantic
                    .into_iter()
                    .map(|(clip_id, score, _)| (clip_id, score))
                    .collect();
                for item in &mut items {
                    item.semantic_match = semantic_scores.get(&item.clip.id).copied();
                }
                // Reciprocal-rank fusion uses rank positions, not model-specific scores.
                let mut semantic_order: Vec<_> = items
                    .iter()
                    .filter_map(|item| {
                        item.semantic_match
                            .map(|score| (item.clip.id.clone(), score))
                    })
                    .collect();
                semantic_order.sort_by(|a, b| b.1.total_cmp(&a.1));
                let semantic_rank: std::collections::HashMap<_, _> = semantic_order
                    .into_iter()
                    .enumerate()
                    .map(|(i, (id, _))| (id, i + 1))
                    .collect();
                for (index, item) in items.iter_mut().enumerate() {
                    let fts = 1.0 / (60.0 + (index + 1) as f64);
                    let semantic = semantic_rank
                        .get(&item.clip.id)
                        .map(|rank| 1.0 / (60.0 + *rank as f64))
                        .unwrap_or(0.0);
                    item.rank = fts + semantic;
                }
                items.sort_by(|a, b| {
                    b.rank
                        .total_cmp(&a.rank)
                        .then_with(|| b.clip.updated_at.cmp(&a.clip.updated_at))
                        .then_with(|| a.clip.id.cmp(&b.clip.id))
                });
                SearchMode::Hybrid
            }
            Err(error) => {
                diagnostic = Some(error.to_string());
                SearchMode::Fts
            }
        }
    } else {
        SearchMode::Fts
    };
    Ok(SearchPage {
        items,
        total,
        next_cursor,
        effective_mode,
        provider_diagnostic: diagnostic,
    })
}

// ─── Settings ────────────────────────────────────────────────────────────────

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
    Ok(SearchSettings { syntax_mode: mode })
}

pub async fn update_settings(pool: &SqlitePool, settings: &SearchSettings) -> Result<()> {
    let value = serde_json::to_string(&settings.syntax_mode)?;
    sqlx::query(
        "INSERT INTO config_profile_values(key,value_json,updated_at) VALUES('search.syntax_mode',?,?) \
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
    )
    .bind(&value)
    .bind(now_ms())
    .execute(pool)
    .await?;
    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Convert free text to an FTS5 implicit-AND phrase query by quoting each token.
fn to_simple_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(|tok| format!("\"{}\"", tok.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_snippet(query: &str, text: Option<&str>) -> Option<String> {
    let text = text?;
    let first_token = query
        .split_whitespace()
        .next()
        .map(|t| t.trim_matches('"'))
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
