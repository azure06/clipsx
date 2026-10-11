//! One clipboard read service for the native assistant and external MCP clients.
use super::contracts::*;
use crate::{
    failure::{FailureCode, OperationFailure},
    history::HistoryRepository,
    search,
};
use anyhow::{Context, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use image::{GenericImageView, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::io::Cursor;

pub const SECRET_PREDICATE: &str = "NOT EXISTS(SELECT 1 FROM content_clip_facets secret WHERE secret.clip_id=c.id AND secret.facet_id='core.security.secret')";
const MAX_TEXT_PAGE: usize = 32 * 1024;
const DEFAULT_TEXT_PAGE: usize = 8 * 1024;
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct ClipboardService {
    pub(crate) history: HistoryRepository,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TextCursor {
    clip_id: String,
    representation_id: Option<String>,
    kind: TextKind,
    revision: String,
    fingerprint: String,
    offset: usize,
}

impl ClipboardService {
    pub fn new(history: HistoryRepository) -> Self {
        Self { history }
    }

    pub async fn require_eligible(&self, clip_id: &str) -> Result<()> {
        validate_id(clip_id)?;
        let sql = format!("SELECT EXISTS(SELECT 1 FROM clip_items c WHERE c.id=? AND c.lifecycle_state='ready' AND {SECRET_PREDICATE})");
        let eligible: bool = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .bind(clip_id)
            .fetch_one(&self.history.pool)
            .await?;
        if !eligible {
            return Err(FailureCode::InvalidInput.failure().into());
        }
        Ok(())
    }

    pub async fn status(&self) -> Result<ClipboardStatus> {
        let keyword_ready: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='search_documents_fts')",
        )
        .fetch_one(&self.history.pool)
        .await?;
        let active_index: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM search_index_generations WHERE status='active')",
        )
        .fetch_one(&self.history.pool)
        .await?;
        let provider = search::semantic::status(&self.history).await?;
        let semantic_ready = active_index
            && matches!(
                provider.phase,
                search::semantic::ProviderPhase::Ready | search::semantic::ProviderPhase::Indexing
            );
        Ok(ClipboardStatus {
            api_version: 1,
            now: crate::history::now_ms() as f64,
            timezone: iana_time_zone::get_timezone().ok(),
            keyword_ready,
            semantic_ready,
            tools: [
                "get_clipboard_status",
                "list_clipboard_filters",
                "search_clips",
                "read_clip",
                "read_clip_image",
                "create_clip",
                "organize_clips",
                "undo_clipboard_action",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
            result_limit: 50,
            organization_limit: 50,
            default_text_page_bytes: DEFAULT_TEXT_PAGE as u32,
            max_text_page_bytes: MAX_TEXT_PAGE as u32,
            max_image_bytes: MAX_IMAGE_BYTES as u32,
        })
    }

    pub async fn filters(&self) -> Result<ClipboardFilters> {
        let tag_sql = format!("SELECT DISTINCT t.id,t.name FROM catalog_tags t JOIN catalog_clip_tags ct ON ct.tag_id=t.id JOIN clip_items c ON c.id=ct.clip_id WHERE c.lifecycle_state='ready' AND {SECRET_PREDICATE} ORDER BY t.name,t.id LIMIT 501");
        let app_sql = format!("SELECT DISTINCT COALESCE(c.source_app_id,c.source_app_name),COALESCE(c.source_app_name,c.source_app_id) FROM clip_items c WHERE c.lifecycle_state='ready' AND COALESCE(c.source_app_id,c.source_app_name) IS NOT NULL AND {SECRET_PREDICATE} ORDER BY 2,1 LIMIT 501");
        let facet_sql = format!("SELECT DISTINCT f.facet_id FROM content_clip_facets f JOIN clip_items c ON c.id=f.clip_id WHERE c.lifecycle_state='ready' AND {SECRET_PREDICATE} ORDER BY f.facet_id LIMIT 501");
        let tags = sqlx::query(sqlx::AssertSqlSafe(tag_sql))
            .fetch_all(&self.history.pool)
            .await?;
        let apps = sqlx::query(sqlx::AssertSqlSafe(app_sql))
            .fetch_all(&self.history.pool)
            .await?;
        let facets: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(facet_sql))
            .fetch_all(&self.history.pool)
            .await?;
        let bounded = tags.len() > 500 || apps.len() > 500 || facets.len() > 500;
        Ok(ClipboardFilters {
            api_version: 1,
            tags: tags
                .into_iter()
                .take(500)
                .map(|r| ClipTag {
                    id: r.get(0),
                    name: bounded_string(&r.get::<String, _>(1), 512),
                })
                .collect(),
            source_applications: apps
                .into_iter()
                .take(500)
                .map(|r| SourceApplication {
                    id: bounded_string(&r.get::<String, _>(0), 512),
                    name: bounded_string(&r.get::<String, _>(1), 512),
                })
                .collect(),
            facet_ids: facets
                .into_iter()
                .take(500)
                .map(|v| bounded_string(&v, 512))
                .collect(),
            representation_families: [
                "text", "image", "files", "html", "rtf", "office", "document",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
            warnings: if bounded {
                vec![warning(WarningCode::FiltersBounded)]
            } else {
                vec![]
            },
        })
    }

    pub async fn metadata(&self, clip_id: &str) -> Result<ClipMetadata> {
        let mut connection = self.history.pool.acquire().await?;
        self.metadata_in(&mut connection, clip_id).await
    }

    pub(crate) async fn metadata_in(
        &self,
        connection: &mut sqlx::SqliteConnection,
        clip_id: &str,
    ) -> Result<ClipMetadata> {
        require_eligible_in(connection, clip_id).await?;
        let row = sqlx::query("SELECT capture_sha256,captured_at,source_app_id,source_app_name,is_favorite,is_pinned,note,assistant_revision FROM clip_items WHERE id=? AND lifecycle_state='ready'").bind(clip_id).fetch_one(&mut *connection).await?;
        let tags: Vec<crate::history::Tag> = sqlx::query("SELECT t.id,t.name,t.color FROM catalog_tags t JOIN catalog_clip_tags ct ON ct.tag_id=t.id WHERE ct.clip_id=? ORDER BY t.name,t.id LIMIT 65").bind(clip_id).fetch_all(&mut *connection).await?.into_iter().map(|r| crate::history::Tag { id:r.get(0), name:r.get(1), color:r.get(2) }).collect();
        let representations = sqlx::query("SELECT r.id,r.canonical_mime_type,r.format_family,r.storage_kind,COALESCE(t.utf8_byte_length,b.byte_length,0),COALESCE(t.sha256,b.sha256,'') FROM clip_representations r LEFT JOIN clip_text_values t ON t.representation_id=r.id LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id AND b.lifecycle_state='ready' WHERE r.clip_id=? AND r.lifecycle_state='ready' ORDER BY r.capture_priority,r.ordinal,r.id LIMIT 65").bind(clip_id).fetch_all(&mut *connection).await?;
        if tags.len() > 64 || representations.len() > 64 {
            return Err(FailureCode::ResourceLimit.failure().into());
        }
        let revision = crate::history::sha256(
            serde_json::to_vec(&(
                clip_id,
                row.get::<i64, _>(7),
                row.get::<String, _>(0),
                row.get::<i64, _>(1),
                row.get::<Option<String>, _>(2),
                row.get::<Option<String>, _>(3),
                row.get::<bool, _>(4),
                row.get::<bool, _>(5),
                row.get::<Option<String>, _>(6),
                &tags,
                representations
                    .iter()
                    .map(|r| (r.get::<String, _>(0), r.get::<String, _>(5)))
                    .collect::<Vec<_>>(),
            ))?
            .as_slice(),
        );
        let ocr_status: Option<String> = sqlx::query_scalar("SELECT j.status FROM artifact_jobs j JOIN clip_representations r ON r.id=j.target_representation_id WHERE r.clip_id=? AND j.artifact_kind='ocr' AND j.producer_id='builtin.artifact.ocr' AND j.producer_version='3' ORDER BY j.requested_at DESC LIMIT 1").bind(clip_id).fetch_optional(&mut *connection).await?;
        require_eligible_in(connection, clip_id).await?;
        Ok(ClipMetadata {
            id: clip_id.into(),
            revision,
            captured_at: row.get::<i64, _>(1) as f64,
            source_app_id: row
                .get::<Option<String>, _>(2)
                .map(|v| bounded_string(&v, 512)),
            source_app_name: row
                .get::<Option<String>, _>(3)
                .map(|v| bounded_string(&v, 512)),
            favorite: row.get(4),
            pinned: row.get(5),
            tags: tags
                .into_iter()
                .map(|t| ClipTag {
                    id: t.id,
                    name: bounded_string(&t.name, 512),
                })
                .collect(),
            representations: representations
                .into_iter()
                .map(|r| {
                    let mime: Option<String> = r.get(1);
                    let image_available =
                        matches!(mime.as_deref(), Some("image/png" | "image/jpeg"))
                            && r.get::<String, _>(3) == "binary_asset";
                    RepresentationDescriptor {
                        id: r.get(0),
                        mime_type: mime,
                        family: r.get(2),
                        storage_kind: r.get(3),
                        byte_length: r.get::<i64, _>(4).clamp(0, u32::MAX as i64) as u32,
                        fingerprint: r.get(5),
                        image_available,
                    }
                })
                .collect(),
            ocr_status: ocr_status.unwrap_or_else(|| "unavailable".into()),
        })
    }

    pub async fn search(&self, request: ClipSearchRequest) -> Result<ClipSearchResult> {
        if request.query.len() > 8 * 1024
            || request.cursor.as_ref().is_some_and(|v| v.len() > 4096)
            || request.limit.is_some_and(|v| v == 0 || v > 50)
        {
            return Err(FailureCode::InvalidParameters.failure().into());
        }
        let filters = request.filters.unwrap_or_default();
        validate_filters(&filters)?;
        let hybrid = request.mode.unwrap_or_default() == RetrievalMode::Hybrid;
        let native = search::SearchRequest {
            query: request.query,
            scope: filters.scope,
            tag_id: filters.tag_id,
            limit: Some(request.limit.unwrap_or(20)),
            cursor: request.cursor,
            enabled_source_ids: if hybrid {
                vec![
                    search::FTS_SOURCE_ID.into(),
                    search::SEMANTIC_TEXT_SOURCE_ID.into(),
                ]
            } else {
                vec![search::FTS_SOURCE_ID.into()]
            },
            representation_families: filters.representation_families,
            facet_ids: filters.facet_ids,
            eligibility: search::SearchEligibility {
                captured_after: filters.captured_after,
                captured_before: filters.captured_before,
                source_app_ids: filters.source_app_ids,
                excluded_clip_ids: filters.excluded_clip_ids,
                assistant: true,
            },
        };
        let settings = search::SearchSettings {
            syntax_mode: search::SyntaxMode::Simple,
            enabled_source_ids: native.enabled_source_ids.clone(),
        };
        let page = search::search(&self.history, &native, &settings).await?;
        let mut warnings = Vec::new();
        let mut items = Vec::new();
        for result in page.items {
            match self.metadata(&result.clip.id).await {
                Ok(clip) => items.push(ClipMatch {
                    clip,
                    snippet: result.snippet.map(|v| bounded_string(&v, 1024)),
                    rank: result.rank,
                    sources: result.matches.into_iter().map(|m| m.source_id).collect(),
                }),
                Err(_) => warnings.push(warning(WarningCode::SourceChanged)),
            }
        }
        let semantic_used = page.source_outcomes.iter().any(|v| {
            v.source_id == search::SEMANTIC_TEXT_SOURCE_ID
                && v.status == search::SearchSourceOutcomeStatus::Used
        });
        // Semantic routing is approximate even when its shortlist is fully consumed.
        let exhaustive = page.is_exhaustive
            && !semantic_used
            && warnings.is_empty()
            && !page
                .source_outcomes
                .iter()
                .any(|v| v.status == search::SearchSourceOutcomeStatus::Unavailable);
        if !exhaustive {
            warnings.push(warning(WarningCode::RetrievalIncomplete));
        }
        Ok(ClipSearchResult {
            api_version: 1,
            items,
            next_cursor: page.next_cursor,
            exhaustive,
            source_outcomes: page
                .source_outcomes
                .into_iter()
                .map(|v| RetrievalOutcome {
                    source: v.source_id,
                    status: if v.status == search::SearchSourceOutcomeStatus::Used {
                        "used"
                    } else {
                        "unavailable"
                    }
                    .into(),
                })
                .collect(),
            warnings,
        })
    }

    pub async fn read(&self, request: ClipReadRequest) -> Result<ClipReadResult> {
        let clip = self.metadata(&request.clip_id).await?;
        let kind = request.kind.unwrap_or_default();
        let page_bytes = request.page_bytes.unwrap_or(DEFAULT_TEXT_PAGE as u32) as usize;
        if page_bytes == 0
            || page_bytes > MAX_TEXT_PAGE
            || request.cursor.as_ref().is_some_and(|v| v.len() > 4096)
        {
            return Err(FailureCode::InvalidParameters.failure().into());
        }
        if let Some(id) = &request.representation_id {
            validate_id(id)?;
            if kind == TextKind::Note
                || !clip
                    .representations
                    .iter()
                    .any(|representation| &representation.id == id)
            {
                return Err(FailureCode::InvalidInput.failure().into());
            }
        }
        let previous: Option<TextCursor> = request
            .cursor
            .as_ref()
            .map(|v| -> Result<_> { Ok(serde_json::from_slice(&URL_SAFE_NO_PAD.decode(v)?)?) })
            .transpose()?;
        let offset = previous.as_ref().map_or(0, |v| v.offset);
        if offset >= i64::MAX as usize {
            return Err(FailureCode::InvalidParameters.failure().into());
        }
        if let Some(previous) = &previous {
            if previous.clip_id != request.clip_id
                || previous.kind != kind
                || previous.revision != clip.revision
                || request
                    .representation_id
                    .as_ref()
                    .is_some_and(|v| previous.representation_id.as_ref() != Some(v))
            {
                return Err(FailureCode::StaleContext.failure().into());
            }
        }
        let requested_representation = request
            .representation_id
            .or_else(|| previous.as_ref().and_then(|v| v.representation_id.clone()));
        let (representation_id, row) = match kind {
            TextKind::Note => (None, sqlx::query("SELECT length(CAST(COALESCE(note,'') AS BLOB)),substr(CAST(COALESCE(note,'') AS BLOB),?,?),NULL FROM clip_items WHERE id=? AND lifecycle_state='ready'").bind(offset as i64+1).bind(page_bytes as i64+4).bind(&request.clip_id).fetch_optional(&self.history.pool).await?),
            TextKind::Captured => {
                let id = requested_representation.or_else(|| clip.representations.iter().find(|v| v.storage_kind=="text").map(|v| v.id.clone()));
                let row = if let Some(id) = &id { sqlx::query("SELECT t.utf8_byte_length,substr(CAST(t.text_value AS BLOB),?,?),t.sha256 FROM clip_text_values t JOIN clip_representations r ON r.id=t.representation_id WHERE r.id=? AND r.clip_id=? AND r.lifecycle_state='ready'").bind(offset as i64+1).bind(page_bytes as i64+4).bind(id).bind(&request.clip_id).fetch_optional(&self.history.pool).await? } else { None };
                (id, row)
            },
            TextKind::Ocr => {
                let id = requested_representation.or_else(|| clip.representations.iter().find(|v| v.mime_type.as_ref().is_some_and(|mime| mime.starts_with("image/"))).map(|v| v.id.clone()));
                let row = if let Some(id) = &id { sqlx::query("SELECT t.utf8_byte_length,substr(CAST(t.text_value AS BLOB),?,?),t.sha256 FROM artifact_records a JOIN artifact_inputs ai ON ai.artifact_id=a.id JOIN artifact_text_values t ON t.artifact_id=a.id JOIN clip_representations r ON r.id=ai.representation_id JOIN clip_binary_files b ON b.id=r.binary_file_id WHERE a.owner_clip_id=? AND r.clip_id=? AND r.id=? AND r.lifecycle_state='ready' AND b.lifecycle_state='ready' AND ai.input_sha256=b.sha256 AND a.lifecycle_state='ready' AND a.producer_id='builtin.artifact.ocr' AND a.producer_version='3' ORDER BY a.created_at DESC,a.id DESC LIMIT 1").bind(offset as i64+1).bind(page_bytes as i64+4).bind(&request.clip_id).bind(&request.clip_id).bind(id).fetch_optional(&self.history.pool).await? } else { None };
                (id,row)
            },
        };
        let mut warnings = Vec::new();
        let (text, total_bytes, text_fingerprint, next_cursor) = if let Some(row) = row {
            let total = row.get::<i64, _>(0).max(0) as usize;
            if offset > total || offset > i64::MAX as usize {
                return Err(FailureCode::InvalidParameters.failure().into());
            }
            let bytes: Vec<u8> = row.get(1);
            let text = page_utf8(&bytes, page_bytes)?;
            let fingerprint: String = row
                .get::<Option<String>, _>(2)
                .unwrap_or_else(|| clip.revision.clone());
            if previous.as_ref().is_some_and(|v| {
                v.fingerprint != fingerprint || v.representation_id != representation_id
            }) {
                return Err(FailureCode::StaleContext.failure().into());
            }
            let next = offset + text.len();
            let cursor = if next < total {
                Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&TextCursor {
                    clip_id: request.clip_id.clone(),
                    representation_id: representation_id.clone(),
                    kind,
                    revision: clip.revision.clone(),
                    fingerprint: fingerprint.clone(),
                    offset: next,
                })?))
            } else {
                None
            };
            (
                text,
                total.min(u32::MAX as usize) as u32,
                Some(fingerprint),
                cursor,
            )
        } else {
            if previous.is_some() {
                return Err(FailureCode::StaleContext.failure().into());
            }
            warnings.push(warning(
                if kind == TextKind::Ocr
                    && matches!(clip.ocr_status.as_str(), "pending" | "running")
                {
                    WarningCode::OcrPending
                } else {
                    WarningCode::TextUnavailable
                },
            ));
            (String::new(), 0, None, None)
        };
        self.require_eligible(&request.clip_id).await?;
        if self.metadata(&request.clip_id).await?.revision != clip.revision {
            return Err(FailureCode::StaleContext.failure().into());
        }
        Ok(ClipReadResult {
            api_version: 1,
            clip,
            representation_id,
            kind,
            text,
            text_fingerprint,
            total_bytes,
            next_cursor,
            warnings,
        })
    }

    pub async fn image(&self, request: ClipImageRequest) -> Result<ClipImageResult> {
        let clip = self.metadata(&request.clip_id).await?;
        validate_id(&request.representation_id)?;
        let representation = clip
            .representations
            .iter()
            .find(|v| v.id == request.representation_id && v.image_available)
            .context(FailureCode::UnsupportedInput.failure())?;
        let binary_id: String = sqlx::query_scalar("SELECT binary_file_id FROM clip_representations WHERE id=? AND clip_id=? AND lifecycle_state='ready'").bind(&request.representation_id).bind(&request.clip_id).fetch_one(&self.history.pool).await?;
        let (bytes, mime) = self
            .history
            .bounded_asset(&binary_id, 64 * 1024 * 1024)
            .await?;
        let fingerprint = crate::history::sha256(&bytes);
        if fingerprint != representation.fingerprint {
            return Err(FailureCode::StaleContext.failure().into());
        }
        let preview =
            tauri::async_runtime::spawn_blocking(move || image_preview(&bytes, &mime)).await??;
        self.require_eligible(&request.clip_id).await?;
        if self.metadata(&request.clip_id).await?.revision != clip.revision {
            return Err(FailureCode::StaleContext.failure().into());
        }
        Ok(ClipImageResult {
            api_version: 1,
            clip_id: request.clip_id,
            representation_id: request.representation_id,
            revision: clip.revision,
            source_fingerprint: fingerprint,
            mime_type: "image/png".into(),
            data: STANDARD.encode(preview.bytes),
            original_width: preview.original_width,
            original_height: preview.original_height,
            width: preview.width,
            height: preview.height,
            resized: preview.width != preview.original_width
                || preview.height != preview.original_height,
        })
    }
}

pub fn public_failure(error: anyhow::Error) -> OperationFailure {
    OperationFailure::from_error(&error)
}
pub fn validate_id(id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| FailureCode::InvalidParameters.failure().into())
}
pub fn bounded_string(value: &str, bytes: usize) -> String {
    let mut end = value.len().min(bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}
fn warning(code: WarningCode) -> ClipboardWarning {
    ClipboardWarning { code }
}
fn validate_filters(filters: &ClipFilters) -> Result<()> {
    if filters
        .scope
        .as_ref()
        .is_some_and(|v| !matches!(v.as_str(), "all" | "favorites" | "pinned"))
        || filters.source_app_ids.len() > 50
        || filters.excluded_clip_ids.len() > 256
        || filters.facet_ids.len() > 50
        || filters.representation_families.len() > 50
        || filters
            .source_app_ids
            .iter()
            .chain(filters.facet_ids.iter())
            .any(|v| v.is_empty() || v.len() > 512)
    {
        return Err(FailureCode::InvalidParameters.failure().into());
    }
    for id in &filters.excluded_clip_ids {
        validate_id(id)?;
    }
    if let Some(id) = &filters.tag_id {
        validate_id(id)?;
    }
    Ok(())
}
fn page_utf8(bytes: &[u8], limit: usize) -> Result<String> {
    let candidate = &bytes[..bytes.len().min(limit)];
    match std::str::from_utf8(candidate) {
        Ok(text) => Ok(text.to_string()),
        Err(error) if error.error_len().is_none() && error.valid_up_to() > 0 => {
            Ok(std::str::from_utf8(&candidate[..error.valid_up_to()])?.to_string())
        }
        _ => Err(FailureCode::InvalidParameters.failure().into()),
    }
}
struct ImagePreview {
    bytes: Vec<u8>,
    original_width: u32,
    original_height: u32,
    width: u32,
    height: u32,
}
fn image_preview(bytes: &[u8], mime: &str) -> Result<ImagePreview> {
    let format = match mime {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        _ => return Err(FailureCode::UnsupportedInput.failure().into()),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(64 * 1024 * 1024);
    limits.max_image_width = Some(32768);
    limits.max_image_height = Some(32768);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| FailureCode::ResourceLimit.failure())?;
    let (original_width, original_height) = image.dimensions();
    let mut edge = 2048;
    loop {
        let preview = image.thumbnail(edge, edge);
        let (width, height) = preview.dimensions();
        let mut encoded = Cursor::new(Vec::new());
        preview.write_to(&mut encoded, ImageFormat::Png)?;
        let bytes = encoded.into_inner();
        if bytes.len().div_ceil(3) * 4 <= MAX_IMAGE_BYTES {
            return Ok(ImagePreview {
                bytes,
                original_width,
                original_height,
                width,
                height,
            });
        }
        if edge <= 128 {
            return Err(FailureCode::ResourceLimit.failure().into());
        }
        edge = edge * 3 / 4;
    }
}

pub(crate) async fn require_eligible_in(
    connection: &mut sqlx::SqliteConnection,
    clip_id: &str,
) -> Result<()> {
    validate_id(clip_id)?;
    let sql=format!("SELECT EXISTS(SELECT 1 FROM clip_items c WHERE c.id=? AND c.lifecycle_state='ready' AND {SECRET_PREDICATE})");
    let eligible: bool = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(clip_id)
        .fetch_one(connection)
        .await?;
    if !eligible {
        return Err(FailureCode::InvalidInput.failure().into());
    }
    Ok(())
}
