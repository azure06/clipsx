use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::history::{new_id, now_ms, HistoryRepository};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub enabled: bool,
    pub active_user_id: Option<String>,
    pub device_id: String,
    pub device_name: String,
    pub server_cursor: i64,
    pub pending_records: i64,
    pub quarantined_records: i64,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBatch {
    pub device_id: String,
    pub device_name: String,
    pub after_cursor: i64,
    pub records: Vec<SyncUploadRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncUploadRecord {
    pub kind: String,
    pub key: String,
    pub payload: Option<serde_json::Value>,
    pub tombstone: bool,
    pub revision_physical_ms: i64,
    pub revision_counter: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncServerResponse {
    pub cursor: i64,
    pub records: Vec<SyncRemoteRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRemoteRecord {
    pub kind: String,
    pub key: String,
    pub payload: Option<serde_json::Value>,
    pub tombstone: bool,
    pub source_device_id: String,
    pub revision_physical_ms: i64,
    pub revision_counter: i64,
    pub server_cursor: i64,
}

async fn ensure_device(repo: &HistoryRepository) -> Result<(String, String)> {
    if let Some(row) =
        sqlx::query("SELECT device_id,display_name FROM sync_device_identity WHERE singleton=1")
            .fetch_optional(&repo.pool)
            .await?
    {
        return Ok((row.get(0), row.get(1)));
    }
    let id = new_id();
    let name = "This device".to_owned();
    sqlx::query("INSERT INTO sync_device_identity(singleton,device_id,display_name,created_at,last_physical_ms,last_logical_counter) VALUES(1,?,?,?,0,0)")
        .bind(&id)
        .bind(&name)
        .bind(now_ms())
        .execute(&repo.pool)
        .await?;
    Ok((id, name))
}

pub async fn status(repo: &HistoryRepository) -> Result<SyncStatus> {
    let (device_id, device_name) = ensure_device(repo).await?;
    let state = sqlx::query("SELECT enabled,active_user_id,server_cursor,last_attempt_at,last_success_at,last_error FROM sync_remote_state WHERE singleton=1")
        .fetch_one(&repo.pool).await?;
    Ok(SyncStatus {
        enabled: state.get::<i64, _>(0) != 0,
        active_user_id: state.get(1),
        device_id,
        device_name,
        server_cursor: state.get(2),
        pending_records: sqlx::query_scalar("SELECT count(*) FROM sync_outbox")
            .fetch_one(&repo.pool)
            .await?,
        quarantined_records: sqlx::query_scalar("SELECT count(*) FROM sync_remote_quarantine")
            .fetch_one(&repo.pool)
            .await?,
        last_attempt_at: state.get(3),
        last_success_at: state.get(4),
        last_error: state.get(5),
    })
}

pub async fn set_enabled(repo: &HistoryRepository, user_id: &str, enabled: bool) -> Result<()> {
    if user_id.is_empty() || user_id.len() > 120 {
        bail!("sync user identity is invalid");
    }
    let current: Option<String> =
        sqlx::query_scalar("SELECT active_user_id FROM sync_remote_state WHERE singleton=1")
            .fetch_one(&repo.pool)
            .await?;
    let cursor = if current.as_deref().is_some_and(|value| value != user_id) {
        0
    } else {
        sqlx::query_scalar("SELECT server_cursor FROM sync_remote_state WHERE singleton=1")
            .fetch_one(&repo.pool)
            .await?
    };
    sqlx::query("UPDATE sync_remote_state SET enabled=?,active_user_id=?,server_cursor=?,last_error=NULL,updated_at=? WHERE singleton=1")
        .bind(enabled)
        .bind(user_id)
        .bind(cursor)
        .bind(now_ms())
        .execute(&repo.pool)
        .await?;
    Ok(())
}

pub async fn batch(repo: &HistoryRepository) -> Result<SyncBatch> {
    let status = status(repo).await?;
    if !status.enabled || status.active_user_id.is_none() {
        bail!("configuration sync is disabled");
    }
    let rows = sqlx::query("SELECT record_kind,record_key,payload_json,tombstone,revision_physical_ms,revision_counter FROM sync_outbox WHERE next_attempt_at IS NULL OR next_attempt_at<=? ORDER BY updated_at LIMIT 500")
        .bind(now_ms()).fetch_all(&repo.pool).await?;
    let records = rows
        .into_iter()
        .map(|row| -> Result<_> {
            let payload: Option<String> = row.get(2);
            Ok(SyncUploadRecord {
                kind: row.get(0),
                key: row.get(1),
                payload: payload
                    .map(|value| serde_json::from_str(&value))
                    .transpose()?,
                tombstone: row.get::<i64, _>(3) != 0,
                revision_physical_ms: row.get(4),
                revision_counter: row.get(5),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    sqlx::query("UPDATE sync_remote_state SET last_attempt_at=?,updated_at=? WHERE singleton=1")
        .bind(now_ms())
        .bind(now_ms())
        .execute(&repo.pool)
        .await?;
    Ok(SyncBatch {
        device_id: status.device_id,
        device_name: status.device_name,
        after_cursor: status.server_cursor,
        records,
    })
}

pub async fn apply(repo: &HistoryRepository, response: SyncServerResponse) -> Result<SyncStatus> {
    if response.cursor < 0 || response.records.len() > 1000 {
        bail!("sync response exceeds its limits");
    }
    let mut transaction = repo.pool.begin().await?;
    let current_cursor: i64 =
        sqlx::query_scalar("SELECT server_cursor FROM sync_remote_state WHERE singleton=1")
            .fetch_one(&mut *transaction)
            .await?;
    if response.cursor < current_cursor {
        bail!("sync response cursor moved backwards");
    }
    for record in response.records {
        if record.server_cursor <= current_cursor || record.server_cursor > response.cursor {
            continue;
        }
        let valid_value = match record.key.as_str() {
            "ui.theme" => record
                .payload
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .is_some_and(|value| matches!(value, "auto" | "light" | "dark")),
            "ui.language" => record
                .payload
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .is_some_and(|value| {
                    !value.is_empty()
                        && value.len() <= 35
                        && value
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                }),
            _ => false,
        };
        let valid_profile = record.kind == "profile_setting"
            && matches!(record.key.as_str(), "ui.theme" | "ui.language")
            && ((record.tombstone && record.payload.is_none())
                || (!record.tombstone && valid_value));
        if !valid_profile {
            sqlx::query("INSERT INTO sync_remote_quarantine(id,server_cursor,record_kind,record_key,payload_json,reason,quarantined_at) VALUES(?,?,?,?,?,'unsupported or invalid remote profile record',?)")
                .bind(new_id()).bind(record.server_cursor).bind(&record.kind).bind(&record.key)
                .bind(serde_json::to_string(&record.payload)?).bind(now_ms())
                .execute(&mut *transaction).await?;
            continue;
        }
        let local_revision: Option<(i64, i64, String)> = sqlx::query_as("SELECT revision_physical_ms,revision_counter,source_device_id FROM sync_outbox WHERE record_kind=? AND record_key=?")
            .bind(&record.kind).bind(&record.key).fetch_optional(&mut *transaction).await?;
        let remote_revision = (
            record.revision_physical_ms,
            record.revision_counter,
            record.source_device_id.as_str(),
        );
        if local_revision
            .as_ref()
            .is_some_and(|local| (local.0, local.1, local.2.as_str()) > remote_revision)
        {
            continue;
        }
        if record.tombstone {
            sqlx::query("DELETE FROM config_profile_values WHERE key=?")
                .bind(&record.key)
                .execute(&mut *transaction)
                .await?;
        } else {
            let value = serde_json::to_string(record.payload.as_ref().unwrap())?;
            sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
                .bind(&record.key).bind(value).bind(now_ms()).bind(now_ms()).execute(&mut *transaction).await?;
        }
        sqlx::query("DELETE FROM sync_outbox WHERE record_kind=? AND record_key=?")
            .bind(&record.kind)
            .bind(&record.key)
            .execute(&mut *transaction)
            .await?;
    }
    sqlx::query("UPDATE sync_remote_state SET server_cursor=?,last_success_at=?,last_error=NULL,updated_at=? WHERE singleton=1")
        .bind(response.cursor).bind(now_ms()).bind(now_ms()).execute(&mut *transaction).await?;
    transaction.commit().await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    async fn repository() -> (tempfile::TempDir, HistoryRepository) {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        (temp, repo)
    }

    fn record(key: &str, payload: Option<serde_json::Value>, cursor: i64) -> SyncRemoteRecord {
        SyncRemoteRecord {
            kind: "profile_setting".into(),
            key: key.into(),
            payload,
            tombstone: false,
            source_device_id: "remote-device".into(),
            revision_physical_ms: 100,
            revision_counter: 0,
            server_cursor: cursor,
        }
    }

    #[tokio::test]
    async fn applies_valid_remote_profile_and_quarantines_invalid_records() {
        let (_temp, repo) = repository().await;
        let status = apply(
            &repo,
            SyncServerResponse {
                cursor: 2,
                records: vec![
                    record("ui.theme", Some(serde_json::json!("dark")), 1),
                    record("capture.max_age_days", Some(serde_json::json!(0)), 2),
                ],
            },
        )
        .await
        .unwrap();
        assert_eq!(status.server_cursor, 2);
        assert_eq!(status.quarantined_records, 1);
        let value: String =
            sqlx::query_scalar("SELECT value_json FROM config_profile_values WHERE key='ui.theme'")
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(value, "\"dark\"");
    }

    #[tokio::test]
    async fn local_newer_revision_wins_and_cursor_cannot_move_backwards() {
        let (_temp, repo) = repository().await;
        let (device_id, _) = ensure_device(&repo).await.unwrap();
        sqlx::query("INSERT INTO sync_outbox(record_kind,record_key,payload_json,tombstone,source_device_id,revision_physical_ms,revision_counter,attempts,created_at,updated_at) VALUES('profile_setting','ui.theme','\"light\"',0,?,200,0,0,1,1)")
            .bind(device_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        apply(
            &repo,
            SyncServerResponse {
                cursor: 4,
                records: vec![record("ui.theme", Some(serde_json::json!("dark")), 4)],
            },
        )
        .await
        .unwrap();
        let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_outbox")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(pending, 1);
        assert!(apply(
            &repo,
            SyncServerResponse {
                cursor: 3,
                records: Vec::new(),
            },
        )
        .await
        .is_err());
    }
}
