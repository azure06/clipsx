//! Device-local conversations have no dependency on clipboard retention or sync.
use super::{contracts::*, service::ClipboardService};
use crate::history::{new_id, now_ms, sha256, HistoryRepository};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};
use std::path::PathBuf;
use tokio::sync::Mutex;

static ASSETS: Mutex<()> = Mutex::const_new(());
fn bounded_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
        bail!("invalid_message_id");
    }
    Ok(())
}
fn thread(row: &sqlx::sqlite::SqliteRow) -> RecallThread {
    RecallThread {
        id: row.get("id"),
        local_id: row.get("local_id"),
        title: row.get("title"),
        reasoning: row
            .get::<Option<String>, _>("reasoning_json")
            .and_then(|value| serde_json::from_str(&value).ok()),
        archived: row.get("archived"),
        preset_id: row.get("preset_id"),
        web_enabled: row.get("web_enabled"),
        head_message_id: row.get("head_message_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}
pub async fn initialize(repo: &HistoryRepository, local_id: &str) -> Result<RecallThread> {
    bounded_id(local_id)?;
    let now = now_ms();
    sqlx::query("INSERT INTO recall_threads(id,local_id,title,created_at,updated_at) VALUES(?,?,'',?,?) ON CONFLICT(local_id) DO NOTHING").bind(new_id()).bind(local_id).bind(now).bind(now).execute(&repo.pool).await?;
    Ok(thread(
        &sqlx::query("SELECT * FROM recall_threads WHERE local_id=?")
            .bind(local_id)
            .fetch_one(&repo.pool)
            .await?,
    ))
}
pub async fn list(repo: &HistoryRepository, offset: u32) -> Result<Vec<RecallThread>> {
    Ok(
        sqlx::query("SELECT * FROM recall_threads ORDER BY updated_at DESC,id LIMIT 200 OFFSET ?")
            .bind(offset)
            .fetch_all(&repo.pool)
            .await?
            .iter()
            .map(thread)
            .collect(),
    )
}
pub async fn update(repo: &HistoryRepository, request: RecallThreadUpdate) -> Result<RecallThread> {
    if request.title.len() > 256 || request.title.chars().any(char::is_control) {
        bail!("invalid_thread_title");
    }
    if let Some(preset) = &request.preset_id {
        let config = super::configuration::export(repo).await?;
        if !config
            .presets
            .iter()
            .any(|p| p.id == *preset && p.purpose == AiModelPurpose::Chat)
        {
            bail!("missing_chat_preset");
        }
    }
    if let Some(selection) = &request.reasoning {
        let config = super::configuration::export(repo).await?;
        let id = request
            .preset_id
            .as_ref()
            .or(config.selections.default_chat.as_ref())
            .context("missing_chat_preset")?;
        if !super::reasoning::options(repo, id)
            .await?
            .reasoning
            .contains(selection)
        {
            bail!("unsupported_reasoning_option");
        }
    }
    let row = sqlx::query("UPDATE recall_threads SET title=?,archived=?,preset_id=?,web_enabled=?,reasoning_json=?,updated_at=? WHERE id=? RETURNING *").bind(request.title).bind(request.archived).bind(request.preset_id).bind(request.web_enabled).bind(request.reasoning.as_ref().map(serde_json::to_string).transpose()?).bind(now_ms()).bind(request.thread_id).fetch_one(&repo.pool).await?;
    Ok(thread(&row))
}
fn validate_message(message: &RecallMessage) -> Result<()> {
    bounded_id(&message.id)?;
    if let Some(parent) = &message.parent_id {
        bounded_id(parent)?;
        if parent == &message.id {
            bail!("invalid_parent");
        }
    }
    if !matches!(message.role.as_str(), "user" | "assistant")
        || message.content_json.len() > 512 * 1024
        || message.metadata_json.len() > 16 * 1024
        || message.status_json.as_ref().is_some_and(|s| s.len() > 1024)
    {
        bail!("message_limit");
    }
    let parts: Vec<Value> = serde_json::from_str(&message.content_json)?;
    if parts.len() > 128 {
        bail!("message_limit");
    }
    for part in parts {
        match part.get("type").and_then(Value::as_str) {
            Some("text" | "reasoning") if part.get("text").is_some_and(Value::is_string) => {}
            Some("tool-call")
                if message.role == "assistant"
                    && part.get("toolCallId").is_some_and(Value::is_string)
                    && part.get("toolName").is_some_and(Value::is_string) => {}
            Some("source") if part.get("sourceType").and_then(Value::as_str) == Some("url") => {
                let url: url::Url = part
                    .get("url")
                    .and_then(Value::as_str)
                    .context("invalid_source")?
                    .parse()?;
                if !matches!(url.scheme(), "http" | "https")
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    bail!("invalid_source");
                }
            }
            _ => bail!("unsupported_message_part"),
        }
    }
    if !serde_json::from_str::<Value>(&message.metadata_json)?.is_object() {
        bail!("invalid_metadata");
    }
    if let Some(status) = &message.status_json {
        let value: Value = serde_json::from_str(status)?;
        if !matches!(
            value["type"].as_str(),
            Some("running" | "complete" | "incomplete")
        ) {
            bail!("invalid_status");
        }
    }
    Ok(())
}
async fn save_message(
    connection: &mut SqliteConnection,
    thread_id: &str,
    message: &RecallMessage,
) -> Result<()> {
    validate_message(message)?;
    let _: String = sqlx::query_scalar("SELECT id FROM recall_threads WHERE id=?")
        .bind(thread_id)
        .fetch_one(&mut *connection)
        .await?;
    if let Some(parent) = &message.parent_id {
        let _: String =
            sqlx::query_scalar("SELECT id FROM recall_messages WHERE thread_id=? AND id=?")
                .bind(thread_id)
                .bind(parent)
                .fetch_one(&mut *connection)
                .await?;
    }
    let previous = sqlx::query(
        "SELECT parent_id,role,content_json FROM recall_messages WHERE thread_id=? AND id=?",
    )
    .bind(thread_id)
    .bind(&message.id)
    .fetch_optional(&mut *connection)
    .await?;
    if let Some(row) = &previous {
        if row.get::<Option<String>, _>("parent_id") != message.parent_id
            || row.get::<String, _>("role") != message.role
            || (message.role == "user"
                && row.get::<String, _>("content_json") != message.content_json)
        {
            bail!("message_conflict");
        }
    }
    let (count, bytes): (i64,i64) = sqlx::query_as("SELECT COUNT(*),COALESCE(SUM(length(CAST(content_json AS BLOB))+length(CAST(metadata_json AS BLOB))),0) FROM recall_messages WHERE thread_id=? AND id!=?").bind(thread_id).bind(&message.id).fetch_one(&mut *connection).await?;
    if count >= 2000
        || bytes + (message.content_json.len() + message.metadata_json.len()) as i64
            > 16 * 1024 * 1024
    {
        bail!("thread_storage_limit");
    }
    sqlx::query("INSERT INTO recall_messages(thread_id,id,parent_id,role,content_json,status_json,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id,id) DO UPDATE SET content_json=excluded.content_json,status_json=excluded.status_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at").bind(thread_id).bind(&message.id).bind(&message.parent_id).bind(&message.role).bind(&message.content_json).bind(&message.status_json).bind(&message.metadata_json).bind(message.created_at).bind(now_ms()).execute(&mut *connection).await?;
    if previous.is_none() {
        sqlx::query("UPDATE recall_threads SET head_message_id=?,updated_at=? WHERE id=?")
            .bind(&message.id)
            .bind(now_ms())
            .bind(thread_id)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}
pub async fn append(
    repo: &HistoryRepository,
    thread_id: &str,
    message: RecallMessage,
) -> Result<()> {
    let mut transaction = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    save_message(&mut transaction, thread_id, &message).await?;
    transaction.commit().await?;
    Ok(())
}
pub async fn start_run(
    repo: &HistoryRepository,
    request: RecallRunStart,
    context: &AssistantRunContext,
) -> Result<()> {
    if request.run_id != context.run_id {
        bail!("run_conflict");
    }
    let mut transaction = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    let role: String =
        sqlx::query_scalar("SELECT role FROM recall_messages WHERE thread_id=? AND id=?")
            .bind(&request.thread_id)
            .bind(&request.parent_id)
            .fetch_one(&mut *transaction)
            .await?;
    if role != "user" {
        bail!("invalid_run_parent");
    }
    let message = RecallMessage {
        id: request.message_id.clone(),
        parent_id: Some(request.parent_id),
        role: "assistant".into(),
        content_json: "[]".into(),
        status_json: Some("{\"type\":\"running\"}".into()),
        metadata_json: serde_json::to_string(
            &json!({"custom":{"runId":context.run_id,"provider":context.connection.provider,"model":context.preset.model_id,"presetId":context.preset.id,"reasoning":context.reasoning}}),
        )?,
        created_at: now_ms(),
    };
    save_message(&mut transaction, &request.thread_id, &message).await?;
    sqlx::query("INSERT INTO recall_runs(id,thread_id,message_id,context_json,state,started_at) VALUES(?,?,?,?,'running',?)").bind(&request.run_id).bind(&request.thread_id).bind(&request.message_id).bind(serde_json::to_string(context)?).bind(now_ms()).execute(&mut *transaction).await?;
    transaction.commit().await?;
    for source in &context.attachments {
        record_text(repo, &request.run_id, source).await?;
    }
    Ok(())
}
pub async fn checkpoint(repo: &HistoryRepository, request: RecallCheckpoint) -> Result<()> {
    let mut transaction = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    let row = sqlx::query("SELECT * FROM recall_runs WHERE id=?")
        .bind(&request.run_id)
        .fetch_one(&mut *transaction)
        .await?;
    if row.get::<String, _>("state") != "running"
        || row.get::<i64, _>("sequence") >= i64::from(request.sequence)
    {
        return Ok(());
    }
    let thread_id: String = row.get("thread_id");
    let message_id: String = row.get("message_id");
    let saved =
        sqlx::query("SELECT parent_id,created_at FROM recall_messages WHERE thread_id=? AND id=?")
            .bind(&thread_id)
            .bind(&message_id)
            .fetch_one(&mut *transaction)
            .await?;
    let mut message = RecallMessage {
        id: message_id,
        parent_id: saved.get("parent_id"),
        role: "assistant".into(),
        content_json: request.content_json,
        status_json: request.status_json,
        metadata_json: request.metadata_json,
        created_at: saved.get("created_at"),
    };
    let frozen: AssistantRunContext = serde_json::from_str(&row.get::<String, _>("context_json"))?;
    let mut metadata: Value = serde_json::from_str(&message.metadata_json)?;
    if !metadata.is_object() {
        bail!("invalid_metadata");
    }
    if !metadata["custom"].is_object() {
        metadata["custom"] = json!({});
    }
    metadata["custom"]["runId"] = json!(frozen.run_id);
    metadata["custom"]["provider"] = json!(frozen.connection.provider);
    metadata["custom"]["model"] = json!(frozen.preset.model_id);
    metadata["custom"]["presetId"] = json!(frozen.preset.id);
    metadata["custom"]["reasoning"] = json!(frozen.reasoning);
    message.metadata_json = serde_json::to_string(&metadata)?;
    let status: Value = serde_json::from_str(
        message
            .status_json
            .as_deref()
            .unwrap_or("{\"type\":\"running\"}"),
    )?;
    let state = if !request.terminal {
        "running"
    } else if status["type"] == "complete" {
        "completed"
    } else if status["reason"] == "cancelled" {
        "cancelled"
    } else {
        "error"
    };
    if request.terminal && status["type"] == "running" {
        bail!("terminal_status_required");
    }
    save_message(&mut transaction, &thread_id, &message).await?;
    sqlx::query("UPDATE recall_runs SET sequence=?,state=?,finished_at=? WHERE id=?")
        .bind(request.sequence)
        .bind(state)
        .bind(request.terminal.then(now_ms))
        .bind(request.run_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}
pub async fn recover(repo: &HistoryRepository) -> Result<()> {
    let mut transaction = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("UPDATE recall_messages SET status_json='{\"type\":\"incomplete\",\"reason\":\"other\"}',metadata_json=json_set(metadata_json,'$.custom.interrupted',json('true')) WHERE (thread_id,id) IN (SELECT thread_id,message_id FROM recall_runs WHERE state='running')").execute(&mut *transaction).await?;
    sqlx::query("UPDATE recall_runs SET state='interrupted',finished_at=? WHERE state='running'")
        .bind(now_ms())
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    cleanup_assets(repo).await
}
pub async fn load(repo: &HistoryRepository, id: &str) -> Result<RecallHistory> {
    let thread = thread(
        &sqlx::query("SELECT * FROM recall_threads WHERE id=?")
            .bind(id)
            .fetch_one(&repo.pool)
            .await?,
    );
    let messages =
        sqlx::query("SELECT * FROM recall_messages WHERE thread_id=? ORDER BY created_at,rowid")
            .bind(id)
            .fetch_all(&repo.pool)
            .await?
            .iter()
            .map(|r| RecallMessage {
                id: r.get("id"),
                parent_id: r.get("parent_id"),
                role: r.get("role"),
                content_json: r.get("content_json"),
                status_json: r.get("status_json"),
                metadata_json: r.get("metadata_json"),
                created_at: r.get("created_at"),
            })
            .collect();
    let sources = sqlx::query("SELECT s.*,EXISTS(SELECT 1 FROM clip_items c WHERE c.id=s.clip_id AND c.lifecycle_state='ready' AND NOT EXISTS(SELECT 1 FROM content_clip_facets f WHERE f.clip_id=c.id AND f.facet_id IN ('core.security.secret','core.security.private'))) AS available FROM recall_source_snapshots s WHERE thread_id=?").bind(id).fetch_all(&repo.pool).await?.iter().map(|r| RecallSourceSnapshot {id:r.get("id"),message_id:r.get("message_id"),clip_id:r.get("clip_id"),snapshot_json:r.get("snapshot_json"),asset_hash:r.get("asset_hash"),available:r.get("available")}).collect();
    Ok(RecallHistory {
        thread,
        messages,
        sources,
    })
}
pub async fn delete(repo: &HistoryRepository, id: &str) -> Result<()> {
    let running: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM recall_runs WHERE thread_id=? AND state='running'",
    )
    .bind(id)
    .fetch_one(&repo.pool)
    .await?;
    if running > 0 {
        bail!("stop_run_before_deleting_thread");
    }
    sqlx::query("DELETE FROM recall_threads WHERE id=?")
        .bind(id)
        .execute(&repo.pool)
        .await?;
    cleanup_assets(repo).await
}
pub async fn record_text(
    repo: &HistoryRepository,
    run_id: &str,
    source: &ClipReadResult,
) -> Result<()> {
    record_source(
        repo,
        run_id,
        &source.clip.id,
        &serde_json::to_string(source)?,
        None,
    )
    .await
}
async fn record_source(
    repo: &HistoryRepository,
    run_id: &str,
    clip_id: &str,
    snapshot: &str,
    hash: Option<&str>,
) -> Result<()> {
    if snapshot.len() > 128 * 1024 {
        bail!("source_snapshot_limit");
    }
    let mut transaction = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    let Some(run) = sqlx::query("SELECT thread_id,message_id FROM recall_runs WHERE id=?")
        .bind(run_id)
        .fetch_optional(&mut *transaction)
        .await?
    else {
        return Ok(());
    };
    let thread_id: String = run.get("thread_id");
    let message_id: String = run.get("message_id");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM recall_source_snapshots WHERE thread_id=? AND message_id=?",
    )
    .bind(&thread_id)
    .bind(&message_id)
    .fetch_one(&mut *transaction)
    .await?;
    if count >= 32 {
        return Ok(());
    }
    let bytes: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(length(CAST(snapshot_json AS BLOB))),0) FROM recall_source_snapshots WHERE thread_id=?")
        .bind(&thread_id).fetch_one(&mut *transaction).await?;
    if bytes + snapshot.len() as i64 > 8 * 1024 * 1024 {
        return Ok(());
    }
    sqlx::query("INSERT INTO recall_source_snapshots(thread_id,message_id,id,clip_id,snapshot_json,asset_hash) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING").bind(thread_id).bind(message_id).bind(sha256(snapshot.as_bytes())).bind(clip_id).bind(snapshot).bind(hash).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(())
}
fn asset_root(repo: &HistoryRepository) -> PathBuf {
    repo.managed_root
        .parent()
        .unwrap_or(&repo.managed_root)
        .join("recall-attachments")
}
pub async fn record_image(
    repo: &HistoryRepository,
    run_id: &str,
    image: &ClipImageResult,
) -> Result<()> {
    let _guard = ASSETS.lock().await;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM recall_runs WHERE id=?)")
        .bind(run_id)
        .fetch_one(&repo.pool)
        .await?;
    if !exists {
        return Ok(());
    }
    let root = asset_root(repo);
    std::fs::create_dir_all(&root)?;
    if std::fs::symlink_metadata(&root)?.file_type().is_symlink() {
        bail!("invalid_attachment_storage");
    }
    let bytes = STANDARD.decode(&image.data)?;
    if bytes.len() > 4 * 1024 * 1024 {
        bail!("image_snapshot_limit");
    }
    let hash = sha256(&bytes);
    let path = root.join(&hash);
    if path.exists() {
        let metadata = std::fs::symlink_metadata(&path)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > 4 * 1024 * 1024
            || sha256(&std::fs::read(&path)?) != hash
        {
            bail!("attachment_changed");
        }
    } else {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new_in(&root)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist(&path)?;
    }
    let mut snapshot = serde_json::to_value(image)?;
    snapshot.as_object_mut().unwrap().remove("data");
    record_source(
        repo,
        run_id,
        &image.clip_id,
        &serde_json::to_string(&snapshot)?,
        Some(&hash),
    )
    .await
}
pub async fn read_snapshot_image(
    repo: &HistoryRepository,
    thread_id: &str,
    snapshot_id: &str,
) -> Result<String> {
    let _guard = ASSETS.lock().await;
    let hash: String=sqlx::query_scalar("SELECT asset_hash FROM recall_source_snapshots WHERE thread_id=? AND id=? AND asset_hash IS NOT NULL").bind(thread_id).bind(snapshot_id).fetch_one(&repo.pool).await?;
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("invalid_attachment_hash");
    }
    let root = asset_root(repo);
    if std::fs::symlink_metadata(&root)?.file_type().is_symlink() {
        bail!("invalid_attachment_storage");
    }
    let path = root.join(&hash);
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4 * 1024 * 1024
    {
        bail!("invalid_attachment_storage");
    }
    let bytes = std::fs::read(path)?;
    if sha256(&bytes) != hash {
        bail!("attachment_changed");
    }
    Ok(STANDARD.encode(bytes))
}
pub async fn cleanup_assets(repo: &HistoryRepository) -> Result<()> {
    let _guard = ASSETS.lock().await;
    let root = asset_root(repo);
    if !root.exists() {
        return Ok(());
    }
    if std::fs::symlink_metadata(&root)?.file_type().is_symlink() {
        bail!("invalid_attachment_storage");
    }
    let referenced: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT asset_hash FROM recall_source_snapshots WHERE asset_hash IS NOT NULL",
    )
    .fetch_all(&repo.pool)
    .await?;
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = entry.file_type()?;
        if name.len() == 64
            && name.bytes().all(|b| b.is_ascii_hexdigit())
            && !referenced.contains(&name)
            && (metadata.is_file() || metadata.is_symlink())
        {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

// Used by native tools: snapshots are recorded from verified service results, not renderer claims.
pub async fn record_read(
    repo: &HistoryRepository,
    run_id: &str,
    request: ClipReadRequest,
) -> Result<ClipReadResult> {
    let result = ClipboardService::new(repo.clone()).read(request).await?;
    record_text(repo, run_id, &result).await?;
    Ok(result)
}
