use crate::{history::HistoryRepository, search, search::semantic as embeddings};
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
}

#[derive(Clone, Default)]
pub struct SingleWorker {
    running: Arc<AtomicBool>,
}

impl SingleWorker {
    pub fn wake_text_index(&self, app: tauri::AppHandle, history: HistoryRepository) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let guard = self.clone();
        tauri::async_runtime::spawn(async move {
            let delays = [5_u64, 15, 30, 60];
            let mut retry = 0_usize;
            let mut validated = false;
            loop {
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
                            if !embeddings::status(&history)
                                .await
                                .is_ok_and(|status| status.enabled)
                            {
                                break;
                            }
                            let _ = app.emit("embedding-index-failed", error.to_string());
                            let delay = delays[retry.min(delays.len() - 1)];
                            retry = (retry + 1).min(delays.len() - 1);
                            tokio::time::sleep(Duration::from_secs(delay)).await;
                            continue;
                        }
                    }
                }
                match embeddings::index_pending(&history).await {
                    Ok(0) => break,
                    Ok(_) => {
                        retry = 0;
                        let _ = app.emit("search-index-progress", search::SEMANTIC_TEXT_SOURCE_ID);
                    }
                    Err(error) => {
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
            if embeddings::status(&history)
                .await
                .is_ok_and(|status| status.pending_jobs > 0)
            {
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
