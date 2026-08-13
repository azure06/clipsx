//! Search projection, FTS queries, and hybrid ranking.
pub mod semantic;
use crate::history::{now_ms, ClipSummary, HistoryRepository};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

const PROJECTION_VERSION: i64 = 2;

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
    #[serde(default)]
    pub representation_families: Vec<String>,
    #[serde(default)]
    pub facet_ids: Vec<String>,
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

    // 2. User-assigned tags. Tags are searchable intent, not canonical payload.
    let tags: Vec<String> = sqlx::query_scalar(
        "SELECT t.name FROM catalog_tags t \
         JOIN catalog_clip_tags ct ON ct.tag_id=t.id WHERE ct.clip_id=? ORDER BY t.name",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    parts.extend(tags);

    // 3. Text representations (ordered by capture_priority, ordinal)
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

    // 4. OCR text from artifact (if any)
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
    if raw.is_empty() && request.representation_families.is_empty() && request.facet_ids.is_empty()
    {
        return Ok(SearchPage {
            items: Vec::new(),
            total: 0,
            next_cursor: None,
            effective_mode: SearchMode::Fts,
            provider_diagnostic: None,
        });
    }

    let fts_query = (!raw.is_empty()).then(|| match settings.syntax_mode {
        SyntaxMode::Simple => to_simple_query(raw),
        SyntaxMode::Advanced => raw.to_string(),
    });

    let limit = request.limit.unwrap_or(50).clamp(1, 100) as i64;
    let scope = request.scope.as_deref().unwrap_or("all");

    // Text queries require an FTS candidate. Filter-only queries start from the
    // canonical clip catalog so they still work while projections are pending.
    let mut sql = String::from(
        "SELECT c.id, c.source_app_name, c.source_app_id, c.captured_at, c.updated_at, \
         c.is_pinned, c.is_favorite, c.note, \
         (SELECT count(*) FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready'), \
         COALESCE((SELECT substr(t.text_value,1,180) FROM clip_representations r \
                   JOIN clip_text_values t ON t.representation_id=r.id \
                   WHERE r.clip_id=c.id AND r.lifecycle_state='ready' \
                   ORDER BY r.ordinal LIMIT 1),'Binary or file content'), \
         COALESCE((SELECT CASE WHEN r.storage_kind='file_list' THEN 'files' WHEN r.canonical_mime_type LIKE 'image/%' THEN 'image' WHEN r.canonical_mime_type='text/html' THEN 'html' WHEN r.canonical_mime_type IN ('text/rtf','application/rtf') THEN 'rich_text' WHEN r.canonical_mime_type IN ('application/pdf','image/svg+xml') THEN 'document' WHEN lower(COALESCE(r.native_type,'')) LIKE '%office%' OR lower(COALESCE(r.native_type,'')) LIKE '%word%' OR lower(COALESCE(r.native_type,'')) LIKE '%excel%' OR lower(COALESCE(r.native_type,'')) LIKE '%powerpoint%' THEN 'office' WHEN r.storage_kind='text' THEN 'text' ELSE 'unsupported' END FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready' ORDER BY r.capture_priority,r.ordinal LIMIT 1),'unsupported'), \
         (SELECT r.binary_file_id FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready' AND r.canonical_mime_type LIKE 'image/%' ORDER BY r.capture_priority,r.ordinal LIMIT 1), \
         CASE WHEN ? THEN fts.rank ELSE 0.0 END, \
         EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id=c.id), \
         (SELECT aj.status FROM artifact_jobs aj JOIN clip_representations cr ON cr.id=aj.target_representation_id WHERE cr.clip_id=c.id AND aj.artifact_kind='ocr' ORDER BY aj.requested_at DESC LIMIT 1) \
         ",
    );
    if fts_query.is_some() {
        sql.push_str(
            " FROM search_documents_fts fts \
             JOIN clip_items c ON c.id = fts.clip_id \
             WHERE c.lifecycle_state = 'ready' AND fts.search_text MATCH ?",
        );
    } else {
        sql.push_str(
            " FROM clip_items c \
             LEFT JOIN search_documents_fts fts ON fts.clip_id = c.id \
             WHERE c.lifecycle_state = 'ready'",
        );
    }
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
    if !request.representation_families.is_empty() {
        sql.push_str(" AND (");
        for (index, _) in request.representation_families.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            sql.push_str(
                "EXISTS(SELECT 1 FROM clip_representations sr WHERE sr.clip_id=c.id \
                 AND sr.lifecycle_state='ready' AND \
                 ((?='text' AND sr.storage_kind='text') OR \
                  (?='image' AND sr.canonical_mime_type LIKE 'image/%') OR \
                  (?='files' AND sr.storage_kind='file_list') OR \
                  (?='html' AND sr.canonical_mime_type='text/html') OR \
                  (?='rtf' AND sr.canonical_mime_type IN ('text/rtf','application/rtf')) OR \
                  (?='office' AND (sr.native_type LIKE '%office%' OR sr.native_type LIKE '%word%' OR sr.native_type LIKE '%excel%' OR sr.native_type LIKE '%powerpoint%')) OR \
                  (?='document' AND sr.canonical_mime_type IN ('application/pdf','image/svg+xml'))))",
            );
        }
        sql.push(')');
    }
    if !request.facet_ids.is_empty() {
        sql.push_str(" AND (");
        for (index, _) in request.facet_ids.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            sql.push_str(
                "EXISTS(SELECT 1 FROM content_clip_facets sf WHERE sf.clip_id=c.id AND sf.facet_id=?)",
            );
        }
        sql.push(')');
    }
    if request.cursor.is_some() {
        if fts_query.is_some() {
            sql.push_str(" AND (fts.rank > ? OR (fts.rank = ? AND c.id < ?))");
        } else {
            sql.push_str(" AND c.id < ?");
        }
    }
    if fts_query.is_some() {
        sql.push_str(" ORDER BY fts.rank, c.id DESC LIMIT ?");
    } else {
        sql.push_str(" ORDER BY c.id DESC LIMIT ?");
    }

    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(fts_query.is_some());
    if let Some(fts_query) = &fts_query {
        q = q.bind(fts_query);
    }
    if let Some(tag) = &request.tag_id {
        q = q.bind(tag);
    }
    for family in &request.representation_families {
        for _ in 0..7 {
            q = q.bind(family);
        }
    }
    for facet_id in &request.facet_ids {
        q = q.bind(facet_id);
    }
    if let Some(cursor) = &request.cursor {
        let (rank_s, id) = cursor.split_once('|').context("invalid search cursor")?;
        if fts_query.is_some() {
            let rank: f64 = rank_s.parse()?;
            q = q.bind(rank).bind(rank).bind(id);
        } else {
            q = q.bind(id);
        }
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
        let rank: f64 = row.get(12);
        let snippet = fts_query
            .as_deref()
            .and_then(|query| build_snippet(query, row.get::<Option<String>, _>(9).as_deref()));
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
                primary_presentation_kind: row.get(10),
                thumbnail_asset_id: row.get(11),
                has_embedding: row.get::<i64, _>(13) != 0,
                ocr_status: row.get(14),
                tags,
            },
            snippet,
            rank,
            fts_match: fts_query.is_some(),
            semantic_match: None,
        });
        if has_more && index + 1 == limit as usize {
            next_cursor = Some(format!(
                "{rank}|{}",
                items.last().expect("just inserted").clip.id
            ));
        }
    }
    let requested_hybrid = !raw.is_empty()
        && match request.mode {
            Some(SearchMode::Fts) => false,
            Some(SearchMode::Hybrid) => true,
            None => crate::search::semantic::status(repo)
                .await
                .map(|status| status.active_space_id.is_some())
                .unwrap_or(false),
        };
    let mut diagnostic = None;
    let effective_mode = if requested_hybrid {
        match crate::search::semantic::hybrid_matches(repo, raw, (limit * 4).max(100) as usize)
            .await
        {
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
            mode: Some(SearchMode::Fts),
            representation_families: Vec::new(),
            facet_ids: Vec::new(),
        }
    }

    async fn capture(
        repo: &HistoryRepository,
        token: u64,
        representation: CapturedRepresentation,
    ) -> String {
        repo.capture(
            CapturedSnapshot {
                token,
                source_app_name: None,
                source_app_id: None,
                format_observations: Vec::new(),
                representations: vec![representation],
            },
            &CaptureSettings::default(),
        )
        .await
        .unwrap()
        .0
    }

    #[test]
    fn simple_query_uses_escaped_prefix_terms_with_implicit_and() {
        assert_eq!(to_simple_query("doc ref"), "\"doc\"* \"ref\"*");
        assert_eq!(to_simple_query("a\"b"), "\"ab\"*");
        assert_eq!(to_simple_query("\"\""), "");
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
        assert!(!file_results.items[0].fts_match);

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
        };
        assert!(search(&repo, &request("doc*"), &advanced)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.clip.id == text_id));
    }
}
