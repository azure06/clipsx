use crate::{artifacts, history::HistoryRepository, search, search::semantic as embeddings};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Clone, Default)]
pub struct BackgroundWorkers {
    pub text_index: SingleWorker,
    pub managed_files: SingleWorker,
    pub ocr: SingleWorker,
    pub extensions: SingleWorker,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactUpdate {
    clip_id: String,
    source_id: String,
}

#[derive(Clone, Default)]
pub struct SingleWorker {
    running: Arc<AtomicBool>,
}

impl SingleWorker {
    pub fn wake_extensions(
        &self,
        app: tauri::AppHandle,
        history: HistoryRepository,
        extensions: crate::extensions::ExtensionService,
    ) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let guard = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let processed = extensions
                    .enqueue_capture_automations(&history, "")
                    .await
                    .unwrap_or(0);
                match crate::extensions::jobs::run_next(&history, &extensions).await {
                    Ok(Some((job_id, clip_id))) => {
                        let status: Option<(String, Option<String>)> = sqlx::query_as(
                            "SELECT status,reason_code FROM extension_jobs WHERE id=?",
                        )
                        .bind(&job_id)
                        .fetch_optional(&history.pool)
                        .await
                        .unwrap_or(None);
                        if let Some((status, reason_code)) = status {
                            let _ = app.emit("extension-job-updated", serde_json::json!({"jobId":job_id,"clipId":clip_id,"status":status,"reasonCode":reason_code}));
                        }
                    }
                    Ok(None) if processed > 0 => continue,
                    Ok(None) => break,
                    Err(_) => {
                        crate::diagnostic!("extension.job.worker.failed");
                        break;
                    }
                }
            }
            guard.running.store(false, Ordering::SeqCst);
            let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM extension_jobs WHERE (status IN ('pending','waiting_provider') AND (retry_at IS NULL OR retry_at<=?)) OR EXISTS(SELECT 1 FROM extension_activation_events WHERE status='pending')")
                .bind(crate::history::now_ms()).fetch_one(&history.pool).await.unwrap_or(0);
            if pending > 0 {
                guard.wake_extensions(app, history, extensions);
            } else {
                let retry_at: Option<i64> = sqlx::query_scalar("SELECT min(retry_at) FROM extension_jobs WHERE status IN ('pending','waiting_provider') AND retry_at IS NOT NULL")
                    .fetch_one(&history.pool).await.unwrap_or(None);
                if let Some(retry_at) = retry_at {
                    let delay = (retry_at - crate::history::now_ms()).clamp(1, 60_000) as u64;
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    guard.wake_extensions(app, history, extensions);
                }
            }
        });
    }
    pub fn wake_text_index(&self, app: tauri::AppHandle, history: HistoryRepository) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let guard = self.clone();
        tauri::async_runtime::spawn(async move {
            let delays = [5_u64, 15, 30, 60];
            let mut retry = 0_usize;
            let mut validated = false;
            let mut cleanup_reported = false;
            let mut indexing_reported = false;
            loop {
                let cleanup_result = embeddings::process_cleanup(&history).await;
                let cleanup_count = match &cleanup_result {
                    Ok(count) => {
                        cleanup_reported = false;
                        *count
                    }
                    Err(error) => {
                        crate::diagnostic!("search.cleanup.failed");
                        if retry == delays.len() - 1 && !cleanup_reported {
                            crate::app::diagnostics::report_error("search_cleanup_terminal");
                            cleanup_reported = true;
                        }
                        let _ = app.emit("embedding-index-failed", error.to_string());
                        0
                    }
                };
                let status = match embeddings::status(&history).await {
                    Ok(status) => status,
                    Err(error) => {
                        let _ = app.emit("embedding-index-failed", error.to_string());
                        let delay = delays[retry.min(delays.len() - 1)];
                        retry = (retry + 1).min(delays.len() - 1);
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                        continue;
                    }
                };
                if !status.enabled {
                    if cleanup_result.is_err() {
                        let delay = delays[retry.min(delays.len() - 1)];
                        retry = (retry + 1).min(delays.len() - 1);
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                        continue;
                    }
                    if cleanup_count > 0 {
                        retry = 0;
                        continue;
                    }
                    break;
                }
                if !validated {
                    match embeddings::validate_configured_provider(&history).await {
                        Ok(()) => {
                            validated = true;
                            let _ = app.emit(
                                "search-source-status-changed",
                                search::SEMANTIC_TEXT_SOURCE_ID,
                            );
                        }
                        Err(error) => {
                            let _ = app.emit("embedding-index-failed", error.to_string());
                            let delay = delays[retry.min(delays.len() - 1)];
                            retry = (retry + 1).min(delays.len() - 1);
                            tokio::time::sleep(Duration::from_secs(delay)).await;
                            continue;
                        }
                    }
                }
                match embeddings::index_pending(&history).await {
                    Ok(0) if cleanup_result.is_ok() && cleanup_count == 0 => break,
                    Ok(0) => {
                        if cleanup_result.is_err() {
                            let delay = delays[retry.min(delays.len() - 1)];
                            retry = (retry + 1).min(delays.len() - 1);
                            tokio::time::sleep(Duration::from_secs(delay)).await;
                        } else {
                            retry = 0;
                        }
                    }
                    Ok(_) => {
                        indexing_reported = false;
                        let _ = app.emit("search-index-progress", search::SEMANTIC_TEXT_SOURCE_ID);
                        if cleanup_result.is_err() {
                            let delay = delays[retry.min(delays.len() - 1)];
                            retry = (retry + 1).min(delays.len() - 1);
                            tokio::time::sleep(Duration::from_secs(delay)).await;
                        } else {
                            retry = 0;
                        }
                    }
                    Err(error) => {
                        crate::diagnostic!("search.index.batch.failed");
                        if retry == delays.len() - 1 && !indexing_reported {
                            crate::app::diagnostics::report_error("search_index_terminal");
                            indexing_reported = true;
                        }
                        validated = false;
                        let _ = app.emit("embedding-index-failed", error.to_string());
                        if !embeddings::status(&history)
                            .await
                            .is_ok_and(|status| status.enabled)
                        {
                            break;
                        }
                        let delay = delays[retry.min(delays.len() - 1)];
                        retry = (retry + 1).min(delays.len() - 1);
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                    }
                }
            }
            guard.running.store(false, Ordering::SeqCst);
            let indexing_pending = embeddings::status(&history)
                .await
                .is_ok_and(|status| status.enabled && status.pending_jobs > 0);
            let cleanup_pending = embeddings::cleanup_pending(&history).await.unwrap_or(false);
            if indexing_pending || cleanup_pending {
                guard.wake_text_index(app.clone(), history.clone());
            }
            let _ = app.emit(
                "search-source-status-changed",
                search::SEMANTIC_TEXT_SOURCE_ID,
            );
            let _ = app.emit("embedding-space-changed", ());
        });
    }

    pub fn wake_managed_files(&self, history: HistoryRepository) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let guard = self.clone();
        tauri::async_runtime::spawn(async move {
            let delays = [1_u64, 5, 30, 60];
            let mut retry = 0_usize;
            let _ = history.reconcile_managed_files().await;
            loop {
                let _ = history.drain_managed_file_deletions().await;
                let pending: i64 =
                    sqlx::query_scalar("SELECT count(*) FROM system_managed_file_deletions")
                        .fetch_one(&history.pool)
                        .await
                        .unwrap_or(0);
                if pending == 0 {
                    break;
                }
                let delay = delays[retry.min(delays.len() - 1)];
                retry = (retry + 1).min(delays.len() - 1);
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
            guard.running.store(false, Ordering::SeqCst);
            let pending: i64 =
                sqlx::query_scalar("SELECT count(*) FROM system_managed_file_deletions")
                    .fetch_one(&history.pool)
                    .await
                    .unwrap_or(0);
            if pending > 0 {
                guard.wake_managed_files(history);
            }
        });
    }

    pub fn wake_ocr(&self, app: tauri::AppHandle, history: HistoryRepository) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let guard = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                match artifacts::run_next_ocr(&history).await {
                    Ok(Some(work)) => {
                        let _ = app.emit(
                            "clip-artifacts-updated",
                            ArtifactUpdate {
                                clip_id: work.clip_id.clone(),
                                source_id: work.representation_id,
                            },
                        );
                        let _ = search::upsert_projection(&history, &work.clip_id).await;
                        let _ = embeddings::enqueue_clip(&history, &work.clip_id).await;
                        wake_text_index(&app, history.clone());
                        let _ = app.emit("ocr-status-changed", ());
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = app.emit("ocr-worker-failed", error.to_string());
                        break;
                    }
                }
            }
            guard.running.store(false, Ordering::SeqCst);
            let pending: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM artifact_jobs WHERE artifact_kind='ocr' AND status='pending'",
            )
            .fetch_one(&history.pool)
            .await
            .unwrap_or(0);
            if pending > 0 {
                guard.wake_ocr(app, history);
            }
        });
    }
}

pub fn wake_text_index(app: &tauri::AppHandle, history: HistoryRepository) {
    if let Some(state) = app.try_state::<crate::app::state::AppState>() {
        state
            .workers
            .text_index
            .wake_text_index(app.clone(), history);
    }
}

pub fn wake_managed_files(app: &tauri::AppHandle, history: HistoryRepository) {
    if let Some(state) = app.try_state::<crate::app::state::AppState>() {
        state.workers.managed_files.wake_managed_files(history);
    }
}

pub fn wake_ocr(app: &tauri::AppHandle, history: HistoryRepository) {
    if let Some(state) = app.try_state::<crate::app::state::AppState>() {
        state.workers.ocr.wake_ocr(app.clone(), history);
    }
}

pub fn wake_extensions(
    app: &tauri::AppHandle,
    history: HistoryRepository,
    extensions: crate::extensions::ExtensionService,
) {
    if let Some(state) = app.try_state::<crate::app::state::AppState>() {
        state
            .workers
            .extensions
            .wake_extensions(app.clone(), history, extensions);
    }
}
