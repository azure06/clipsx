use anyhow::{bail, Context, Result};
use arboard::{Clipboard, ImageData};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqlitePoolOptions, AssertSqlSafe, Row, SqlitePool};
use std::{
    fs,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSettings {
    pub max_ordinary_clips: Option<u32>,
    pub max_age_days: Option<u32>,
    pub max_managed_bytes: Option<u64>,
    pub max_representation_bytes: Option<u64>,
    pub max_snapshot_bytes: Option<u64>,
}
impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            max_ordinary_clips: Some(1000),
            max_age_days: None,
            max_managed_bytes: Some(1_073_741_824),
            max_representation_bytes: Some(52_428_800),
            max_snapshot_bytes: Some(104_857_600),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    pub id: String,
    pub source_app_name: Option<String>,
    pub source_app_id: Option<String>,
    pub captured_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub note: Option<String>,
    pub tags: Vec<Tag>,
    pub safe_summary: String,
    pub representation_count: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPage {
    pub items: Vec<ClipSummary>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDetail {
    pub clip: ClipSummary,
    pub representations: Vec<RepresentationDetail>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepresentationDetail {
    pub id: String,
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub storage_kind: String,
    pub ordinal: i64,
    pub byte_length: i64,
    pub text_value: Option<String>,
    pub file_references: Vec<String>,
    pub binary_file_id: Option<String>,
    pub sha256: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub scope: Option<String>,
    pub tag_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum CapturedPayload {
    Text(String),
    Binary(Vec<u8>),
    Files(Vec<String>),
}
#[derive(Debug, Clone)]
pub struct CapturedRepresentation {
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub platform: String,
    pub capture_priority: i64,
    pub payload: CapturedPayload,
}
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct CapturedSnapshot {
    pub token: u64,
    pub source_app_name: Option<String>,
    pub source_app_id: Option<String>,
    pub representations: Vec<CapturedRepresentation>,
}

#[allow(dead_code)]
pub trait ClipboardAdapter: Send {
    fn snapshot_token(&mut self) -> Result<u64>;
    fn capture(&mut self) -> Result<CapturedSnapshot>;
    fn write(&mut self, representations: &[RepresentationDetail]) -> Result<()>;
}
pub struct SystemClipboardAdapter {
    last_token: u64,
}
impl SystemClipboardAdapter {
    pub fn new() -> Self {
        Self { last_token: 0 }
    }
}
impl ClipboardAdapter for SystemClipboardAdapter {
    fn snapshot_token(&mut self) -> Result<u64> {
        // arboard deliberately abstracts platform tokens. The fingerprint still prevents repeated
        // captures; platform-specific adapters can replace this boundary without touching storage.
        Ok(self.last_token)
    }
    fn capture(&mut self) -> Result<CapturedSnapshot> {
        let mut clipboard = Clipboard::new().context("clipboard unavailable")?;
        let mut reps = Vec::new();
        if let Ok(text) = clipboard.get_text() {
            if !text.is_empty() {
                reps.push(CapturedRepresentation {
                    format_key: "text/plain".into(),
                    canonical_mime_type: Some("text/plain;charset=utf-8".into()),
                    native_type: None,
                    platform: platform_name().into(),
                    capture_priority: 100,
                    payload: CapturedPayload::Text(text),
                });
            }
        }
        if let Ok(image) = clipboard.get_image() {
            let bytes = encode_png(image)?;
            reps.push(CapturedRepresentation {
                format_key: "image/png".into(),
                canonical_mime_type: Some("image/png".into()),
                native_type: None,
                platform: platform_name().into(),
                capture_priority: 200,
                payload: CapturedPayload::Binary(bytes),
            });
        }
        if reps.is_empty() {
            bail!("clipboard has no supported representations")
        }
        self.last_token = self.last_token.wrapping_add(1);
        Ok(CapturedSnapshot {
            token: self.last_token,
            source_app_name: None,
            source_app_id: None,
            representations: reps,
        })
    }
    fn write(&mut self, representations: &[RepresentationDetail]) -> Result<()> {
        let mut clipboard = Clipboard::new().context("clipboard unavailable")?;
        if let Some(text) = representations.iter().find_map(|r| r.text_value.as_ref()) {
            clipboard.set_text(text.clone())?;
            return Ok(());
        }
        bail!("no writeable representation is available")
    }
}

fn encode_png(image: ImageData<'_>) -> Result<Vec<u8>> {
    // Kept as a byte-exact managed asset after this one normalization boundary.
    let mut output = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut output);
    use image::ImageEncoder;
    encoder.write_image(
        &image.bytes,
        image
            .width
            .try_into()
            .context("clipboard image width exceeds u32")?,
        image
            .height
            .try_into()
            .context("clipboard image height exceeds u32")?,
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(output)
}
fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux_x11"
    }
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
        Ok(Self { pool, managed_root })
    }
    pub async fn capture(
        &self,
        snapshot: CapturedSnapshot,
        settings: &CaptureSettings,
    ) -> Result<(String, bool)> {
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
                    fs::write(&temporary, bytes)?;
                    fs::rename(temporary, &full)?;
                }
                let binary_id = new_id();
                sqlx::query("INSERT INTO clip_binary_files(id,sha256,byte_length,relative_path,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?, 'ready',?,?) ON CONFLICT(sha256) DO NOTHING").bind(&binary_id).bind(&hash).bind(bytes.len() as i64).bind(relative.to_string_lossy().to_string()).bind(now).bind(now).execute(&mut **tx).await?;
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
}
fn payload_len(r: &CapturedRepresentation) -> u64 {
    match &r.payload {
        CapturedPayload::Text(v) => v.len() as u64,
        CapturedPayload::Binary(v) => v.len() as u64,
        CapturedPayload::Files(v) => v.iter().map(|x| x.len() as u64).sum(),
    }
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
}
