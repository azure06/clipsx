use crate::history::{new_id, now_ms, HistoryRepository};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, Sqlite, Transaction};

pub mod contract;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub enabled: bool,
    pub active_user_id: Option<String>,
    pub device_id: String,
    pub device_name: String,
    pub generation: i64,
    pub local_epoch: i64,
    pub server_cursor: i64,
    pub pending_records: i64,
    pub quarantined_records: i64,
    pub pending_effects: i64,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBatch {
    pub protocol_version: i64,
    pub generation: i64,
    pub user_id: String,
    pub local_epoch: i64,
    pub device_id: String,
    pub after_cursor: i64,
    pub records: Vec<Value>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRemoteRecord {
    pub kind: String,
    pub key: String,
    pub payload: Option<Value>,
    pub tombstone: bool,
    pub source_device_id: String,
    pub revision_physical_ms: i64,
    pub revision_counter: i64,
    pub server_cursor: i64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncServerResponse {
    pub protocol_version: i64,
    pub user_id: String,
    pub device_id: String,
    pub generation: i64,
    pub local_epoch: i64,
    pub server_time_ms: i64,
    pub cursor: i64,
    pub records: Vec<Value>,
    pub acknowledgements: Vec<Value>,
    pub has_more: bool,
}
async fn ensure_device(repo: &HistoryRepository) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO sync_device_identity(singleton,device_id,display_name,created_at) VALUES(1,?,'This device',?)")
        .bind(new_id()).bind(now_ms()).execute(&repo.pool).await?;
    Ok(())
}
pub async fn status(repo: &HistoryRepository) -> Result<SyncStatus> {
    ensure_device(repo).await?;
    let r = sqlx::query("SELECT r.*,d.device_id,d.display_name FROM sync_remote_state r,sync_device_identity d WHERE r.singleton=1 AND d.singleton=1").fetch_one(&repo.pool).await?;
    let user: Option<String> = r.get("active_user_id");
    let generation: i64 = r.get("generation");
    Ok(SyncStatus {
        enabled: r.get::<i64, _>("enabled") != 0,
        active_user_id: user.clone(),
        device_id: r.get("device_id"),
        device_name: r.get("display_name"),
        generation,
        local_epoch: r.get("local_epoch"),
        server_cursor: r.get("server_cursor"),
        pending_records: sqlx::query_scalar(
            "SELECT count(*) FROM sync_outbox WHERE user_id=? AND generation=?",
        )
        .bind(&user)
        .bind(generation)
        .fetch_one(&repo.pool)
        .await?,
        quarantined_records: sqlx::query_scalar(
            "SELECT count(*) FROM sync_remote_quarantine WHERE user_id=? AND generation=?",
        )
        .bind(&user)
        .bind(generation)
        .fetch_one(&repo.pool)
        .await?,
        pending_effects: sqlx::query_scalar("SELECT count(*) FROM sync_pending_effects")
            .fetch_one(&repo.pool)
            .await?,
        last_attempt_at: r.get("last_attempt_at"),
        last_success_at: r.get("last_success_at"),
        last_error: r.get("last_error"),
    })
}
pub async fn set_enabled(repo: &HistoryRepository, user_id: &str, enabled: bool) -> Result<()> {
    // Enabling must go through begin(), after authenticated enrollment and an
    // explicit restore decision. Disabling is also called by the auth lifecycle.
    if enabled {
        bail!("Choose cloud settings or this device before enabling sync");
    }
    sqlx::query("UPDATE sync_remote_state SET enabled=0,local_epoch=local_epoch+1,updated_at=? WHERE active_user_id=?")
        .bind(now_ms()).bind(user_id).execute(&repo.pool).await?;
    Ok(())
}

pub async fn set_applying_remote(repo: &HistoryRepository, applying: bool) -> Result<()> {
    sqlx::query("UPDATE sync_remote_state SET applying_remote=? WHERE singleton=1")
        .bind(applying)
        .execute(&repo.pool)
        .await?;
    Ok(())
}
pub async fn begin(
    repo: &HistoryRepository,
    user_id: &str,
    device_id: &str,
    generation: i64,
    server_time_ms: i64,
    upload: bool,
) -> Result<SyncStatus> {
    if user_id.is_empty() || generation < 1 || server_time_ms < 1 {
        bail!("Invalid sync enrollment");
    }
    ensure_device(repo).await?;
    let mut tx = repo.pool.begin().await?;
    sqlx::query("UPDATE sync_remote_state SET enabled=0,applying_remote=1,active_user_id=?,generation=?,server_cursor=0,local_epoch=local_epoch+1,clock_offset_ms=?,last_error=NULL,last_success_at=NULL WHERE singleton=1")
        .bind(user_id).bind(generation).bind(server_time_ms-now_ms()).execute(&mut *tx).await?;
    sqlx::query("UPDATE sync_device_identity SET device_id=?,last_physical_ms=?,last_logical_counter=0 WHERE singleton=1")
        .bind(device_id).bind(server_time_ms).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sync_outbox WHERE user_id=?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sync_revisions WHERE user_id=?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sync_pending_effects")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sync_bootstrap_records")
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE sync_remote_state SET restoring=? WHERE singleton=1")
        .bind(!upload)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE sync_remote_state SET enabled=1,applying_remote=0 WHERE singleton=1")
        .execute(&mut *tx)
        .await?;
    if upload {
        sqlx::query("INSERT INTO sync_outbox(user_id,generation,record_kind,record_key,payload_json,tombstone,revision_physical_ms,revision_counter,source_device_id,created_at,updated_at) SELECT ?,?,record_kind,record_key,payload_json,tombstone,?,0,?,?,? FROM sync_values")
            .bind(user_id).bind(generation).bind(server_time_ms).bind(device_id).bind(now_ms()).bind(now_ms()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    status(repo).await
}
pub async fn batch(repo: &HistoryRepository) -> Result<SyncBatch> {
    let s = status(repo).await?;
    if !s.enabled {
        bail!("Configuration sync is disabled");
    }
    let user = s.active_user_id.context("Sync account missing")?;
    let rows=sqlx::query("SELECT * FROM sync_outbox WHERE (SELECT restoring FROM sync_remote_state)=0 AND user_id=? AND generation=? AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY updated_at,record_kind,record_key LIMIT 100")
        .bind(&user).bind(s.generation).bind(now_ms()).fetch_all(&repo.pool).await?;
    let mut records = Vec::new();
    let mut bytes = 0;
    for r in rows {
        let payload: Option<String> = r.get("payload_json");
        let v = json!({"kind":r.get::<String,_>("record_kind"),"key":r.get::<String,_>("record_key"),"payload":payload.map(|p|serde_json::from_str::<Value>(&p)).transpose()?,"tombstone":r.get::<i64,_>("tombstone")!=0,"revisionPhysicalMs":r.get::<i64,_>("revision_physical_ms"),"revisionCounter":r.get::<i64,_>("revision_counter")});
        bytes += v.to_string().len();
        if bytes > 900_000 {
            break;
        }
        records.push(v);
    }
    sqlx::query("UPDATE sync_remote_state SET last_attempt_at=? WHERE singleton=1")
        .bind(now_ms())
        .execute(&repo.pool)
        .await?;
    Ok(SyncBatch {
        protocol_version: 1,
        generation: s.generation,
        user_id: user,
        local_epoch: s.local_epoch,
        device_id: s.device_id,
        after_cursor: s.server_cursor,
        records,
    })
}
async fn quarantine(
    tx: &mut Transaction<'_, Sqlite>,
    s: &SyncServerResponse,
    v: &Value,
    reason: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO sync_remote_quarantine(id,user_id,generation,record_kind,record_key,payload_json,reason,quarantined_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(new_id()).bind(&s.user_id).bind(s.generation).bind(v.get("kind").and_then(Value::as_str)).bind(v.get("key").and_then(Value::as_str))
        .bind(v.to_string()).bind(reason).bind(now_ms()).execute(&mut **tx).await?;
    Ok(())
}
async fn apply_record(
    tx: &mut Transaction<'_, Sqlite>,
    s: &SyncServerResponse,
    r: &SyncRemoteRecord,
) -> Result<()> {
    let remote = (
        r.revision_physical_ms,
        r.revision_counter,
        r.source_device_id.clone(),
    );
    let local:Option<(i64,i64,String)>=sqlx::query_as("SELECT revision_physical_ms,revision_counter,source_device_id FROM sync_outbox WHERE user_id=? AND generation=? AND record_kind=? AND record_key=? UNION ALL SELECT revision_physical_ms,revision_counter,source_device_id FROM sync_revisions WHERE user_id=? AND generation=? AND record_kind=? AND record_key=? ORDER BY 1 DESC,2 DESC,3 DESC LIMIT 1")
        .bind(&s.user_id).bind(s.generation).bind(&r.kind).bind(&r.key).bind(&s.user_id).bind(s.generation).bind(&r.kind).bind(&r.key).fetch_optional(&mut **tx).await?;
    if local.is_some_and(|l| l > remote) {
        return Ok(());
    }
    let payload = r.payload.as_ref().map(Value::to_string);
    sqlx::query("INSERT INTO sync_values VALUES(?,?,?,?) ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone")
        .bind(&r.kind).bind(&r.key).bind(&payload).bind(r.tombstone).execute(&mut **tx).await?;
    match r.kind.as_str() {
        "profile_setting" => {
            if r.tombstone {
                sqlx::query("DELETE FROM config_profile_values WHERE key=?")
                    .bind(&r.key)
                    .execute(&mut **tx)
                    .await?;
            } else {
                sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(&r.key).bind(&payload).bind(now_ms()).bind(now_ms()).execute(&mut **tx).await?;
            }
        }
        "renderer_preference" => {
            let raw: Option<String> = sqlx::query_scalar(
                "SELECT value_json FROM config_profile_values WHERE key='renderer.preferences'",
            )
            .fetch_optional(&mut **tx)
            .await?;
            let mut prefs: Value = raw
                .map(|v| serde_json::from_str(&v))
                .transpose()?
                .unwrap_or(json!({}));
            let (prefix, key) = r.key.split_once(':').context("Invalid renderer target")?;
            let field = match prefix {
                "mime" => "byMimeType",
                "facet" => "byFacetId",
                _ => "byCapabilityId",
            };
            if !prefs[field].is_object() {
                prefs[field] = json!({});
            }
            if r.tombstone {
                prefs[field].as_object_mut().unwrap().remove(key);
            } else {
                prefs[field][key] = r.payload.clone().unwrap();
            }
            sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('renderer.preferences',?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(prefs.to_string()).bind(now_ms()).bind(now_ms()).execute(&mut **tx).await?;
        }
        _ => {
            sqlx::query("INSERT INTO sync_pending_effects(record_kind,record_key,payload_json,tombstone) VALUES(?,?,?,?) ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone,reason='Waiting for package or command'").bind(&r.kind).bind(&r.key).bind(&payload).bind(r.tombstone).execute(&mut **tx).await?;
        }
    }
    sqlx::query("INSERT INTO sync_revisions VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,generation,record_kind,record_key) DO UPDATE SET revision_physical_ms=excluded.revision_physical_ms,revision_counter=excluded.revision_counter,source_device_id=excluded.source_device_id")
        .bind(&s.user_id).bind(s.generation).bind(&r.kind).bind(&r.key).bind(r.revision_physical_ms).bind(r.revision_counter).bind(&r.source_device_id).execute(&mut **tx).await?;
    // Observe the received HLC before any subsequent local mutation.
    sqlx::query("UPDATE sync_device_identity SET last_logical_counter=CASE WHEN last_physical_ms=? THEN max(last_logical_counter,?) WHEN last_physical_ms<? THEN ? ELSE last_logical_counter END,last_physical_ms=max(last_physical_ms,?) WHERE singleton=1")
        .bind(r.revision_physical_ms).bind(r.revision_counter).bind(r.revision_physical_ms).bind(r.revision_counter).bind(r.revision_physical_ms).execute(&mut **tx).await?;
    Ok(())
}
pub async fn apply(repo: &HistoryRepository, response: SyncServerResponse) -> Result<SyncStatus> {
    if response.has_more && response.records.is_empty() {
        bail!("Empty sync continuation page");
    }
    if response.protocol_version != 1
        || response.cursor < 0
        || response.records.len() > 100
        || response.acknowledgements.len() > 100
    {
        bail!("Invalid sync response");
    }
    let mut tx = repo.pool.begin().await?;
    // Acquire the SQLite write lock before checking session/generation identity.
    sqlx::query("UPDATE sync_remote_state SET applying_remote=1 WHERE singleton=1")
        .execute(&mut *tx)
        .await?;
    let r = sqlx::query("SELECT * FROM sync_remote_state WHERE singleton=1")
        .fetch_one(&mut *tx)
        .await?;
    let current_device: String =
        sqlx::query_scalar("SELECT device_id FROM sync_device_identity WHERE singleton=1")
            .fetch_one(&mut *tx)
            .await?;
    if r.get::<i64, _>("enabled") == 0
        || r.get::<Option<String>, _>("active_user_id").as_deref() != Some(&response.user_id)
        || r.get::<i64, _>("generation") != response.generation
        || r.get::<i64, _>("local_epoch") != response.local_epoch
        || current_device != response.device_id
    {
        tx.rollback().await?;
        return status(repo).await;
    }
    let cursor: i64 = r.get("server_cursor");
    if response.cursor < cursor {
        bail!("Sync cursor moved backwards");
    }
    for ack in &response.acknowledgements {
        let kind = ack["kind"].as_str().unwrap_or("");
        let key = ack["key"].as_str().unwrap_or("");
        let physical = ack["revisionPhysicalMs"].as_i64().unwrap_or(-1);
        let counter = ack["revisionCounter"].as_i64().unwrap_or(-1);
        let outcome = ack["status"].as_str().unwrap_or("invalid");
        if outcome == "clock_skew" {
            sqlx::query("UPDATE sync_device_identity SET last_physical_ms=?,last_logical_counter=last_logical_counter+1 WHERE singleton=1").bind(response.server_time_ms).execute(&mut *tx).await?;
            sqlx::query("UPDATE sync_outbox SET revision_physical_ms=?,revision_counter=(SELECT last_logical_counter FROM sync_device_identity),next_attempt_at=NULL WHERE user_id=? AND generation=? AND record_kind=? AND record_key=? AND revision_physical_ms=? AND revision_counter=?")
                .bind(response.server_time_ms).bind(&response.user_id).bind(response.generation).bind(kind).bind(key).bind(physical).bind(counter).execute(&mut *tx).await?;
            continue;
        }
        if outcome == "invalid" {
            quarantine(
                &mut tx,
                &response,
                ack,
                "Server rejected the upload; local setting retained",
            )
            .await?;
        }
        if let Ok(winner) = serde_json::from_value::<SyncRemoteRecord>(ack["winner"].clone()) {
            if contract::valid_record(&winner) {
                apply_record(&mut tx, &response, &winner).await?;
            }
        }
        sqlx::query("DELETE FROM sync_outbox WHERE user_id=? AND generation=? AND record_kind=? AND record_key=? AND revision_physical_ms=? AND revision_counter=?")
            .bind(&response.user_id).bind(response.generation).bind(kind).bind(key).bind(physical).bind(counter).execute(&mut *tx).await?;
    }
    let restoring = r.get::<i64, _>("restoring") != 0;
    let mut previous = cursor;
    for v in &response.records {
        let record_cursor = v
            .get("serverCursor")
            .and_then(Value::as_i64)
            .context("Remote record has no cursor")?;
        if record_cursor <= previous || record_cursor > response.cursor {
            bail!("Invalid sync page ordering");
        }
        previous = record_cursor;
        if restoring {
            sqlx::query("INSERT INTO sync_bootstrap_records VALUES(?,?)")
                .bind(record_cursor)
                .bind(v.to_string())
                .execute(&mut *tx)
                .await?;
        } else {
            match serde_json::from_value::<SyncRemoteRecord>(v.clone()) {
                Ok(record) if contract::valid_record(&record) => {
                    apply_record(&mut tx, &response, &record).await?
                }
                _ => {
                    quarantine(
                        &mut tx,
                        &response,
                        v,
                        "Unsupported or invalid remote record",
                    )
                    .await?
                }
            }
        }
    }
    if restoring && !response.has_more {
        let staged = sqlx::query_scalar::<_, String>(
            "SELECT payload_json FROM sync_bootstrap_records ORDER BY server_cursor",
        )
        .fetch_all(&mut *tx)
        .await?;
        for key in contract::PROFILE_KEYS {
            sqlx::query("DELETE FROM config_profile_values WHERE key=? AND NOT EXISTS(SELECT 1 FROM sync_outbox WHERE user_id=? AND generation=? AND record_kind='profile_setting' AND record_key=?)").bind(key).bind(&response.user_id).bind(response.generation).bind(key).execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM config_profile_values WHERE key='renderer.preferences'")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM config_command_shortcuts")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM extension_action_shortcuts")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM extension_package_settings_v2 WHERE EXISTS(SELECT 1 FROM sync_portable_extension_settings p WHERE p.package_id=extension_package_settings_v2.package_id AND p.setting_id=extension_package_settings_v2.setting_id)").execute(&mut *tx).await?;
        sqlx::query("DELETE FROM sync_values")
            .execute(&mut *tx)
            .await?;
        for raw in staged {
            let v: Value = serde_json::from_str(&raw)?;
            match serde_json::from_value::<SyncRemoteRecord>(v.clone()) {
                Ok(record) if contract::valid_record(&record) => {
                    apply_record(&mut tx, &response, &record).await?
                }
                _ => {
                    quarantine(
                        &mut tx,
                        &response,
                        &v,
                        "Unsupported or invalid remote record",
                    )
                    .await?
                }
            }
        }
        // Edits made during download survive: restore them from their outbox
        // entries with their original revisions, after staging the cloud view.
        let edits = sqlx::query("SELECT * FROM sync_outbox WHERE user_id=? AND generation=?")
            .bind(&response.user_id)
            .bind(response.generation)
            .fetch_all(&mut *tx)
            .await?;
        for edit in edits {
            let raw: Option<String> = edit.get("payload_json");
            let record = SyncRemoteRecord {
                kind: edit.get("record_kind"),
                key: edit.get("record_key"),
                payload: raw.as_deref().map(serde_json::from_str).transpose()?,
                tombstone: edit.get::<i64, _>("tombstone") != 0,
                source_device_id: edit.get("source_device_id"),
                revision_physical_ms: edit.get("revision_physical_ms"),
                revision_counter: edit.get("revision_counter"),
                server_cursor: 0,
            };
            if contract::valid_record(&record) {
                apply_record(&mut tx, &response, &record).await?;
            }
        }
        sqlx::query("UPDATE extension_installs SET enabled=0 WHERE source='registry' AND package_id NOT IN (SELECT record_key FROM sync_values WHERE record_kind='extension_intent' AND tombstone=0)").execute(&mut *tx).await?;
        sqlx::query("DELETE FROM extension_permission_grants WHERE extension_id IN (SELECT id FROM extension_installs WHERE enabled=0)").execute(&mut *tx).await?;
        sqlx::query("DELETE FROM sync_bootstrap_records")
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE sync_remote_state SET restoring=0 WHERE singleton=1")
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE sync_remote_state SET applying_remote=0,server_cursor=?,clock_offset_ms=?,last_success_at=?,last_error=NULL,updated_at=? WHERE singleton=1")
        .bind(response.cursor).bind(response.server_time_ms-now_ms()).bind(now_ms()).bind(now_ms()).execute(&mut *tx).await?;
    tx.commit().await?;
    status(repo).await
}
pub async fn record_error(repo: &HistoryRepository, message: &str) -> Result<()> {
    let message: String = message.chars().take(512).collect();
    sqlx::query("UPDATE sync_remote_state SET last_error=?,updated_at=? WHERE singleton=1")
        .bind(message)
        .bind(now_ms())
        .execute(&repo.pool)
        .await?;
    Ok(())
}

pub async fn recovery(
    repo: &HistoryRepository,
    action: &str,
    id: Option<&str>,
) -> Result<Vec<Value>> {
    let s = status(repo).await?;
    let mut tx = repo.pool.begin().await?;
    if let Some(id) = id {
        match action {
            "discard" => {
                sqlx::query(
                    "DELETE FROM sync_remote_quarantine WHERE id=? AND user_id=? AND generation=?",
                )
                .bind(id)
                .bind(&s.active_user_id)
                .bind(s.generation)
                .execute(&mut *tx)
                .await?;
            }
            "retry" => {
                let raw:String=sqlx::query_scalar("SELECT payload_json FROM sync_remote_quarantine WHERE id=? AND user_id=? AND generation=?").bind(id).bind(&s.active_user_id).bind(s.generation).fetch_one(&mut *tx).await?;
                let record: SyncRemoteRecord = serde_json::from_str(&raw).context(
                    "This rejected upload must be edited in its settings screen before retrying",
                )?;
                if !contract::valid_record(&record) {
                    bail!("Record is still unsupported or invalid; update the app or discard it");
                }
                sqlx::query("UPDATE sync_remote_state SET applying_remote=1 WHERE singleton=1")
                    .execute(&mut *tx)
                    .await?;
                let response = SyncServerResponse {
                    protocol_version: 1,
                    user_id: s.active_user_id.clone().context("No sync account")?,
                    device_id: s.device_id.clone(),
                    generation: s.generation,
                    local_epoch: s.local_epoch,
                    server_time_ms: now_ms(),
                    cursor: s.server_cursor,
                    records: vec![],
                    acknowledgements: vec![],
                    has_more: false,
                };
                apply_record(&mut tx, &response, &record).await?;
                sqlx::query("DELETE FROM sync_remote_quarantine WHERE id=?")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE sync_remote_state SET applying_remote=0 WHERE singleton=1")
                    .execute(&mut *tx)
                    .await?;
            }
            _ => bail!("Unknown recovery action"),
        }
    }
    let rows=sqlx::query("SELECT id,record_kind,record_key,reason FROM sync_remote_quarantine WHERE user_id=? AND generation=? ORDER BY quarantined_at LIMIT 100").bind(&s.active_user_id).bind(s.generation).fetch_all(&mut *tx).await?;
    let mut values:Vec<Value>=rows.into_iter().map(|r|json!({"id":r.get::<String,_>("id"),"kind":r.get::<Option<String>,_>("record_kind"),"key":r.get::<Option<String>,_>("record_key"),"reason":r.get::<String,_>("reason"),"quarantined":true})).collect();
    for r in sqlx::query("SELECT record_kind,record_key,reason FROM sync_pending_effects ORDER BY record_kind,record_key LIMIT 100").fetch_all(&mut *tx).await? {
        values.push(json!({"id":format!("{}/{}",r.get::<String,_>("record_kind"),r.get::<String,_>("record_key")),"kind":r.get::<String,_>("record_kind"),"key":r.get::<String,_>("record_key"),"reason":r.get::<String,_>("reason"),"quarantined":false}));
    }
    tx.commit().await?;
    Ok(values)
}
pub async fn command_shortcuts(
    repo: &HistoryRepository,
) -> Result<std::collections::BTreeMap<String, String>> {
    Ok(sqlx::query(
        "SELECT command_id,accelerator FROM config_command_shortcuts ORDER BY command_id",
    )
    .fetch_all(&repo.pool)
    .await?
    .into_iter()
    .map(|r| (r.get(0), r.get(1)))
    .collect())
}
pub async fn set_command_shortcut(
    repo: &HistoryRepository,
    id: &str,
    accelerator: Option<&str>,
) -> Result<()> {
    if !matches!(
        id,
        "core.copy" | "core.favorite" | "core.pin" | "core.open" | "core.delete"
    ) {
        bail!("Unknown built-in command");
    }
    if let Some(value) = accelerator {
        validate_shortcut_assignment(repo, id, value).await?;
        let collision:i64=sqlx::query_scalar("SELECT count(*) FROM config_command_shortcuts WHERE lower(accelerator)=lower(?) AND command_id<>?").bind(value).bind(id).fetch_one(&repo.pool).await?;
        if collision > 0 {
            bail!("Shortcut conflicts with another assignment");
        }
        sqlx::query("INSERT INTO config_command_shortcuts VALUES(?,?,?) ON CONFLICT(command_id) DO UPDATE SET accelerator=excluded.accelerator,updated_at=excluded.updated_at").bind(id).bind(value).bind(now_ms()).execute(&repo.pool).await?;
    } else {
        sqlx::query("DELETE FROM config_command_shortcuts WHERE command_id=?")
            .bind(id)
            .execute(&repo.pool)
            .await?;
    }
    Ok(())
}

pub async fn snapshot(repo: &HistoryRepository) -> Result<Vec<Value>> {
    let rows = sqlx::query("SELECT * FROM sync_values ORDER BY record_kind,record_key LIMIT 1001")
        .fetch_all(&repo.pool)
        .await?;
    if rows.len() > 1000 {
        bail!("Configuration snapshot exceeds 1000 records");
    }
    let mut values = Vec::new();
    for r in rows {
        let raw: Option<String> = r.get("payload_json");
        let value = json!({"kind":r.get::<String,_>("record_kind"),"key":r.get::<String,_>("record_key"),"payload":raw.as_deref().map(serde_json::from_str::<Value>).transpose()?,"tombstone":r.get::<i64,_>("tombstone")!=0,"revisionPhysicalMs":0,"revisionCounter":0});
        values.push(value);
    }
    let settings = repo.app_settings().await?;
    let defaults = [
        ("ui.theme", json!(settings.theme)),
        ("ui.language", json!(settings.language)),
        (
            "ui.default_output_format",
            serde_json::to_value(settings.default_output_format)?,
        ),
        ("ui.show_copy_toast", json!(settings.show_copy_toast)),
    ];
    for (key, payload) in defaults {
        if !values
            .iter()
            .any(|record| record["kind"] == "profile_setting" && record["key"] == key)
        {
            values.push(json!({
                "kind": "profile_setting",
                "key": key,
                "payload": payload,
                "tombstone": false,
                "revisionPhysicalMs": 0,
                "revisionCounter": 0
            }));
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests;

pub async fn validate_shortcut_assignment(
    repo: &HistoryRepository,
    id: &str,
    value: &str,
) -> Result<()> {
    if !contract::valid_shortcut(value) {
        bail!("Invalid portable shortcut");
    }
    let key = value.rsplit('+').next().unwrap_or("");
    let supported = key.len() == 1
        || matches!(
            key,
            "Enter"
                | "Backspace"
                | "Delete"
                | "Space"
                | "Escape"
                | "Tab"
                | "ArrowUp"
                | "ArrowDown"
                | "ArrowLeft"
                | "ArrowRight"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
        )
        || key
            .strip_prefix('F')
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n));
    if !supported {
        bail!("Shortcut key is not supported on this device");
    }
    fn canonical(s: &str) -> String {
        let native = s
            .replace(
                "Primary+",
                if cfg!(target_os = "macos") {
                    "Meta+"
                } else {
                    "Ctrl+"
                },
            )
            .to_lowercase();
        let mut parts: Vec<_> = native.split('+').collect();
        let key = parts.pop().unwrap_or("").to_owned();
        parts.sort();
        parts.dedup();
        parts.push(&key);
        parts.join("+")
    }
    let mut bindings = std::collections::BTreeMap::from([
        ("core.copy".to_owned(), "Primary+C".to_owned()),
        ("core.favorite".to_owned(), "Primary+F".to_owned()),
        ("core.pin".to_owned(), "Primary+P".to_owned()),
        ("core.open".to_owned(), "Primary+Shift+O".to_owned()),
        (
            "core.delete".to_owned(),
            if cfg!(target_os = "macos") {
                "Primary+Backspace"
            } else {
                "Delete"
            }
            .to_owned(),
        ),
    ]);
    bindings.extend(command_shortcuts(repo).await?);
    if bindings
        .iter()
        .any(|(command, binding)| command != id && canonical(binding) == canonical(value))
    {
        bail!("Shortcut conflicts with another command; choose a new binding");
    }
    Ok(())
}
