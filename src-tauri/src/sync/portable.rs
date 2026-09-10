//! Account-independent portable configuration. No remote identity or clocks cross this boundary.
use super::{contract, HistoryRepository, SyncRemoteRecord};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_RECORDS: usize = 1000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    format: String,
    version: u32,
    records: Vec<Record>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    kind: String,
    key: String,
    payload: Option<Value>,
    tombstone: bool,
}

impl Record {
    fn into_domain(self) -> SyncRemoteRecord {
        SyncRemoteRecord {
            kind: self.kind,
            key: self.key,
            payload: self.payload,
            tombstone: self.tombstone,
            source_device_id: String::new(),
            revision_physical_ms: 0,
            revision_counter: 0,
            server_cursor: 0,
        }
    }
}

pub(crate) fn parse(text: &str) -> Result<Vec<SyncRemoteRecord>> {
    if text.len() > MAX_BYTES {
        bail!("Settings file exceeds 4 MiB");
    }
    let document: Document = serde_json::from_str(text)
        .map_err(|_| anyhow::anyhow!("Invalid portable settings document"))?;
    if document.format != "clipsx-portable-settings" || document.version != 1 {
        bail!("Unsupported portable settings format or version");
    }
    if document.records.len() > MAX_RECORDS {
        bail!("Settings file exceeds 1000 records");
    }
    let mut keys = HashSet::new();
    let mut records = Vec::new();
    for record in document.records {
        let record = record.into_domain();
        if !contract::valid_record(&record)
            || !keys.insert((record.kind.clone(), record.key.clone()))
        {
            bail!("Invalid, unsupported, or duplicate portable setting");
        }
        records.push(record);
    }
    Ok(records)
}

pub async fn export(repo: &HistoryRepository) -> Result<String> {
    let mut records = Vec::new();
    for value in super::snapshot(repo).await? {
        let record = Record {
            kind: value["kind"].as_str().unwrap_or_default().into(),
            key: value["key"].as_str().unwrap_or_default().into(),
            payload: if value["tombstone"] == true {
                None
            } else {
                Some(value["payload"].clone())
            },
            tombstone: value["tombstone"] == true,
        };
        records.push(record);
    }
    let text = serde_json::to_string_pretty(&Document {
        format: "clipsx-portable-settings".into(),
        version: 1,
        records,
    })?;
    // Never produce a file the importer would reject.
    parse(&text)?;
    Ok(text)
}

pub async fn import(repo: &HistoryRepository, text: &str) -> Result<crate::history::AppSettings> {
    let records = parse(text)?;
    super::ensure_device(repo).await?;
    let mut tx = repo.pool.begin().await?;
    // Acquire the writer before reading or modifying domain values. Leave normal
    // local triggers enabled, so sync sees the import as a local mutation.
    sqlx::query("UPDATE sync_remote_state SET updated_at=updated_at WHERE singleton=1")
        .execute(&mut *tx)
        .await?;
    let ocr_changed = records.iter().any(|record| {
        record.kind == "profile_setting"
            && matches!(
                record.key.as_str(),
                "artifacts.ocr.enabled" | "artifacts.ocr.language" | "ui.language"
            )
    });
    let language_supplied = records
        .iter()
        .any(|record| record.kind == "profile_setting" && record.key == "ui.language");
    for record in records {
        super::apply_domain(&mut tx, &record, true).await?;
    }
    if language_supplied {
        sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('ui.language_initialized','true',0,0) ON CONFLICT(key) DO UPDATE SET value_json='true'").execute(&mut *tx).await?;
    }
    if ocr_changed {
        crate::artifacts::invalidate_ocr_settings(&mut tx).await?;
    }
    let settings = HistoryRepository::app_settings_in(&mut tx).await?;
    tx.commit().await?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn document(records: Value) -> String {
        json!({"format":"clipsx-portable-settings","version":1,"records":records}).to_string()
    }

    #[test]
    fn rejects_unknown_duplicate_device_and_oversized_records() {
        let theme =
            json!({"kind":"profile_setting","key":"ui.theme","payload":"dark","tombstone":false});
        assert!(parse(&document(json!([theme.clone(), theme]))).is_err());
        for key in [
            "ui.auto_start",
            "diagnostics.logging_enabled",
            "auth.token",
            "window.global_shortcut",
        ] {
            assert!(parse(&document(
                json!([{"kind":"profile_setting","key":key,"payload":true,"tombstone":false}])
            ))
            .is_err());
        }
        assert!(parse(&" ".repeat(MAX_BYTES + 1)).is_err());
        assert!(
            parse(r#"{"format":"clipsx-portable-settings","version":2,"records":[]}"#).is_err()
        );
    }

    #[tokio::test]
    async fn offline_roundtrip_merge_and_invalid_import_are_atomic() {
        let (_temp, repo) = super::super::tests::repo().await;
        let mut settings = repo.app_settings().await.unwrap();
        settings.auto_start = true;
        settings.logging_enabled = false;
        repo.save_app_settings(&settings, false).await.unwrap();
        let text = document(json!([
            {"kind":"profile_setting","key":"ui.theme","payload":"dark","tombstone":false},
            {"kind":"profile_setting","key":"artifacts.ocr.enabled","payload":true,"tombstone":false},
            {"kind":"renderer_preference","key":"mime:text/plain","payload":"builtin.original","tombstone":false},
            {"kind":"shortcut","key":"core.copy","payload":"Primary+J","tombstone":false},
            {"kind":"extension_intent","key":"example.package","payload":{"enabled":true},"tombstone":false},
            {"kind":"extension_setting","key":"example.package/count","payload":3,"tombstone":false}
        ]));
        import(&repo, &text).await.unwrap();
        let actual = repo.app_settings().await.unwrap();
        assert_eq!(actual.theme, "dark");
        assert!(actual.auto_start);
        assert!(!actual.logging_enabled);
        let exported = export(&repo).await.unwrap();
        assert!(!exported.contains("auto_start"));
        assert!(!exported.contains("logging"));
        assert!(!exported.contains("revision"));
        let before = exported.clone();
        assert!(import(&repo, &document(json!([
            {"kind":"profile_setting","key":"ui.theme","payload":"light","tombstone":false},
            {"kind":"profile_setting","key":"private.secret","payload":"sentinel","tombstone":false}
        ]))).await.is_err());
        assert_eq!(export(&repo).await.unwrap(), before);
        let (_other_temp, other) = super::super::tests::repo().await;
        import(&other, &exported).await.unwrap();
        assert_eq!(export(&other).await.unwrap(), exported);
        let pending: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sync_pending_effects WHERE local_import=1")
                .fetch_one(&other.pool)
                .await
                .unwrap();
        assert_eq!(pending, 3);
    }

    #[tokio::test]
    async fn import_publishes_local_outbox_and_tombstones() {
        let (_temp, repo) = super::super::tests::repo().await;
        super::super::begin(
            &repo,
            "account",
            &crate::history::new_id(),
            1,
            crate::history::now_ms(),
            true,
        )
        .await
        .unwrap();
        import(&repo, &document(json!([{"kind":"profile_setting","key":"ui.theme","payload":"dark","tombstone":false}]))).await.unwrap();
        import(&repo, &document(json!([{"kind":"profile_setting","key":"ui.theme","payload":null,"tombstone":true}]))).await.unwrap();
        assert_eq!(repo.app_settings().await.unwrap().theme, "system");
        let deleted: i64 = sqlx::query_scalar("SELECT tombstone FROM sync_outbox WHERE record_kind='profile_setting' AND record_key='ui.theme'").fetch_one(&repo.pool).await.unwrap();
        assert_eq!(deleted, 1);
    }

    #[tokio::test]
    async fn offline_recovery_applies_shortcuts_but_never_installs_missing_packages() {
        let (temp, repo) = super::super::tests::repo().await;
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        let extensions = crate::extensions::ExtensionService::new(&roots).unwrap();
        let text = document(json!([
            {"kind":"extension_intent","key":"example.unavailable","payload":{"enabled":true},"tombstone":false},
            {"kind":"shortcut","key":"core.copy_plain_text","payload":"Primary+J","tombstone":false}
        ]));
        import(&repo, &text).await.unwrap();
        extensions
            .reconcile_configuration_sync(&repo)
            .await
            .unwrap();
        assert_eq!(
            super::super::command_shortcuts(&repo)
                .await
                .unwrap()
                .get("core.copy_plain_text")
                .map(String::as_str),
            Some("Primary+J")
        );
        let reason: String = sqlx::query_scalar(
            "SELECT reason FROM sync_pending_effects WHERE record_key='example.unavailable'",
        )
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert!(reason.contains("Install this package from Extensions"));
        // A cloud echo must not convert manual-install intent into auto-install.
        let record = parse(&text).unwrap().remove(0);
        let mut tx = repo.pool.begin().await.unwrap();
        super::super::apply_domain(&mut tx, &record, false)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let local_import: i64 = sqlx::query_scalar(
            "SELECT local_import FROM sync_pending_effects WHERE record_key='example.unavailable'",
        )
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert_eq!(local_import, 1);
        extensions
            .reconcile_configuration_sync(&repo)
            .await
            .unwrap();
        let installed: i64 = sqlx::query_scalar("SELECT count(*) FROM extension_installs")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(installed, 0);
    }
}
