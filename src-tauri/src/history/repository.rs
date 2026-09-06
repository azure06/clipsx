use super::domain::*;
use super::preview::{resolve_history_preview, PreviewContext};
use crate::clipboard::capabilities;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqlitePoolOptions, AssertSqlSafe, QueryBuilder, Row, Sqlite, SqlitePool};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const CAPTURE_FINGERPRINT_VERSION: &str = "clipsx-capture-v1";

const SUMMARY_SELECT: &str = "SELECT c.id,c.source_app_name,c.source_app_id,c.captured_at,c.updated_at,c.is_pinned,c.is_favorite,c.note,(SELECT count(*) FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready'),(SELECT substr(t.text_value,1,500) FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id WHERE r.clip_id=c.id AND r.lifecycle_state='ready' ORDER BY r.capture_priority,r.ordinal LIMIT 1),COALESCE((SELECT CASE WHEN r.storage_kind='file_list' THEN 'files' WHEN r.canonical_mime_type LIKE 'image/%' THEN 'image' WHEN r.canonical_mime_type='text/html' THEN 'html' WHEN r.canonical_mime_type IN ('text/rtf','application/rtf') THEN 'rich_text' WHEN r.canonical_mime_type IN ('application/pdf','image/svg+xml') THEN 'document' WHEN r.format_family='office' THEN 'office' WHEN r.storage_kind='text' THEN 'text' ELSE 'unsupported' END FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready' ORDER BY r.capture_priority,r.ordinal LIMIT 1),'unsupported'),(SELECT r.binary_file_id FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready' AND r.canonical_mime_type LIKE 'image/%' ORDER BY r.capture_priority,r.ordinal LIMIT 1),EXISTS(SELECT 1 FROM search_index_jobs j JOIN search_index_generations g ON g.id=j.generation_id WHERE j.clip_id=c.id AND j.status='completed' AND g.status='active'),(SELECT aj.status FROM artifact_jobs aj JOIN clip_representations cr ON cr.id=aj.target_representation_id WHERE cr.clip_id=c.id AND aj.artifact_kind='ocr' AND aj.producer_id='builtin.artifact.ocr' AND aj.producer_version='3' ORDER BY aj.requested_at DESC LIMIT 1),lead.id,lead.canonical_mime_type,lead.format_family,(SELECT substr(t.text_value,1,500) FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id WHERE r.clip_id=c.id AND r.lifecycle_state='ready' AND r.canonical_mime_type='text/plain' ORDER BY r.capture_priority,r.ordinal LIMIT 1),EXISTS(SELECT 1 FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready' AND r.storage_kind='text' AND r.canonical_mime_type='text/plain'),EXISTS(SELECT 1 FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready' AND (r.storage_kind='file_list' OR r.storage_kind='text' OR r.canonical_mime_type LIKE 'image/%' OR r.canonical_mime_type IN ('application/pdf','image/svg+xml','text/html','text/rtf','application/rtf') OR r.format_family='office')) FROM clip_items c LEFT JOIN (SELECT r1.clip_id AS clip_id,r1.id AS id,r1.canonical_mime_type AS canonical_mime_type,r1.format_family AS format_family FROM clip_representations r1 WHERE r1.lifecycle_state='ready' AND r1.id=(SELECT r2.id FROM clip_representations r2 WHERE r2.clip_id=r1.clip_id AND r2.lifecycle_state='ready' ORDER BY r2.capture_priority,r2.ordinal LIMIT 1)) lead ON lead.clip_id=c.id";

#[derive(Clone)]
pub struct HistoryRepository {
    pub pool: SqlitePool,
    pub managed_root: PathBuf,
    pub semantic_index_root: PathBuf,
}

#[derive(Default)]
struct PreviewHydration {
    ocr_text: Option<String>,
    file: (Option<String>, i64),
    facet: (Option<String>, Option<String>),
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}
pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn capture_fingerprint(representations: &[CapturedRepresentation]) -> String {
    let mut ordered: Vec<_> = representations.iter().collect();
    ordered.sort_by_key(|r| {
        (
            r.capture_priority,
            r.format_key.clone(),
            r.native_type.clone(),
        )
    });
    let mut h = Sha256::new();
    h.update(CAPTURE_FINGERPRINT_VERSION.as_bytes());
    h.update([0]);
    for r in ordered {
        for value in [
            &r.platform,
            &r.format_key,
            r.canonical_mime_type.as_deref().unwrap_or(""),
            r.native_type.as_deref().unwrap_or(""),
        ] {
            h.update(value.as_bytes());
            h.update([0]);
        }
        match &r.payload {
            CapturedPayload::Text(v) => {
                h.update(b"text\0");
                h.update(sha256(v.as_bytes()).as_bytes())
            }
            CapturedPayload::Binary(v) => {
                h.update(b"binary_asset\0");
                h.update(sha256(v).as_bytes())
            }
            CapturedPayload::Files(v) => {
                h.update(b"file_list\0");
                for item in v {
                    h.update(item.as_bytes());
                    h.update([0]);
                }
            }
        };
        h.update([0]);
    }
    format!("{:x}", h.finalize())
}

impl HistoryRepository {
    pub async fn connect(database: &Path, managed_root: PathBuf) -> Result<Self> {
        let started = Instant::now();
        fs::create_dir_all(&managed_root)?;
        let semantic_index_root = database
            .parent()
            .context("database must have an application data directory")?
            .join("search-index");
        let url = format!("sqlite://{}?mode=rwc", database.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await?;
        let repository = Self {
            pool,
            managed_root,
            semantic_index_root,
        };
        repository.recover_managed_files().await?;
        log_history_timing("repository-open", started, 0, 250);
        Ok(repository)
    }
    pub async fn capture(
        &self,
        snapshot: CapturedSnapshot,
        settings: &CaptureSettings,
    ) -> Result<(String, bool)> {
        self.capture_inner(snapshot, settings, false).await
    }
    /// Explicitly saved transformation output is deliberately distinct even if
    /// the produced bytes already exist in history.
    pub async fn capture_forced(
        &self,
        snapshot: CapturedSnapshot,
        settings: &CaptureSettings,
        provenance: &TransformProvenance,
    ) -> Result<String> {
        let source: (String, String, Option<String>) = sqlx::query_as(
            "SELECT c.capture_sha256,r.format_key,r.canonical_mime_type \
             FROM clip_items c JOIN clip_representations r ON r.clip_id=c.id \
             WHERE c.id=? AND r.id=? AND c.lifecycle_state='ready' AND r.lifecycle_state='ready'",
        )
        .bind(&provenance.source_clip_id)
        .bind(&provenance.source_representation_id)
        .fetch_one(&self.pool)
        .await?;
        let (id, _) = self.capture_inner(snapshot, settings, true).await?;
        sqlx::query("INSERT INTO clip_transform_provenance(clip_id,source_clip_id,source_representation_id,source_capture_sha256,source_format_key,source_mime_type,transformer_id,transformer_version,parameter_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .bind(&id)
            .bind(&provenance.source_clip_id)
            .bind(&provenance.source_representation_id)
            .bind(source.0)
            .bind(source.1)
            .bind(source.2)
            .bind(&provenance.transformer_id)
            .bind(&provenance.transformer_version)
            .bind(&provenance.parameter_sha256)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        Ok(id)
    }
    async fn capture_inner(
        &self,
        snapshot: CapturedSnapshot,
        settings: &CaptureSettings,
        force_new: bool,
    ) -> Result<(String, bool)> {
        let _platform_token = snapshot.token;
        if snapshot.representations.is_empty() {
            bail!("empty snapshot")
        }
        let total: u64 = snapshot.representations.iter().map(payload_len).sum();
        if settings.max_snapshot_bytes.is_some_and(|max| total > max) {
            bail!("snapshot exceeds configured limit")
        }
        if snapshot.representations.iter().any(|r| {
            settings
                .max_representation_bytes
                .is_some_and(|max| payload_len(r) > max)
        }) {
            bail!("representation exceeds configured limit")
        }
        let fingerprint = capture_fingerprint(&snapshot.representations);
        let now = now_ms();
        let mut tx = self.pool.begin().await?;
        if !force_new {
            if let Some(row) = sqlx::query(
                "SELECT id FROM clip_items WHERE capture_sha256=? AND lifecycle_state='ready'",
            )
            .bind(&fingerprint)
            .fetch_optional(&mut *tx)
            .await?
            {
                let id: String = row.get(0);
                sqlx::query("UPDATE clip_items SET captured_at=?, updated_at=?, source_app_name=?, source_app_id=? WHERE id=?").bind(now).bind(now).bind(snapshot.source_app_name).bind(snapshot.source_app_id).bind(&id).execute(&mut *tx).await?;
                replace_format_observations(&mut tx, &id, &snapshot.format_observations).await?;
                tx.commit().await?;
                return Ok((id, true));
            }
        }
        let id = new_id();
        sqlx::query("INSERT INTO clip_items(id,source_app_name,source_app_id,captured_at,updated_at,lifecycle_state,capture_sha256,total_payload_bytes) VALUES(?,?,?,?,?,'pending',?,?)").bind(&id).bind(snapshot.source_app_name).bind(snapshot.source_app_id).bind(now).bind(now).bind(&fingerprint).bind(total as i64).execute(&mut *tx).await?;
        for (ordinal, rep) in snapshot.representations.iter().enumerate() {
            self.insert_representation(&mut tx, &id, ordinal as i64, rep, now)
                .await?;
        }
        replace_format_observations(&mut tx, &id, &snapshot.format_observations).await?;
        sqlx::query("UPDATE clip_items SET lifecycle_state='ready' WHERE id=?")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.enforce_retention(settings).await?;
        Ok((id, false))
    }
    async fn insert_representation(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        clip_id: &str,
        ordinal: i64,
        rep: &CapturedRepresentation,
        now: i64,
    ) -> Result<()> {
        let id = new_id();
        let (capability_id, format_family) = representation_capability(rep);
        let (kind, binary_id) = match &rep.payload {
            CapturedPayload::Text(value) => {
                sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,native_type,capability_id,format_family,platform,storage_kind,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'text',?,?, 'pending',?,?)").bind(&id).bind(clip_id).bind(&rep.format_key).bind(&rep.canonical_mime_type).bind(&rep.native_type).bind(&capability_id).bind(&format_family).bind(&rep.platform).bind(ordinal).bind(rep.capture_priority).bind(now).bind(now).execute(&mut **tx).await?;
                sqlx::query("INSERT INTO clip_text_values(representation_id,text_value,utf8_byte_length,sha256) VALUES(?,?,?,?)").bind(&id).bind(value).bind(value.len() as i64).bind(sha256(value.as_bytes())).execute(&mut **tx).await?;
                ("text", None)
            }
            CapturedPayload::Files(files) => {
                sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,native_type,capability_id,format_family,platform,storage_kind,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'file_list',?,?, 'pending',?,?)").bind(&id).bind(clip_id).bind(&rep.format_key).bind(&rep.canonical_mime_type).bind(&rep.native_type).bind(&capability_id).bind(&format_family).bind(&rep.platform).bind(ordinal).bind(rep.capture_priority).bind(now).bind(now).execute(&mut **tx).await?;
                for (index, value) in files.iter().enumerate() {
                    sqlx::query("INSERT INTO clip_file_list_entries(representation_id,ordinal,file_reference) VALUES(?,?,?)").bind(&id).bind(index as i64).bind(value).execute(&mut **tx).await?;
                }
                ("file_list", None)
            }
            CapturedPayload::Binary(bytes) => {
                let hash = sha256(bytes);
                let relative = PathBuf::from("managed")
                    .join("binary")
                    .join(&hash[..2])
                    .join(&hash);
                let full = self.managed_root.join(&relative);
                if !full.exists() {
                    fs::create_dir_all(full.parent().unwrap())?;
                    let temporary = self.managed_root.join("staging").join(format!(
                        "{}.{}.pending",
                        hash,
                        new_id()
                    ));
                    fs::create_dir_all(temporary.parent().unwrap())?;
                    let mut staged = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&temporary)?;
                    staged.write_all(bytes)?;
                    staged.sync_all()?;
                    drop(staged);
                    fs::rename(temporary, &full)?;
                    if let Some(parent) = full.parent() {
                        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
                    }
                }
                let binary_id = new_id();
                sqlx::query("INSERT INTO clip_binary_files(id,sha256,byte_length,relative_path,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?, 'ready',?,?) ON CONFLICT(sha256) DO NOTHING").bind(&binary_id).bind(&hash).bind(bytes.len() as i64).bind(relative.to_string_lossy().replace('\\', "/")).bind(now).bind(now).execute(&mut **tx).await?;
                let actual: String =
                    sqlx::query_scalar("SELECT id FROM clip_binary_files WHERE sha256=?")
                        .bind(&hash)
                        .fetch_one(&mut **tx)
                        .await?;
                sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,native_type,capability_id,format_family,platform,storage_kind,binary_file_id,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'binary_asset',?,?,?, 'pending',?,?)").bind(&id).bind(clip_id).bind(&rep.format_key).bind(&rep.canonical_mime_type).bind(&rep.native_type).bind(&capability_id).bind(&format_family).bind(&rep.platform).bind(&actual).bind(ordinal).bind(rep.capture_priority).bind(now).bind(now).execute(&mut **tx).await?;
                ("binary_asset", Some(actual))
            }
        };
        let _ = (kind, binary_id);
        sqlx::query("UPDATE clip_representations SET lifecycle_state='ready' WHERE id=?")
            .bind(&id)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }
    pub async fn list(&self, request: ListRequest) -> Result<ClipPage> {
        let started = Instant::now();
        let limit = request.limit.unwrap_or(50).clamp(1, 100) as i64;
        let scope = request.scope.unwrap_or_else(|| "all".into());
        let mut query = format!("{SUMMARY_SELECT} WHERE c.lifecycle_state='ready'");
        if scope == "favorites" {
            query.push_str(" AND c.is_favorite=1")
        }
        if scope == "pinned" {
            query.push_str(" AND c.is_pinned=1")
        }
        if request.tag_id.is_some() {
            query.push_str(" AND EXISTS(SELECT 1 FROM catalog_clip_tags ct WHERE ct.clip_id=c.id AND ct.tag_id=?)")
        }
        if request.cursor.is_some() {
            query.push_str(" AND (c.captured_at < ? OR (c.captured_at = ? AND c.id < ?))")
        }
        query.push_str(" ORDER BY c.captured_at DESC,c.id DESC LIMIT ?");
        // This statement is assembled only from fixed clauses below; all user data remains bound.
        let mut q = sqlx::query(AssertSqlSafe(query));
        if let Some(tag) = &request.tag_id {
            q = q.bind(tag)
        }
        if let Some(cursor) = &request.cursor {
            let (time, id) = cursor.split_once('|').context("invalid cursor")?;
            let time: i64 = time.parse()?;
            q = q.bind(time).bind(time).bind(id);
        }
        let rows = q.bind(limit + 1).fetch_all(&self.pool).await?;
        let has_more = rows.len() as i64 > limit;
        let rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
        let items = self.hydrate_summary_rows(rows).await?;
        let next_cursor = if has_more {
            items.last().map(|x| format!("{}|{}", x.captured_at, x.id))
        } else {
            None
        };
        log_history_timing("history-list", started, items.len(), 100);
        Ok(ClipPage { items, next_cursor })
    }

    async fn hydrate_summary_rows(
        &self,
        rows: Vec<sqlx::sqlite::SqliteRow>,
    ) -> Result<Vec<ClipSummary>> {
        let ids = rows
            .iter()
            .map(|row| row.get::<String, _>(0))
            .collect::<Vec<_>>();
        let ocr_clip_ids = rows
            .iter()
            .filter(|row| {
                let kind = row.get::<String, _>(10);
                (kind == "image"
                    || (kind == "office" && row.get::<Option<String>, _>(11).is_some()))
                    && row.get::<Option<String>, _>(13).as_deref() == Some("completed")
            })
            .map(|row| row.get::<String, _>(0))
            .collect::<Vec<_>>();
        let file_representation_ids = rows
            .iter()
            .filter(|row| row.get::<String, _>(10) == "files")
            .filter_map(|row| row.get::<Option<String>, _>(14))
            .collect::<Vec<_>>();
        let facet_representation_ids = rows
            .iter()
            .filter(|row| matches!(row.get::<String, _>(10).as_str(), "text" | "html"))
            .filter_map(|row| row.get::<Option<String>, _>(14))
            .collect::<Vec<_>>();
        let (mut tags, mut presentations, mut ocr, mut files, mut facets) = tokio::try_join!(
            self.tags_for_many(&ids),
            self.compact_presentations_for_many(&ids),
            self.ocr_text_for_many(&ocr_clip_ids),
            self.leading_file_entries_for_many(&file_representation_ids),
            self.leading_facets_for_many(&facet_representation_ids)
        )?;
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let id: String = row.get(0);
            let leading_representation_id: Option<String> = row.get(14);
            let preview = PreviewHydration {
                ocr_text: ocr.remove(&id),
                file: leading_representation_id
                    .as_ref()
                    .and_then(|id| files.remove(id))
                    .unwrap_or_default(),
                facet: leading_representation_id
                    .as_ref()
                    .and_then(|id| facets.remove(id))
                    .unwrap_or_default(),
            };
            items.push(
                self.summary_from_row_with(
                    row,
                    tags.remove(&id).unwrap_or_default(),
                    presentations.remove(&id),
                    Some(preview),
                )
                .await?,
            );
        }
        Ok(items)
    }

    pub async fn summaries(&self, ids: &[String]) -> Result<HashMap<String, ClipSummary>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(SUMMARY_SELECT);
        query.push(" WHERE c.lifecycle_state='ready' AND c.id IN (");
        let mut separated = query.separated(",");
        for id in ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        Ok(self
            .hydrate_summary_rows(query.build().fetch_all(&self.pool).await?)
            .await?
            .into_iter()
            .map(|summary| (summary.id.clone(), summary))
            .collect())
    }
    async fn summary_from_row(&self, row: sqlx::sqlite::SqliteRow) -> Result<ClipSummary> {
        let id: String = row.get(0);
        let tags = self.tags_for(&id).await?;
        let compact_presentation = self.compact_presentation(&id).await?;
        self.summary_from_row_with(row, tags, compact_presentation, None)
            .await
    }

    async fn summary_from_row_with(
        &self,
        row: sqlx::sqlite::SqliteRow,
        tags: Vec<Tag>,
        compact_presentation: Option<(String, crate::contracts::CompactPresentation)>,
        preview_hydration: Option<PreviewHydration>,
    ) -> Result<ClipSummary> {
        let id: String = row.get(0);
        let history_renderer_id = compact_presentation
            .as_ref()
            .map(|(renderer_id, _)| renderer_id.clone());
        let mut primary_presentation_kind: String = row.get(10);
        let thumbnail_asset_id: Option<String> = row.get(11);
        // Office applications often put their opaque native payload first and a
        // faithful PNG alternate immediately after it. The native bytes remain
        // canonical for reconstruction, but the image is the useful preview.
        if primary_presentation_kind == "office" && thumbnail_asset_id.is_some() {
            primary_presentation_kind = "image".into();
        }
        let ocr_status: Option<String> = row.get(13);
        let text_snippet: Option<String> = row.get(9);
        let leading_representation_id: Option<String> = row.get(14);
        let leading_mime: Option<String> = row.get(15);
        let leading_format_family: Option<String> = row.get(16);
        let plain_text_fallback: Option<String> = row.get(17);

        let (ocr_text, (file_name, file_count), (facet_id, facet_display_name)) =
            if let Some(hydration) = preview_hydration {
                (hydration.ocr_text, hydration.file, hydration.facet)
            } else {
                let ocr_text = if primary_presentation_kind == "image"
                    && ocr_status.as_deref() == Some("completed")
                {
                    crate::artifacts::ocr_text(self, &id).await
                } else {
                    None
                };
                let file = if primary_presentation_kind == "files" {
                    self.leading_file_entry(leading_representation_id.as_deref())
                        .await?
                } else {
                    (None, 0)
                };
                let facet = if matches!(primary_presentation_kind.as_str(), "text" | "html") {
                    self.leading_facet(leading_representation_id.as_deref())
                        .await?
                } else {
                    (None, None)
                };
                (ocr_text, file, facet)
            };
        let history_preview = resolve_history_preview(
            PreviewContext {
                presentation_kind: &primary_presentation_kind,
                leading_mime: leading_mime.as_deref(),
                leading_format_family: leading_format_family.as_deref(),
                text_snippet: text_snippet.as_deref(),
                plain_text_fallback: plain_text_fallback.as_deref(),
                has_thumbnail: thumbnail_asset_id.is_some(),
                ocr_text: ocr_text.as_deref(),
                file_name: file_name.as_deref(),
                file_count,
                facet_id: facet_id.as_deref(),
                facet_display_name: facet_display_name.as_deref(),
            },
            compact_presentation.map(|(_, presentation)| presentation),
        );

        Ok(ClipSummary {
            id,
            source_app_name: row.get(1),
            source_app_id: row.get(2),
            captured_at: row.get(3),
            updated_at: row.get(4),
            is_pinned: row.get::<i64, _>(5) != 0,
            is_favorite: row.get::<i64, _>(6) != 0,
            note: row.get(7),
            representation_count: row.get(8),
            primary_presentation_kind,
            thumbnail_asset_id,
            has_plain_text: row.get::<i64, _>(18) != 0,
            shareable: row.get::<i64, _>(19) != 0,
            has_embedding: row.get::<i64, _>(12) != 0,
            ocr_status,
            history_preview,
            history_renderer_id,
            tags,
        })
    }
    async fn leading_file_entry(
        &self,
        representation_id: Option<&str>,
    ) -> Result<(Option<String>, i64)> {
        let Some(representation_id) = representation_id else {
            return Ok((None, 0));
        };
        let files: Vec<String> = sqlx::query_scalar(
            "SELECT file_reference FROM clip_file_list_entries WHERE representation_id=? ORDER BY ordinal",
        )
        .bind(representation_id)
        .fetch_all(&self.pool)
        .await?;
        let name = files.first().map(|reference| {
            Path::new(reference)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| reference.clone())
        });
        Ok((name, files.len() as i64))
    }
    async fn leading_file_entries_for_many(
        &self,
        representation_ids: &[String],
    ) -> Result<HashMap<String, (Option<String>, i64)>> {
        if representation_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT representation_id,file_reference FROM clip_file_list_entries
             WHERE representation_id IN (",
        );
        let mut separated = query.separated(",");
        for id in representation_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(") ORDER BY representation_id,ordinal");
        let mut files = HashMap::<String, (Option<String>, i64)>::new();
        for row in query.build().fetch_all(&self.pool).await? {
            let representation_id: String = row.get(0);
            let reference: String = row.get(1);
            let entry = files.entry(representation_id).or_default();
            if entry.0.is_none() {
                entry.0 = Some(
                    Path::new(&reference)
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or(reference),
                );
            }
            entry.1 += 1;
        }
        Ok(files)
    }
    async fn leading_facet(
        &self,
        representation_id: Option<&str>,
    ) -> Result<(Option<String>, Option<String>)> {
        let Some(representation_id) = representation_id else {
            return Ok((None, None));
        };
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT f.facet_id,d.display_name FROM content_clip_facets f \
             JOIN content_facet_definitions d ON d.id=f.facet_id \
             WHERE f.source_representation_id=?",
        )
        .bind(representation_id)
        .fetch_all(&self.pool)
        .await?;
        let selected = rows.into_iter().min_by(|left, right| {
            crate::contributions::facet_presentation_priority(&right.0)
                .cmp(&crate::contributions::facet_presentation_priority(&left.0))
                .then_with(|| left.0.cmp(&right.0))
        });
        Ok(selected.map_or((None, None), |(id, name)| (Some(id), Some(name))))
    }
    async fn leading_facets_for_many(
        &self,
        representation_ids: &[String],
    ) -> Result<HashMap<String, (Option<String>, Option<String>)>> {
        if representation_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT f.source_representation_id,f.facet_id,d.display_name
             FROM content_clip_facets f JOIN content_facet_definitions d ON d.id=f.facet_id
             WHERE f.source_representation_id IN (",
        );
        let mut separated = query.separated(",");
        for id in representation_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        let mut facets = HashMap::<String, (String, String)>::new();
        for row in query.build().fetch_all(&self.pool).await? {
            let representation_id: String = row.get(0);
            let candidate = (row.get::<String, _>(1), row.get::<String, _>(2));
            let replace = facets.get(&representation_id).is_none_or(|current| {
                crate::contributions::facet_presentation_priority(&candidate.0)
                    > crate::contributions::facet_presentation_priority(&current.0)
                    || (crate::contributions::facet_presentation_priority(&candidate.0)
                        == crate::contributions::facet_presentation_priority(&current.0)
                        && candidate.0 < current.0)
            });
            if replace {
                facets.insert(representation_id, candidate);
            }
        }
        Ok(facets
            .into_iter()
            .map(|(representation, (id, name))| (representation, (Some(id), Some(name))))
            .collect())
    }

    async fn ocr_text_for_many(&self, clip_ids: &[String]) -> Result<HashMap<String, String>> {
        if clip_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT cr.clip_id,atv.text_value FROM artifact_records ar
             JOIN artifact_inputs ai ON ai.artifact_id=ar.id
             JOIN artifact_text_values atv ON atv.artifact_id=ar.id
             JOIN clip_representations cr ON cr.id=ai.representation_id
             WHERE ar.producer_id='builtin.artifact.ocr' AND ar.producer_version='3'
             AND ar.lifecycle_state='ready' AND cr.clip_id IN (",
        );
        let mut separated = query.separated(",");
        for id in clip_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(") ORDER BY cr.clip_id,ar.created_at DESC,ar.id");
        let mut texts = HashMap::new();
        for row in query.build().fetch_all(&self.pool).await? {
            texts.entry(row.get(0)).or_insert_with(|| row.get(1));
        }
        Ok(texts)
    }

    pub async fn summary(&self, id: &str) -> Result<ClipSummary> {
        let row = sqlx::query(AssertSqlSafe(format!(
            "{SUMMARY_SELECT} WHERE c.id=? AND c.lifecycle_state='ready'"
        )))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .context("clip not found")?;
        self.summary_from_row(row).await
    }

    pub async fn compact_presentation(
        &self,
        clip_id: &str,
    ) -> Result<Option<(String, crate::contracts::CompactPresentation)>> {
        let row = sqlx::query(
            "SELECT renderer_id,model_json FROM content_compact_presentations WHERE clip_id=? ORDER BY updated_at DESC,renderer_id LIMIT 1",
        )
        .bind(clip_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            let renderer_id: String = row.get(0);
            let json: String = row.get(1);
            let presentation: crate::contracts::CompactPresentation =
                serde_json::from_str(&json).context("stored compact presentation is invalid")?;
            Ok((renderer_id, presentation))
        })
        .transpose()
    }
    async fn compact_presentations_for_many(
        &self,
        clip_ids: &[String],
    ) -> Result<HashMap<String, (String, crate::contracts::CompactPresentation)>> {
        if clip_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT clip_id,renderer_id,model_json FROM content_compact_presentations WHERE clip_id IN (",
        );
        let mut separated = query.separated(",");
        for id in clip_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(") ORDER BY clip_id,updated_at DESC,renderer_id");
        let mut presentations = HashMap::new();
        for row in query.build().fetch_all(&self.pool).await? {
            let clip_id: String = row.get(0);
            if presentations.contains_key(&clip_id) {
                continue;
            }
            let renderer_id: String = row.get(1);
            let model_json: String = row.get(2);
            let presentation = serde_json::from_str(&model_json)
                .context("stored compact presentation is invalid")?;
            presentations.insert(clip_id, (renderer_id, presentation));
        }
        Ok(presentations)
    }
    async fn tags_for(&self, clip_id: &str) -> Result<Vec<Tag>> {
        let rows=sqlx::query("SELECT t.id,t.name,t.color FROM catalog_tags t JOIN catalog_clip_tags ct ON ct.tag_id=t.id WHERE ct.clip_id=? ORDER BY t.name").bind(clip_id).fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|r| Tag {
                id: r.get(0),
                name: r.get(1),
                color: r.get(2),
            })
            .collect())
    }
    async fn tags_for_many(&self, clip_ids: &[String]) -> Result<HashMap<String, Vec<Tag>>> {
        if clip_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT ct.clip_id,t.id,t.name,t.color FROM catalog_tags t
             JOIN catalog_clip_tags ct ON ct.tag_id=t.id WHERE ct.clip_id IN (",
        );
        let mut separated = query.separated(",");
        for id in clip_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(") ORDER BY ct.clip_id,t.name");
        let mut tags = HashMap::<String, Vec<Tag>>::new();
        for row in query.build().fetch_all(&self.pool).await? {
            tags.entry(row.get(0)).or_default().push(Tag {
                id: row.get(1),
                name: row.get(2),
                color: row.get(3),
            });
        }
        Ok(tags)
    }
    pub async fn detail(&self, id: &str) -> Result<ClipDetail> {
        let row = sqlx::query(AssertSqlSafe(format!(
            "{SUMMARY_SELECT} WHERE c.id=? AND c.lifecycle_state='ready'"
        )))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .context("clip not found")?;
        let reps=sqlx::query("SELECT r.id,r.format_key,r.canonical_mime_type,r.native_type,r.storage_kind,r.ordinal,r.capture_priority,COALESCE(t.utf8_byte_length,b.byte_length,0),t.text_value,b.id,b.sha256,r.capability_id,r.format_family FROM clip_representations r LEFT JOIN clip_text_values t ON t.representation_id=r.id LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id AND b.lifecycle_state='ready' WHERE r.clip_id=? AND r.lifecycle_state='ready' ORDER BY r.ordinal").bind(id).fetch_all(&self.pool).await?;
        let mut representations = Vec::new();
        for r in reps {
            let rep_id: String = r.get(0);
            let files=sqlx::query_scalar("SELECT file_reference FROM clip_file_list_entries WHERE representation_id=? ORDER BY ordinal").bind(&rep_id).fetch_all(&self.pool).await?;
            representations.push(RepresentationDetail {
                id: rep_id,
                format_key: r.get(1),
                canonical_mime_type: r.get(2),
                native_type: r.get(3),
                storage_kind: r.get(4),
                ordinal: r.get(5),
                capture_priority: r.get(6),
                byte_length: r.get(7),
                text_value: r.get(8),
                binary_file_id: r.get(9),
                sha256: r.get(10),
                capability_id: r.get(11),
                format_family: r.get(12),
                file_references: files,
            });
        }
        let format_observations = sqlx::query("SELECT ordinal,platform,native_identifier,numeric_id,medium,byte_length,capability_id,policy_version,decision,reason FROM clip_format_observations WHERE clip_id=? ORDER BY ordinal")
            .bind(id).fetch_all(&self.pool).await?.into_iter().map(|row| FormatObservation {
                ordinal: row.get(0), platform: row.get(1), native_identifier: row.get(2),
                numeric_id: row.get(3), medium: row.get(4), byte_length: row.get(5),
                capability_id: row.get(6), policy_version: row.get(7), decision: row.get(8), reason: row.get(9),
            }).collect();
        Ok(ClipDetail {
            clip: self.summary_from_row(row).await?,
            representations,
            format_observations,
        })
    }
    pub async fn reconstruction(&self, id: &str) -> Result<Vec<CapturedRepresentation>> {
        let rows=sqlx::query("SELECT r.format_key,r.canonical_mime_type,r.native_type,r.platform,r.capture_priority,r.storage_kind,t.text_value,b.id FROM clip_representations r JOIN clip_items c ON c.id=r.clip_id LEFT JOIN clip_text_values t ON t.representation_id=r.id LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id WHERE r.clip_id=? AND r.lifecycle_state='ready' AND c.lifecycle_state='ready' ORDER BY r.capture_priority,r.ordinal").bind(id).fetch_all(&self.pool).await?;
        let mut result = Vec::new();
        for row in rows {
            let kind: String = row.get(5);
            let payload = match kind.as_str() {
                "text" => CapturedPayload::Text(row.get::<String, _>(6)),
                "binary_asset" => {
                    let binary_id: String = row.get(7);
                    CapturedPayload::Binary(self.asset(&binary_id).await?.0)
                }
                "file_list" => {
                    let format_key: String = row.get(0);
                    let representation_id:Option<String>=sqlx::query_scalar("SELECT id FROM clip_representations WHERE clip_id=? AND format_key=? AND lifecycle_state='ready'").bind(id).bind(&format_key).fetch_optional(&self.pool).await?;
                    let files=sqlx::query_scalar::<_,String>("SELECT file_reference FROM clip_file_list_entries WHERE representation_id=? ORDER BY ordinal").bind(representation_id.context("file-list representation missing")?).fetch_all(&self.pool).await?;
                    CapturedPayload::Files(files)
                }
                _ => continue,
            };
            result.push(CapturedRepresentation {
                format_key: row.get(0),
                canonical_mime_type: row.get(1),
                native_type: row.get(2),
                platform: row.get(3),
                capture_priority: row.get(4),
                payload,
            });
        }
        Ok(result)
    }
    pub async fn plain_text_reconstruction(&self, id: &str) -> Result<Vec<CapturedRepresentation>> {
        let rows = sqlx::query("SELECT r.format_key,r.canonical_mime_type,r.native_type,r.platform,r.capture_priority,t.text_value FROM clip_representations r JOIN clip_items c ON c.id=r.clip_id JOIN clip_text_values t ON t.representation_id=r.id WHERE r.clip_id=? AND r.lifecycle_state='ready' AND c.lifecycle_state='ready' AND r.storage_kind='text' AND r.canonical_mime_type='text/plain' ORDER BY r.capture_priority,r.ordinal LIMIT 1")
            .bind(id)
            .fetch_all(&self.pool)
            .await?;
        let Some(row) = rows.into_iter().next() else {
            bail!("clip has no ready text/plain representation")
        };
        Ok(vec![CapturedRepresentation {
            format_key: row.get(0),
            canonical_mime_type: row.get(1),
            native_type: row.get(2),
            platform: row.get(3),
            capture_priority: row.get(4),
            payload: CapturedPayload::Text(row.get(5)),
        }])
    }
    pub async fn source_representation(
        &self,
        clip_id: &str,
        representation_id: &str,
    ) -> Result<(CapturedRepresentation, String)> {
        let row = sqlx::query("SELECT r.format_key,r.canonical_mime_type,r.native_type,r.platform,r.capture_priority,r.storage_kind,t.text_value,r.binary_file_id,COALESCE(t.sha256,b.sha256) FROM clip_representations r JOIN clip_items c ON c.id=r.clip_id LEFT JOIN clip_text_values t ON t.representation_id=r.id LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id WHERE r.id=? AND r.clip_id=? AND r.lifecycle_state='ready' AND c.lifecycle_state='ready'")
            .bind(representation_id)
            .bind(clip_id)
            .fetch_optional(&self.pool)
            .await?
            .context("ready source representation not found")?;
        let kind: String = row.get(5);
        let (payload, source_sha256) = match kind.as_str() {
            "text" => (CapturedPayload::Text(row.get(6)), row.get::<String, _>(8)),
            "binary_asset" => (
                CapturedPayload::Binary(self.asset(&row.get::<String, _>(7)).await?.0),
                row.get::<String, _>(8),
            ),
            "file_list" => {
                let files = sqlx::query_scalar::<_, String>(
                    "SELECT file_reference FROM clip_file_list_entries WHERE representation_id=? ORDER BY ordinal",
                )
                .bind(representation_id)
                .fetch_all(&self.pool)
                .await?;
                let mut hash_input = Vec::new();
                for file in &files {
                    hash_input.extend_from_slice(&(file.len() as u64).to_le_bytes());
                    hash_input.extend_from_slice(file.as_bytes());
                }
                (CapturedPayload::Files(files), sha256(&hash_input))
            }
            _ => bail!("unsupported transform input"),
        };
        Ok((
            CapturedRepresentation {
                format_key: row.get(0),
                canonical_mime_type: row.get(1),
                native_type: row.get(2),
                platform: row.get(3),
                capture_priority: row.get(4),
                payload,
            },
            source_sha256,
        ))
    }
    pub async fn touch(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE clip_items SET access_count=access_count+1,updated_at=? WHERE id=? AND lifecycle_state='ready'")
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn set_flag(&self, id: &str, column: &str, value: bool) -> Result<()> {
        if !matches!(column, "is_pinned" | "is_favorite") {
            bail!("invalid flag")
        }
        let q = format!(
            "UPDATE clip_items SET {column}=?,updated_at=? WHERE id=? AND lifecycle_state='ready'"
        );
        sqlx::query(AssertSqlSafe(q))
            .bind(value as i64)
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn note(&self, id: &str, note: Option<String>) -> Result<()> {
        sqlx::query(
            "UPDATE clip_items SET note=?,updated_at=? WHERE id=? AND lifecycle_state='ready'",
        )
        .bind(note)
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn delete(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM clip_items WHERE id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.drain_managed_file_deletions().await?;
        Ok(())
    }
    pub async fn clear_history(&self) -> Result<Vec<String>> {
        let ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM clip_items WHERE lifecycle_state='ready'",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM clip_items WHERE lifecycle_state='ready'")
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.drain_managed_file_deletions().await?;
        Ok(ids)
    }

    pub async fn auto_clear_sensitive(&self, cutoff_ms: i64) -> Result<Vec<String>> {
        let ids = sqlx::query_scalar::<_, String>(
            "SELECT c.id FROM clip_items c WHERE c.lifecycle_state='ready' AND c.captured_at<=? AND EXISTS (SELECT 1 FROM content_clip_facets f WHERE f.clip_id=c.id AND f.facet_id='core.security.secret')",
        )
        .bind(cutoff_ms)
        .fetch_all(&self.pool)
        .await?;
        if ids.is_empty() {
            return Ok(ids);
        }
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM clip_items WHERE lifecycle_state='ready' AND captured_at<=? AND EXISTS (SELECT 1 FROM content_clip_facets f WHERE f.clip_id=clip_items.id AND f.facet_id='core.security.secret')")
            .bind(cutoff_ms)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        self.drain_managed_file_deletions().await?;
        Ok(ids)
    }
    pub async fn clips_for_tag(&self, tag_id: &str) -> Result<Vec<String>> {
        sqlx::query_scalar("SELECT clip_id FROM catalog_clip_tags WHERE tag_id=?")
            .bind(tag_id)
            .fetch_all(&self.pool)
            .await
            .map_err(Into::into)
    }
    pub async fn tags(&self) -> Result<Vec<Tag>> {
        let rows = sqlx::query("SELECT id,name,color FROM catalog_tags ORDER BY name")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| Tag {
                id: r.get(0),
                name: r.get(1),
                color: r.get(2),
            })
            .collect())
    }
    pub async fn create_tag(&self, name: String, color: Option<String>) -> Result<Tag> {
        let tag = Tag {
            id: new_id(),
            name,
            color,
        };
        let now = now_ms();
        sqlx::query(
            "INSERT INTO catalog_tags(id,name,color,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
        .bind(&tag.id)
        .bind(&tag.name)
        .bind(&tag.color)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(tag)
    }
    pub async fn delete_tag(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM catalog_tags WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn tag_clip(&self, clip: &str, tag: &str, add: bool) -> Result<()> {
        if add {
            sqlx::query(
                "INSERT OR IGNORE INTO catalog_clip_tags(clip_id,tag_id,created_at) VALUES(?,?,?)",
            )
            .bind(clip)
            .bind(tag)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query("DELETE FROM catalog_clip_tags WHERE clip_id=? AND tag_id=?")
                .bind(clip)
                .bind(tag)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }
    pub async fn settings(&self) -> Result<CaptureSettings> {
        let mut s = CaptureSettings::default();
        for (key, value) in sqlx::query(
            "SELECT key,value_json FROM config_device_values WHERE key LIKE 'capture.%'",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|r| (r.get::<String, _>(0), r.get::<String, _>(1)))
        {
            match key.as_str() {
                "capture.max_ordinary_clips" => {
                    s.max_ordinary_clips = serde_json::from_str(&value)?
                }
                "capture.max_age_days" => s.max_age_days = serde_json::from_str(&value)?,
                "capture.max_managed_bytes" => s.max_managed_bytes = serde_json::from_str(&value)?,
                "capture.max_representation_bytes" => {
                    s.max_representation_bytes = serde_json::from_str(&value)?
                }
                "capture.max_snapshot_bytes" => {
                    s.max_snapshot_bytes = serde_json::from_str(&value)?
                }
                _ => {}
            }
        }
        s.managed_bytes_used = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(byte_length),0) FROM clip_binary_files WHERE lifecycle_state='ready'",
        )
        .fetch_one(&self.pool)
        .await? as u64;
        let removable_binary_clip: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM clip_items c JOIN clip_representations r ON r.clip_id=c.id WHERE c.lifecycle_state='ready' AND c.is_pinned=0 AND c.is_favorite=0 AND r.binary_file_id IS NOT NULL LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        if s.max_managed_bytes
            .is_some_and(|limit| s.managed_bytes_used > limit)
            && removable_binary_clip.is_none()
        {
            s.retention_warning = Some(
                "Protected clips currently keep managed storage above the configured target."
                    .into(),
            );
        }
        Ok(s)
    }
    pub async fn update_settings(&self, s: &CaptureSettings) -> Result<()> {
        for (k, v) in [
            (
                "capture.max_ordinary_clips",
                serde_json::to_string(&s.max_ordinary_clips)?,
            ),
            (
                "capture.max_age_days",
                serde_json::to_string(&s.max_age_days)?,
            ),
            (
                "capture.max_managed_bytes",
                serde_json::to_string(&s.max_managed_bytes)?,
            ),
            (
                "capture.max_representation_bytes",
                serde_json::to_string(&s.max_representation_bytes)?,
            ),
            (
                "capture.max_snapshot_bytes",
                serde_json::to_string(&s.max_snapshot_bytes)?,
            ),
        ] {
            let now = now_ms();
            sqlx::query("INSERT INTO config_device_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(k).bind(v).bind(now).bind(now).execute(&self.pool).await?;
        }
        self.enforce_retention(s).await
    }

    pub async fn app_settings(&self) -> Result<AppSettings> {
        let mut settings = AppSettings {
            capture: self.settings().await?,
            ..AppSettings::default()
        };
        for (key, value) in
            sqlx::query("SELECT key,value_json FROM config_profile_values WHERE key LIKE 'ui.%'")
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .map(|row| (row.get::<String, _>(0), row.get::<String, _>(1)))
        {
            match key.as_str() {
                "ui.theme" => settings.theme = serde_json::from_str(&value)?,
                "ui.language" => settings.language = serde_json::from_str(&value)?,
                "ui.language_initialized" => {
                    settings.language_initialized = serde_json::from_str(&value)?
                }
                "ui.activation_mode" => settings.activation_mode = serde_json::from_str(&value)?,
                "ui.default_output_format" => {
                    settings.default_output_format = serde_json::from_str(&value)?
                }
                "ui.paste_on_enter" => settings.paste_on_enter = serde_json::from_str(&value)?,
                "ui.hide_on_copy" => settings.hide_on_copy = serde_json::from_str(&value)?,
                "ui.hide_on_blur" => settings.hide_on_blur = serde_json::from_str(&value)?,
                "ui.always_on_top" => settings.always_on_top = serde_json::from_str(&value)?,
                "ui.show_copy_toast" => settings.show_copy_toast = serde_json::from_str(&value)?,
                "ui.auto_clear_minutes" => {
                    settings.auto_clear_minutes = serde_json::from_str(&value)?
                }
                "ui.clear_on_exit" => settings.clear_on_exit = serde_json::from_str(&value)?,
                "ui.auto_start" => settings.auto_start = serde_json::from_str(&value)?,
                _ => {}
            }
        }
        for (key, value) in sqlx::query(
            "SELECT key,value_json FROM config_device_values WHERE key IN ('capture.filters','capture.excluded_apps','window.global_shortcut')",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (row.get::<String, _>(0), row.get::<String, _>(1)))
        {
            match key.as_str() {
                "capture.filters" => settings.capture_filters = serde_json::from_str(&value)?,
                "capture.excluded_apps" => settings.excluded_apps = serde_json::from_str(&value)?,
                "window.global_shortcut" => settings.global_shortcut = serde_json::from_str(&value)?,
                _ => {}
            }
        }
        Ok(settings)
    }

    pub async fn update_app_settings(&self, settings: &AppSettings) -> Result<()> {
        settings.validate()?;
        self.update_settings(&settings.capture).await?;
        let mut transaction = self.pool.begin().await?;
        for (key, value) in [
            ("ui.theme", serde_json::to_string(&settings.theme)?),
            ("ui.language", serde_json::to_string(&settings.language)?),
            (
                "ui.language_initialized",
                serde_json::to_string(&settings.language_initialized)?,
            ),
            (
                "ui.activation_mode",
                serde_json::to_string(&settings.activation_mode)?,
            ),
            (
                "ui.default_output_format",
                serde_json::to_string(&settings.default_output_format)?,
            ),
            (
                "ui.paste_on_enter",
                serde_json::to_string(&settings.paste_on_enter)?,
            ),
            (
                "ui.hide_on_copy",
                serde_json::to_string(&settings.hide_on_copy)?,
            ),
            (
                "ui.hide_on_blur",
                serde_json::to_string(&settings.hide_on_blur)?,
            ),
            (
                "ui.always_on_top",
                serde_json::to_string(&settings.always_on_top)?,
            ),
            (
                "ui.show_copy_toast",
                serde_json::to_string(&settings.show_copy_toast)?,
            ),
            (
                "ui.auto_clear_minutes",
                serde_json::to_string(&settings.auto_clear_minutes)?,
            ),
            (
                "ui.clear_on_exit",
                serde_json::to_string(&settings.clear_on_exit)?,
            ),
            (
                "ui.auto_start",
                serde_json::to_string(&settings.auto_start)?,
            ),
        ] {
            let now = now_ms();
            sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
                .bind(key).bind(&value).bind(now).bind(now).execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        for (key, value) in [
            (
                "capture.filters",
                serde_json::to_string(&settings.capture_filters)?,
            ),
            (
                "capture.excluded_apps",
                serde_json::to_string(&settings.excluded_apps)?,
            ),
            (
                "window.global_shortcut",
                serde_json::to_string(&settings.global_shortcut)?,
            ),
        ] {
            let now = now_ms();
            sqlx::query("INSERT INTO config_device_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
                .bind(key).bind(value).bind(now).bind(now).execute(&self.pool).await?;
        }
        Ok(())
    }

    async fn enforce_retention(&self, s: &CaptureSettings) -> Result<()> {
        if let Some(max) = s.max_ordinary_clips {
            let ids=sqlx::query_scalar::<_, String>("SELECT id FROM clip_items WHERE lifecycle_state='ready' AND is_pinned=0 AND is_favorite=0 ORDER BY captured_at DESC,id DESC LIMIT -1 OFFSET ?").bind(max as i64).fetch_all(&self.pool).await?;
            for id in ids {
                self.delete(&id).await?;
            }
        }
        if let Some(days) = s.max_age_days {
            let cutoff = now_ms() - days as i64 * 86_400_000;
            let ids=sqlx::query_scalar::<_, String>("SELECT id FROM clip_items WHERE lifecycle_state='ready' AND is_pinned=0 AND is_favorite=0 AND captured_at<?").bind(cutoff).fetch_all(&self.pool).await?;
            for id in ids {
                self.delete(&id).await?;
            }
        }
        if let Some(max_bytes) = s.max_managed_bytes {
            loop {
                let used: i64 = sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(SUM(byte_length),0) FROM clip_binary_files WHERE lifecycle_state='ready'",
                )
                .fetch_one(&self.pool)
                .await?;
                if used as u64 <= max_bytes {
                    break;
                }
                // Shared files count once above. Remove only an unprotected owning clip; if all
                // remaining bytes are protected, the configured target is intentionally unmet.
                let candidate: Option<String> = sqlx::query_scalar(
                    "SELECT DISTINCT c.id FROM clip_items c JOIN clip_representations r ON r.clip_id=c.id WHERE c.lifecycle_state='ready' AND c.is_pinned=0 AND c.is_favorite=0 AND r.binary_file_id IS NOT NULL ORDER BY c.captured_at ASC,c.id ASC LIMIT 1",
                ).fetch_optional(&self.pool).await?;
                match candidate {
                    Some(id) => self.delete(&id).await?,
                    None => break,
                }
            }
        }
        Ok(())
    }
    async fn cleanup_orphans(&self) -> Result<()> {
        sqlx::query("DELETE FROM clip_binary_files WHERE NOT EXISTS(SELECT 1 FROM clip_representations r WHERE r.binary_file_id=clip_binary_files.id)")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn drain_managed_file_deletions(&self) -> Result<u64> {
        let rows = sqlx::query(
            "SELECT relative_path FROM system_managed_file_deletions ORDER BY queued_at,relative_path",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut removed = 0;
        for row in rows {
            let relative: String = row.get(0);
            let referenced: i64 = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM clip_binary_files WHERE relative_path=? UNION ALL SELECT 1 FROM artifact_binary_files WHERE relative_path=?)",
            )
            .bind(&relative)
            .bind(&relative)
            .fetch_one(&self.pool)
            .await?;
            if referenced != 0 {
                sqlx::query("DELETE FROM system_managed_file_deletions WHERE relative_path=?")
                    .bind(&relative)
                    .execute(&self.pool)
                    .await?;
                continue;
            }
            let result = if safe_relative(&relative) {
                match fs::remove_file(self.managed_root.join(&relative)) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error),
                }
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "unsafe managed-file deletion path",
                ))
            };
            match result {
                Ok(()) => {
                    sqlx::query("DELETE FROM system_managed_file_deletions WHERE relative_path=?")
                        .bind(&relative)
                        .execute(&self.pool)
                        .await?;
                    removed += 1;
                }
                Err(error) => {
                    sqlx::query("UPDATE system_managed_file_deletions SET attempt_count=attempt_count+1,last_attempt_at=?,last_error=? WHERE relative_path=?")
                        .bind(now_ms())
                        .bind(error.to_string().chars().take(512).collect::<String>())
                        .bind(&relative)
                        .execute(&self.pool)
                        .await?;
                }
            }
        }
        let managed = self.managed_root.join("managed");
        if managed.exists() {
            remove_empty_directories(&managed)?;
        }
        Ok(removed)
    }
    async fn recover_managed_files(&self) -> Result<()> {
        let staging = self.managed_root.join("staging");
        fs::create_dir_all(&staging)?;
        for entry in fs::read_dir(&staging)? {
            let path = entry?.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.is_file() || metadata.file_type().is_symlink() {
                let _ = fs::remove_file(path);
            }
        }
        let rows = sqlx::query(
            "SELECT id,sha256,relative_path FROM clip_binary_files WHERE lifecycle_state='pending'",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in rows {
            let id: String = row.get(0);
            let expected: String = row.get(1);
            let relative: String = row.get(2);
            if !safe_relative(&relative) {
                sqlx::query("UPDATE clip_binary_files SET lifecycle_state='quarantined',updated_at=? WHERE id=?").bind(now_ms()).bind(id).execute(&self.pool).await?;
                continue;
            }
            let path = self.managed_root.join(&relative);
            let state = match fs::read(&path) {
                Ok(bytes) if sha256(&bytes) == expected => "ready",
                Ok(_) => "quarantined",
                Err(_) => "missing",
            };
            sqlx::query("UPDATE clip_binary_files SET lifecycle_state=?,updated_at=? WHERE id=?")
                .bind(state)
                .bind(now_ms())
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        let artifact_rows = sqlx::query("SELECT id,sha256,relative_path FROM artifact_binary_files WHERE lifecycle_state='pending'").fetch_all(&self.pool).await?;
        for row in artifact_rows {
            let id: String = row.get(0);
            let expected: String = row.get(1);
            let relative: String = row.get(2);
            let state = if !safe_relative(&relative) {
                "quarantined"
            } else {
                match fs::read(self.managed_root.join(&relative)) {
                    Ok(bytes) if sha256(&bytes) == expected => "ready",
                    Ok(_) => "quarantined",
                    Err(_) => "missing",
                }
            };
            sqlx::query(
                "UPDATE artifact_binary_files SET lifecycle_state=?,updated_at=? WHERE id=?",
            )
            .bind(state)
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn reconcile_managed_files(&self) -> Result<()> {
        self.cleanup_orphans().await?;
        self.drain_managed_file_deletions().await?;
        let known: std::collections::HashSet<String> =
            sqlx::query_scalar("SELECT relative_path FROM clip_binary_files UNION SELECT relative_path FROM artifact_binary_files")
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .collect();
        let managed = self.managed_root.join("managed");
        if managed.exists() {
            for path in managed_files(&managed)? {
                if let Ok(relative) = path.strip_prefix(&self.managed_root) {
                    let key = relative.to_string_lossy().replace('\\', "/");
                    if !known.contains(&key) {
                        let _ = fs::remove_file(path);
                    }
                }
            }
            remove_empty_directories(&managed)?;
        }
        Ok(())
    }
    pub async fn asset(&self, binary_id: &str) -> Result<(Vec<u8>, String)> {
        let row=sqlx::query("SELECT b.sha256,b.relative_path,COALESCE(r.canonical_mime_type,'application/octet-stream') FROM clip_binary_files b JOIN clip_representations r ON r.binary_file_id=b.id AND r.lifecycle_state='ready' JOIN clip_items c ON c.id=r.clip_id AND c.lifecycle_state='ready' WHERE b.id=? AND b.lifecycle_state='ready' LIMIT 1").bind(binary_id).fetch_optional(&self.pool).await?.context("asset not found")?;
        let expected: String = row.get(0);
        let relative: String = row.get(1);
        let mime: String = row.get(2);
        if !safe_relative(&relative) {
            bail!("invalid managed asset path")
        }
        let path = self.managed_root.join(relative);
        if fs::symlink_metadata(&path)?.file_type().is_symlink() {
            bail!("managed asset cannot be a symlink")
        }
        let root = fs::canonicalize(&self.managed_root)?;
        let canonical = fs::canonicalize(&path)?;
        if !canonical.starts_with(root) {
            bail!("managed asset escaped its root")
        }
        let bytes = fs::read(canonical)?;
        if sha256(&bytes) != expected {
            bail!("managed asset hash mismatch")
        }
        Ok((bytes, mime))
    }
}
fn payload_len(r: &CapturedRepresentation) -> u64 {
    match &r.payload {
        CapturedPayload::Text(v) => v.len() as u64,
        CapturedPayload::Binary(v) => v.len() as u64,
        CapturedPayload::Files(v) => v.iter().map(|x| x.len() as u64).sum(),
    }
}

fn representation_capability(rep: &CapturedRepresentation) -> (String, String) {
    let native = rep
        .native_type
        .as_deref()
        .or_else(|| rep.format_key.split_once(':').map(|(_, value)| value))
        .unwrap_or(&rep.format_key);
    if let Some(capability) = capabilities::resolve(&rep.platform, None, native) {
        return (capability.id.clone(), capability.family.clone());
    }
    let family = match (&rep.payload, rep.canonical_mime_type.as_deref()) {
        (CapturedPayload::Files(_), _) => "files",
        (_, Some(mime)) if mime.starts_with("image/") => "image",
        (_, Some("text/html" | "text/rtf" | "application/rtf")) => "rich_text",
        (_, Some("application/pdf")) => "document",
        (CapturedPayload::Text(_), _) => "text",
        _ => "binary",
    };
    (format!("core.generated.{family}"), family.into())
}

async fn replace_format_observations(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    clip_id: &str,
    observations: &[FormatObservation],
) -> Result<()> {
    sqlx::query("DELETE FROM clip_format_observations WHERE clip_id=?")
        .bind(clip_id)
        .execute(&mut **tx)
        .await?;
    for (ordinal, observation) in observations.iter().take(512).enumerate() {
        let identifier: String = observation.native_identifier.chars().take(256).collect();
        if identifier.is_empty() {
            continue;
        }
        let medium = observation
            .medium
            .as_ref()
            .map(|value| value.chars().take(64).collect::<String>());
        let reason: String = observation.reason.chars().take(120).collect();
        sqlx::query("INSERT INTO clip_format_observations(clip_id,ordinal,platform,native_identifier,numeric_id,medium,byte_length,capability_id,policy_version,decision,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
            .bind(clip_id).bind(ordinal as i64).bind(&observation.platform).bind(identifier)
            .bind(observation.numeric_id).bind(medium).bind(observation.byte_length)
            .bind(&observation.capability_id).bind(observation.policy_version)
            .bind(&observation.decision).bind(if reason.is_empty() { "unspecified" } else { &reason })
            .execute(&mut **tx).await?;
    }
    Ok(())
}

fn managed_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut result = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        } else if metadata.is_dir() {
            result.extend(managed_files(&path)?)
        } else if metadata.is_file() {
            result.push(path)
        }
    }
    Ok(result)
}

fn log_history_timing(operation: &str, started: Instant, count: usize, slow_ms: u128) {
    let elapsed = started.elapsed();
    if cfg!(debug_assertions) || elapsed.as_millis() >= slow_ms {
        eprintln!(
            "[PERF] {operation} count={count} duration_ms={}",
            elapsed.as_millis()
        );
    }
}

fn remove_empty_directories(root: &Path) -> Result<bool> {
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if fs::symlink_metadata(&path)?.is_dir() {
            let _ = remove_empty_directories(&path)?;
        }
    }
    let empty = fs::read_dir(root)?.next().is_none();
    if empty {
        fs::remove_dir(root)?;
    }
    Ok(empty)
}
pub fn safe_relative(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && !path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprint_is_stable_and_ignores_order() {
        let a = CapturedRepresentation {
            format_key: "text/plain".into(),
            canonical_mime_type: None,
            native_type: None,
            platform: "windows".into(),
            capture_priority: 1,
            payload: CapturedPayload::Text("x".into()),
        };
        let b = CapturedRepresentation {
            format_key: "text/html".into(),
            canonical_mime_type: None,
            native_type: None,
            platform: "windows".into(),
            capture_priority: 2,
            payload: CapturedPayload::Text("<b>x</b>".into()),
        };
        assert_eq!(
            capture_fingerprint(&[a.clone(), b.clone()]),
            capture_fingerprint(&[b, a])
        );
    }
    #[test]
    fn rejects_unsafe_paths() {
        assert!(!safe_relative("../x"));
        // Windows drive prefixes are only recognized by std::path on Windows.
        #[cfg(target_os = "windows")]
        assert!(!safe_relative("C:\\x"));
        assert!(safe_relative("managed/a/file"));
    }

    #[tokio::test]
    async fn startup_defers_ready_binary_verification_until_access() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let (clip_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![CapturedRepresentation {
                        format_key: "image/png".into(),
                        canonical_mime_type: Some("image/png".into()),
                        native_type: None,
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Binary(vec![1, 2, 3, 4]),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let (binary_id, relative_path): (String, String) = sqlx::query_as(
            "SELECT b.id,b.relative_path FROM clip_binary_files b JOIN clip_representations r ON r.binary_file_id=b.id WHERE r.clip_id=?",
        )
        .bind(clip_id)
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        fs::write(repo.managed_root.join(&relative_path), b"corrupt").unwrap();
        repo.pool.close().await;

        let reopened = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let state: String =
            sqlx::query_scalar("SELECT lifecycle_state FROM clip_binary_files WHERE id=?")
                .bind(&binary_id)
                .fetch_one(&reopened.pool)
                .await
                .unwrap();
        assert_eq!(state, "ready");
        assert!(reopened
            .asset(&binary_id)
            .await
            .unwrap_err()
            .to_string()
            .contains("hash mismatch"));
    }

    #[tokio::test]
    #[ignore = "release qualification: cargo test --release managed_startup_scale_qualification -- --ignored --nocapture"]
    async fn managed_startup_scale_qualification() {
        const RUNS: usize = 21;
        const P95_LIMIT_MS: u128 = 250;
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        sqlx::query(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<60000)
             INSERT INTO clip_binary_files(id,sha256,byte_length,relative_path,lifecycle_state,created_at,updated_at)
             SELECT printf('binary-%05d',x),printf('%064x',x),1048576,printf('managed/binary/%02x/%064x',x%256,x),'ready',x,x FROM n",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        repo.pool.close().await;

        let mut timings = Vec::with_capacity(RUNS);
        for _ in 0..RUNS {
            let started = Instant::now();
            let reopened = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
                .await
                .unwrap();
            timings.push(started.elapsed().as_millis());
            reopened.pool.close().await;
        }
        timings.sort_unstable();
        let p95 = timings[(RUNS - 1) * 95 / 100];
        println!("managed-startup ready_files=60000 p95_ms={p95}");
        assert!(p95 <= P95_LIMIT_MS);
    }

    #[tokio::test]
    async fn compact_presentations_retain_renderer_reference_without_icon_data() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let (clip_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![CapturedRepresentation {
                        format_key: "text/plain".into(),
                        canonical_mime_type: Some("text/plain".into()),
                        native_type: None,
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Text("encoded value".into()),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let source_id: String =
            sqlx::query_scalar("SELECT id FROM clip_representations WHERE clip_id=? LIMIT 1")
                .bind(&clip_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let contribution_id = "example.test/render";
        let stored = crate::contracts::CompactPresentation {
            leading: crate::contracts::LeadingVisual::None,
            title: None,
            subtitle: None,
            badge: None,
            accessibility_label: "Extension view".into(),
        };
        let model_json = serde_json::to_string(&stored).unwrap();
        assert!(model_json.len() <= 2048);
        assert!(!model_json.contains("svg"));
        sqlx::query("INSERT INTO content_compact_presentations(clip_id,source_representation_id,renderer_id,renderer_version,model_json,updated_at) VALUES(?,?,?,?,?,1)")
            .bind(&clip_id)
            .bind(source_id)
            .bind(contribution_id)
            .bind("1.0.0")
            .bind(model_json)
            .execute(&repo.pool)
            .await
            .unwrap();

        let (renderer_id, hydrated) = repo.compact_presentation(&clip_id).await.unwrap().unwrap();
        assert_eq!(renderer_id, contribution_id);
        assert_eq!(hydrated, stored);
        let tag = repo
            .create_tag("batched".into(), Some("#123456".into()))
            .await
            .unwrap();
        repo.tag_clip(&clip_id, &tag.id, true).await.unwrap();
        let page = repo
            .list(ListRequest {
                cursor: None,
                limit: Some(50),
                scope: None,
                tag_id: None,
            })
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(
            page.items[0].history_renderer_id.as_deref(),
            Some(contribution_id)
        );
        assert_eq!(page.items[0].tags.len(), 1);
        assert_eq!(page.items[0].tags[0].id, tag.id);
        assert_eq!(page.items[0].tags[0].name, "batched");
    }

    #[tokio::test]
    async fn persists_atomic_multi_representation_snapshot_and_promotes_duplicate() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let snapshot = CapturedSnapshot {
            token: 1,
            source_app_name: Some("Editor".into()),
            source_app_id: None,
            format_observations: vec![FormatObservation {
                ordinal: 0,
                platform: "windows".into(),
                native_identifier: "CF_UNICODETEXT".into(),
                numeric_id: Some(13),
                medium: Some("HGLOBAL".into()),
                byte_length: Some(12),
                capability_id: Some("windows.text.unicode".into()),
                policy_version: 2,
                decision: "captured".into(),
                reason: "matched_capability".into(),
            }],
            representations: vec![
                CapturedRepresentation {
                    format_key: "windows:CF_UNICODETEXT".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: Some("CF_UNICODETEXT".into()),
                    platform: "windows".into(),
                    capture_priority: 20,
                    payload: CapturedPayload::Text("hello".into()),
                },
                CapturedRepresentation {
                    format_key: "windows:PNG".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: Some("PNG".into()),
                    platform: "windows".into(),
                    capture_priority: 10,
                    payload: CapturedPayload::Binary(vec![1, 2, 3]),
                },
            ],
        };
        let (id, duplicate) = repo
            .capture(snapshot.clone(), &CaptureSettings::default())
            .await
            .unwrap();
        assert!(!duplicate);
        let first = repo.detail(&id).await.unwrap();
        assert_eq!(first.representations.len(), 2);
        assert_eq!(
            first.representations[0].capability_id,
            "windows.text.unicode"
        );
        assert_eq!(first.format_observations.len(), 1);
        repo.note(&id, Some("keep".into())).await.unwrap();
        repo.set_flag(&id, "is_pinned", true).await.unwrap();
        let mut repeated = snapshot;
        repeated.format_observations[0].reason = "refreshed_observation".into();
        let (same, promoted) = repo
            .capture(repeated, &CaptureSettings::default())
            .await
            .unwrap();
        assert_eq!(id, same);
        assert!(promoted);
        let detail = repo.detail(&id).await.unwrap();
        assert_eq!(detail.clip.note.as_deref(), Some("keep"));
        assert!(detail.clip.is_pinned);
        assert_eq!(
            detail.format_observations[0].reason,
            "refreshed_observation"
        );
    }

    #[tokio::test]
    async fn deletion_cascades_owned_rows_files_and_preserves_saved_transform() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let binary = vec![7, 8, 9, 10];
        let source = CapturedSnapshot {
            token: 1,
            source_app_name: None,
            source_app_id: None,
            format_observations: Vec::new(),
            representations: vec![CapturedRepresentation {
                format_key: "windows:PNG".into(),
                canonical_mime_type: Some("image/png".into()),
                native_type: Some("PNG".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Binary(binary),
            }],
        };
        let (source_id, _) = repo
            .capture(source, &CaptureSettings::default())
            .await
            .unwrap();
        let source_representation = repo.detail(&source_id).await.unwrap().representations[0]
            .id
            .clone();
        let canonical_relative: String = sqlx::query_scalar(
            "SELECT b.relative_path FROM clip_binary_files b JOIN clip_representations r ON r.binary_file_id=b.id WHERE r.id=?",
        )
        .bind(&source_representation)
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        let shared = CapturedSnapshot {
            token: 2,
            source_app_name: None,
            source_app_id: None,
            format_observations: Vec::new(),
            representations: vec![
                CapturedRepresentation {
                    format_key: "text/plain".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 2,
                    payload: CapturedPayload::Text("distinct capture".into()),
                },
                CapturedRepresentation {
                    format_key: "windows:PNG".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: Some("PNG".into()),
                    platform: "windows".into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Binary(vec![7, 8, 9, 10]),
                },
            ],
        };
        let (shared_id, _) = repo
            .capture(shared, &CaptureSettings::default())
            .await
            .unwrap();

        let saved = CapturedSnapshot {
            token: 2,
            source_app_name: Some("ClipsX".into()),
            source_app_id: Some("clipsx.transform".into()),
            format_observations: Vec::new(),
            representations: vec![CapturedRepresentation {
                format_key: "text/plain".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: None,
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Text("saved output".into()),
            }],
        };
        let saved_id = repo
            .capture_forced(
                saved,
                &CaptureSettings::default(),
                &TransformProvenance {
                    source_clip_id: source_id.clone(),
                    source_representation_id: source_representation.clone(),
                    transformer_id: "test.transform".into(),
                    transformer_version: "1".into(),
                    parameter_sha256: "a".repeat(64),
                },
            )
            .await
            .unwrap();

        let artifact_relative = "managed/derived/test-artifact";
        let artifact_path = repo.managed_root.join(artifact_relative);
        fs::create_dir_all(artifact_path.parent().unwrap()).unwrap();
        fs::write(&artifact_path, b"derived").unwrap();
        let now = now_ms();
        sqlx::query("INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) VALUES('owned-artifact',?,'thumbnail','test','1',?,?,'ready',?,?)")
            .bind(&source_id).bind("b".repeat(64)).bind("c".repeat(64)).bind(now).bind(now)
            .execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256) VALUES('owned-artifact',0,?,?)")
            .bind(&source_representation).bind("d".repeat(64)).execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO artifact_binary_files(id,artifact_id,sha256,byte_length,relative_path,lifecycle_state,created_at,updated_at) VALUES('owned-file','owned-artifact',?,7,?,'ready',?,?)")
            .bind("e".repeat(64)).bind(artifact_relative).bind(now).bind(now)
            .execute(&repo.pool).await.unwrap();

        repo.delete(&source_id).await.unwrap();

        assert!(repo.detail(&saved_id).await.is_ok());
        let provenance = sqlx::query("SELECT source_clip_id,source_representation_id,source_capture_sha256,source_format_key FROM clip_transform_provenance WHERE clip_id=?")
            .bind(&saved_id).fetch_one(&repo.pool).await.unwrap();
        assert_eq!(provenance.get::<Option<String>, _>(0), None);
        assert_eq!(provenance.get::<Option<String>, _>(1), None);
        assert_eq!(provenance.get::<String, _>(2).len(), 64);
        assert_eq!(provenance.get::<String, _>(3), "windows:PNG");
        assert!(repo.managed_root.join(&canonical_relative).exists());
        assert!(!artifact_path.exists());
        let owned: i64 =
            sqlx::query_scalar("SELECT count(*) FROM artifact_records WHERE owner_clip_id=?")
                .bind(&source_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM system_managed_file_deletions")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(owned, 0);
        assert_eq!(queued, 0);
        repo.delete(&shared_id).await.unwrap();
        assert!(!repo.managed_root.join(canonical_relative).exists());
        let violations = sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&repo.pool)
            .await
            .unwrap();
        assert!(violations.is_empty());
    }

    #[tokio::test]
    async fn history_preview_is_never_generic_and_reflects_leading_representation() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();

        let (text_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![CapturedRepresentation {
                        format_key: "text/plain".into(),
                        canonical_mime_type: Some("text/plain".into()),
                        native_type: None,
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Text("  hello   world  ".into()),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let text_summary = repo.summary(&text_id).await.unwrap();
        assert_eq!(text_summary.history_preview.title, "hello world");
        assert_ne!(text_summary.history_preview.title, "Binary or file content");

        let (image_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 2,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![CapturedRepresentation {
                        format_key: "windows:PNG".into(),
                        canonical_mime_type: Some("image/png".into()),
                        native_type: Some("PNG".into()),
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Binary(vec![1, 2, 3]),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let image_detail = repo.detail(&image_id).await.unwrap();
        assert_eq!(image_detail.clip.history_preview.title, "PNG image");
        assert_ne!(
            image_detail.clip.history_preview.title,
            "Binary or file content"
        );

        let (html_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 3,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![
                        CapturedRepresentation {
                            format_key: "text/html".into(),
                            canonical_mime_type: Some("text/html".into()),
                            native_type: None,
                            platform: "windows".into(),
                            capture_priority: 1,
                            payload: CapturedPayload::Text(
                                "<div><span>markup text</span></div>".into(),
                            ),
                        },
                        CapturedRepresentation {
                            format_key: "text/plain".into(),
                            canonical_mime_type: Some("text/plain".into()),
                            native_type: None,
                            platform: "windows".into(),
                            capture_priority: 2,
                            payload: CapturedPayload::Text("real plain-text sibling".into()),
                        },
                    ],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let html_summary = repo.summary(&html_id).await.unwrap();
        assert_eq!(
            html_summary.history_preview.title,
            "real plain-text sibling"
        );
    }

    #[tokio::test]
    async fn managed_file_gc_records_retryable_failure_and_recovers_missing_files() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        fs::create_dir_all(repo.managed_root.join("managed/not-a-file")).unwrap();
        sqlx::query("INSERT INTO system_managed_file_deletions(relative_path,queued_at) VALUES('managed/not-a-file',?)")
            .bind(now_ms()).execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO system_managed_file_deletions(relative_path,queued_at) VALUES('managed/missing',?)")
            .bind(now_ms()).execute(&repo.pool).await.unwrap();

        repo.drain_managed_file_deletions().await.unwrap();

        let failure: (i64, Option<String>) = sqlx::query_as(
            "SELECT attempt_count,last_error FROM system_managed_file_deletions WHERE relative_path='managed/not-a-file'",
        )
        .fetch_one(&repo.pool).await.unwrap();
        assert_eq!(failure.0, 1);
        assert!(failure.1.is_some());
        let missing: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM system_managed_file_deletions WHERE relative_path='managed/missing'",
        )
        .fetch_one(&repo.pool).await.unwrap();
        assert_eq!(missing, 0);
    }

    #[tokio::test]
    async fn profile_settings_and_sync_outbox_commit_together() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let settings = AppSettings {
            theme: "dark".into(),
            language: "ja".into(),
            excluded_apps: vec!["private-app".into()],
            ..AppSettings::default()
        };

        crate::sync::begin(&repo, "account-a", &new_id(), 1, now_ms(), true)
            .await
            .unwrap();
        sqlx::query("DELETE FROM sync_outbox")
            .execute(&repo.pool)
            .await
            .unwrap();
        repo.update_app_settings(&settings).await.unwrap();

        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT record_key,payload_json,source_device_id FROM sync_outbox ORDER BY record_key",
        )
        .fetch_all(&repo.pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[1].0, "ui.language");
        assert_eq!(rows[1].1, "\"ja\"");
        assert_eq!(rows[3].0, "ui.theme");
        assert_eq!(rows[3].1, "\"dark\"");
        assert_eq!(rows[0].2, rows[1].2);
        assert!(!rows.iter().any(|row| row.1.contains("private-app")));
    }

    #[tokio::test]
    async fn auto_clear_deletes_only_expired_secret_facets() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let snapshot = |token, text: &str| CapturedSnapshot {
            token,
            source_app_name: None,
            source_app_id: None,
            format_observations: Vec::new(),
            representations: vec![CapturedRepresentation {
                format_key: "text/plain".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: None,
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Text(text.into()),
            }],
        };
        let (secret_id, _) = repo
            .capture(snapshot(1, "secret value"), &CaptureSettings::default())
            .await
            .unwrap();
        let (ordinary_id, _) = repo
            .capture(snapshot(2, "ordinary value"), &CaptureSettings::default())
            .await
            .unwrap();
        let representation_id: String =
            sqlx::query_scalar("SELECT id FROM clip_representations WHERE clip_id=? LIMIT 1")
                .bind(&secret_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO content_facet_definitions(id,owner_id,version,display_name) VALUES('core.security.secret','core','1','Secret')")
            .execute(&repo.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO content_clip_facets(clip_id,facet_id,source_representation_id,detector_id,detector_version) VALUES(?,'core.security.secret',?,'builtin.secret','1')")
            .bind(&secret_id)
            .bind(representation_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE clip_items SET captured_at=1 WHERE id IN (?,?)")
            .bind(&secret_id)
            .bind(&ordinary_id)
            .execute(&repo.pool)
            .await
            .unwrap();

        assert_eq!(
            repo.auto_clear_sensitive(2).await.unwrap(),
            vec![secret_id.clone()]
        );
        assert!(repo.detail(&secret_id).await.is_err());
        assert!(repo.detail(&ordinary_id).await.is_ok());
    }
}
