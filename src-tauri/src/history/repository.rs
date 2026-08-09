use super::domain::*;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqlitePoolOptions, AssertSqlSafe, Row, SqlitePool};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const CAPTURE_FINGERPRINT_VERSION: &str = "clipsx-capture-v1";

#[derive(Clone)]
pub struct HistoryRepository {
    pub pool: SqlitePool,
    managed_root: PathBuf,
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
        fs::create_dir_all(&managed_root)?;
        let url = format!("sqlite://{}?mode=rwc", database.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await?;
        let repository = Self { pool, managed_root };
        repository.recover_managed_files().await?;
        Ok(repository)
    }
    pub async fn capture(
        &self,
        snapshot: CapturedSnapshot,
        settings: &CaptureSettings,
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
        if let Some(row) = sqlx::query(
            "SELECT id FROM clip_items WHERE capture_sha256=? AND lifecycle_state='ready'",
        )
        .bind(&fingerprint)
        .fetch_optional(&mut *tx)
        .await?
        {
            let id: String = row.get(0);
            sqlx::query("UPDATE clip_items SET captured_at=?, updated_at=?, source_app_name=?, source_app_id=? WHERE id=?").bind(now).bind(now).bind(snapshot.source_app_name).bind(snapshot.source_app_id).bind(&id).execute(&mut *tx).await?;
            tx.commit().await?;
            return Ok((id, true));
        }
        let id = new_id();
        sqlx::query("INSERT INTO clip_items(id,source_app_name,source_app_id,captured_at,updated_at,lifecycle_state,capture_sha256,total_payload_bytes) VALUES(?,?,?,?,?,'pending',?,?)").bind(&id).bind(snapshot.source_app_name).bind(snapshot.source_app_id).bind(now).bind(now).bind(&fingerprint).bind(total as i64).execute(&mut *tx).await?;
        for (ordinal, rep) in snapshot.representations.iter().enumerate() {
            self.insert_representation(&mut tx, &id, ordinal as i64, rep, now)
                .await?;
        }
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
        let (kind, binary_id) = match &rep.payload {
            CapturedPayload::Text(value) => {
                sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,native_type,platform,storage_kind,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?, 'text',?,?, 'pending',?,?)").bind(&id).bind(clip_id).bind(&rep.format_key).bind(&rep.canonical_mime_type).bind(&rep.native_type).bind(&rep.platform).bind(ordinal).bind(rep.capture_priority).bind(now).bind(now).execute(&mut **tx).await?;
                sqlx::query("INSERT INTO clip_text_values(representation_id,text_value,utf8_byte_length,sha256) VALUES(?,?,?,?)").bind(&id).bind(value).bind(value.len() as i64).bind(sha256(value.as_bytes())).execute(&mut **tx).await?;
                ("text", None)
            }
            CapturedPayload::Files(files) => {
                sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,native_type,platform,storage_kind,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?, 'file_list',?,?, 'pending',?,?)").bind(&id).bind(clip_id).bind(&rep.format_key).bind(&rep.canonical_mime_type).bind(&rep.native_type).bind(&rep.platform).bind(ordinal).bind(rep.capture_priority).bind(now).bind(now).execute(&mut **tx).await?;
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
                sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,native_type,platform,storage_kind,binary_file_id,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?, 'binary_asset',?,?,?, 'pending',?,?)").bind(&id).bind(clip_id).bind(&rep.format_key).bind(&rep.canonical_mime_type).bind(&rep.native_type).bind(&rep.platform).bind(&actual).bind(ordinal).bind(rep.capture_priority).bind(now).bind(now).execute(&mut **tx).await?;
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
        let limit = request.limit.unwrap_or(50).clamp(1, 100) as i64;
        let scope = request.scope.unwrap_or_else(|| "all".into());
        let mut query = String::from("SELECT c.id,c.source_app_name,c.source_app_id,c.captured_at,c.updated_at,c.is_pinned,c.is_favorite,c.note,(SELECT count(*) FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready'),COALESCE((SELECT substr(t.text_value,1,180) FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id WHERE r.clip_id=c.id AND r.lifecycle_state='ready' ORDER BY r.ordinal LIMIT 1),'Binary or file content') FROM clip_items c WHERE c.lifecycle_state='ready'");
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
        let mut items = Vec::new();
        for row in rows.into_iter().take(limit as usize) {
            items.push(self.summary_from_row(row).await?);
        }
        let next_cursor = if has_more {
            items.last().map(|x| format!("{}|{}", x.captured_at, x.id))
        } else {
            None
        };
        Ok(ClipPage { items, next_cursor })
    }
    async fn summary_from_row(&self, row: sqlx::sqlite::SqliteRow) -> Result<ClipSummary> {
        let id: String = row.get(0);
        let tags = self.tags_for(&id).await?;
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
            safe_summary: row.get(9),
            tags,
        })
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
    pub async fn detail(&self, id: &str) -> Result<ClipDetail> {
        let row=sqlx::query("SELECT c.id,c.source_app_name,c.source_app_id,c.captured_at,c.updated_at,c.is_pinned,c.is_favorite,c.note,(SELECT count(*) FROM clip_representations r WHERE r.clip_id=c.id AND r.lifecycle_state='ready'),COALESCE((SELECT substr(t.text_value,1,180) FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id WHERE r.clip_id=c.id AND r.lifecycle_state='ready' ORDER BY r.ordinal LIMIT 1),'Binary or file content') FROM clip_items c WHERE c.id=? AND c.lifecycle_state='ready'").bind(id).fetch_optional(&self.pool).await?.context("clip not found")?;
        let reps=sqlx::query("SELECT r.id,r.format_key,r.canonical_mime_type,r.native_type,r.storage_kind,r.ordinal,COALESCE(t.utf8_byte_length,b.byte_length,0),t.text_value,b.id,b.sha256 FROM clip_representations r LEFT JOIN clip_text_values t ON t.representation_id=r.id LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id AND b.lifecycle_state='ready' WHERE r.clip_id=? AND r.lifecycle_state='ready' ORDER BY r.ordinal").bind(id).fetch_all(&self.pool).await?;
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
                byte_length: r.get(6),
                text_value: r.get(7),
                binary_file_id: r.get(8),
                sha256: r.get(9),
                file_references: files,
            });
        }
        Ok(ClipDetail {
            clip: self.summary_from_row(row).await?,
            representations,
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
        sqlx::query("DELETE FROM clip_items WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        self.cleanup_orphans().await
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
            sqlx::query("INSERT INTO config_device_values(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(k).bind(v).bind(now_ms()).execute(&self.pool).await?;
        }
        self.enforce_retention(s).await
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
        let files=sqlx::query("SELECT id,relative_path FROM clip_binary_files WHERE NOT EXISTS(SELECT 1 FROM clip_representations r WHERE r.binary_file_id=clip_binary_files.id)").fetch_all(&self.pool).await?;
        for f in files {
            let id: String = f.get(0);
            let relative: String = f.get(1);
            if safe_relative(&relative) {
                let _ = fs::remove_file(self.managed_root.join(relative));
            }
            sqlx::query("DELETE FROM clip_binary_files WHERE id=?")
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
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
        let rows = sqlx::query("SELECT id,sha256,relative_path FROM clip_binary_files WHERE lifecycle_state IN ('pending','ready')").fetch_all(&self.pool).await?;
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
        self.cleanup_orphans().await?;
        let known: std::collections::HashSet<String> =
            sqlx::query_scalar("SELECT relative_path FROM clip_binary_files")
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
        assert!(!safe_relative("C:\\x"));
        assert!(safe_relative("managed/a/file"));
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
        assert_eq!(repo.detail(&id).await.unwrap().representations.len(), 2);
        repo.note(&id, Some("keep".into())).await.unwrap();
        repo.set_flag(&id, "is_pinned", true).await.unwrap();
        let (same, promoted) = repo
            .capture(snapshot, &CaptureSettings::default())
            .await
            .unwrap();
        assert_eq!(id, same);
        assert!(promoted);
        let detail = repo.detail(&id).await.unwrap();
        assert_eq!(detail.clip.note.as_deref(), Some("keep"));
        assert!(detail.clip.is_pinned);
    }
}
