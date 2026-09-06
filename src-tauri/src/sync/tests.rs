use super::*;

async fn repo() -> (tempfile::TempDir, HistoryRepository) {
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
async fn write(repo: &HistoryRepository, key: &str, value: Value) {
    sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES(?,?,1,1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json")
        .bind(key).bind(value.to_string()).execute(&repo.pool).await.unwrap();
}
fn remote(key: &str, value: Value, cursor: i64) -> Value {
    json!({"kind":"profile_setting","key":key,"payload":value,"tombstone":false,"sourceDeviceId":"30000000-0000-0000-0000-000000000001","revisionPhysicalMs":now_ms()+100,"revisionCounter":0,"serverCursor":cursor})
}
async fn response(repo: &HistoryRepository, records: Vec<Value>) -> SyncServerResponse {
    let s = status(repo).await.unwrap();
    SyncServerResponse {
        protocol_version: 1,
        user_id: s.active_user_id.unwrap(),
        device_id: s.device_id,
        generation: s.generation,
        local_epoch: s.local_epoch,
        server_time_ms: now_ms(),
        cursor: records.len() as i64,
        records,
        acknowledgements: vec![],
        has_more: false,
    }
}
#[tokio::test]
async fn configuration_sync_restores_only_allowlisted_records_and_quarantines_corruption() {
    let (_temp, repo) = repo().await;
    write(&repo, "capture.excluded_apps", json!(["private-app"])).await;
    begin(&repo, "a", &new_id(), 1, now_ms(), true)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&repo.pool)
        .await
        .unwrap();
    let r = response(
        &repo,
        vec![
            remote("ui.theme", json!("dark"), 1),
            remote("providers.secret", json!("secret"), 2),
            remote("ui.language", json!("ja"), 3),
        ],
    )
    .await;
    let s = apply(&repo, r).await.unwrap();
    assert_eq!(s.quarantined_records, 1);
    assert_eq!(s.pending_records, 0);
    assert_eq!(s.server_cursor, 3);
    let theme: String =
        sqlx::query_scalar("SELECT value_json FROM config_profile_values WHERE key='ui.theme'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(theme, "\"dark\"");
    let outgoing = snapshot(&repo).await.unwrap().to_vec();
    assert!(!serde_json::to_string(&outgoing)
        .unwrap()
        .contains("private-app"));
    assert!(!serde_json::to_string(&outgoing).unwrap().contains("secret"));
}
#[tokio::test]
async fn configuration_sync_scopes_accounts_and_ignores_late_responses() {
    let (_temp, repo) = repo().await;
    begin(&repo, "a", &new_id(), 1, now_ms(), true)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&repo.pool)
        .await
        .unwrap();
    write(&repo, "ui.theme", json!("dark")).await;
    let late = response(&repo, vec![remote("ui.theme", json!("light"), 1)]).await;
    begin(&repo, "b", &new_id(), 1, now_ms(), false)
        .await
        .unwrap();
    assert!(batch(&repo).await.unwrap().records.is_empty());
    assert_eq!(
        apply(&repo, late).await.unwrap().active_user_id.as_deref(),
        Some("b")
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM config_profile_values WHERE key='ui.theme'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(count, 1); // Joining has not erased local values before its first successful download.
}
#[tokio::test]
async fn configuration_sync_acknowledges_exact_revision_without_losing_inflight_edit() {
    let (_temp, repo) = repo().await;
    begin(&repo, "a", &new_id(), 1, now_ms(), true)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&repo.pool)
        .await
        .unwrap();
    write(&repo, "ui.theme", json!("dark")).await;
    let uploaded = batch(&repo).await.unwrap().records.remove(0);
    write(&repo, "ui.theme", json!("light")).await;
    let mut r = response(&repo, vec![]).await;
    r.acknowledgements = vec![
        json!({"kind":"profile_setting","key":"ui.theme","revisionPhysicalMs":uploaded["revisionPhysicalMs"],"revisionCounter":uploaded["revisionCounter"],"status":"accepted","winner":null}),
    ];
    apply(&repo, r).await.unwrap();
    let pending = batch(&repo).await.unwrap();
    assert_eq!(pending.records.len(), 1);
    assert_eq!(pending.records[0]["payload"], "light");
}
#[tokio::test]
async fn configuration_sync_rolls_back_outbox_with_local_transaction() {
    let (_temp, repo) = repo().await;
    begin(&repo, "a", &new_id(), 1, now_ms(), true)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&repo.pool)
        .await
        .unwrap();
    let mut tx = repo.pool.begin().await.unwrap();
    sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('ui.theme','\"dark\"',1,1)").execute(&mut *tx).await.unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(status(&repo).await.unwrap().pending_records, 0);
}
#[tokio::test]
async fn configuration_sync_renderer_changes_are_independent() {
    let (_temp, repo) = repo().await;
    begin(&repo, "a", &new_id(), 1, now_ms(), true)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&repo.pool)
        .await
        .unwrap();
    write(
        &repo,
        "renderer.preferences",
        json!({"byMimeType":{"text/plain":"core/text","text/html":"core/html"}}),
    )
    .await;
    let before = batch(&repo).await.unwrap().records;
    write(
        &repo,
        "renderer.preferences",
        json!({"byMimeType":{"text/plain":"core/other","text/html":"core/html"}}),
    )
    .await;
    let after = batch(&repo).await.unwrap().records;
    let unchanged_before = before
        .iter()
        .find(|r| r["key"] == "mime:text/html")
        .unwrap();
    let unchanged_after = after.iter().find(|r| r["key"] == "mime:text/html").unwrap();
    assert_eq!(unchanged_before, unchanged_after);
}
#[tokio::test]
async fn configuration_sync_tombstones_restore_defaults_and_survive_snapshot() {
    let (_temp, repo) = repo().await;
    begin(&repo, "a", &new_id(), 1, now_ms(), true)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&repo.pool)
        .await
        .unwrap();
    write(&repo, "ui.theme", json!("dark")).await;
    sqlx::query("DELETE FROM config_profile_values WHERE key='ui.theme'")
        .execute(&repo.pool)
        .await
        .unwrap();
    let pending = batch(&repo).await.unwrap();
    assert_eq!(pending.records[0]["tombstone"], true);
    assert!(pending.records[0]["payload"].is_null());
    set_enabled(&repo, "a", false).await.unwrap();
    assert!(batch(&repo).await.is_err());
}

#[tokio::test]
async fn configuration_sync_first_restore_stages_pages_and_preserves_offline_settings() {
    let (_temp, repo) = repo().await;
    write(&repo, "ui.theme", json!("light")).await;
    begin(&repo, "a", &new_id(), 1, now_ms(), false)
        .await
        .unwrap();
    let mut first = response(&repo, vec![remote("ui.theme", json!("dark"), 1)]).await;
    first.has_more = true;
    apply(&repo, first).await.unwrap();
    let theme: String =
        sqlx::query_scalar("SELECT value_json FROM config_profile_values WHERE key='ui.theme'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(theme, "\"light\"");
    let mut second = response(&repo, vec![remote("ui.language", json!("ja"), 2)]).await;
    second.cursor = 2;
    apply(&repo, second).await.unwrap();
    let theme: String =
        sqlx::query_scalar("SELECT value_json FROM config_profile_values WHERE key='ui.theme'")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(theme, "\"dark\"");
    assert!(batch(&repo).await.unwrap().records.is_empty());
}

#[tokio::test]
async fn configuration_sync_first_snapshot_includes_effective_ui_defaults() {
    let (_temp, repo) = repo().await;
    let records = snapshot(&repo).await.unwrap();
    let value = |key: &str| {
        records
            .iter()
            .find(|record| record["kind"] == "profile_setting" && record["key"] == key)
            .map(|record| record["payload"].clone())
    };
    assert_eq!(value("ui.theme"), Some(json!("system")));
    assert_eq!(value("ui.language"), Some(json!("en")));
    assert_eq!(value("ui.default_output_format"), Some(json!("original")));
    assert_eq!(value("ui.show_copy_toast"), Some(json!(true)));
}
