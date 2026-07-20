// Capability-oriented AI managers.
//
// Each capability owns its own install state, runtime state, error state, and
// persistence. No capability infers readiness from another.
//
// TextSearchCapability  — fastembed / HuggingFace, cache-managed.
// ImageSearchCapability — SigLIP2 ViT, self-managed artifact download.
// OCR uses the native platform engine configured by `services::ocr` and is
// intentionally outside this capability system.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::models::{
    AiCapabilityArtifact, AiCapabilityDeliveryMode, AiCapabilityInstallState, AiCapabilityKind,
    AiCapabilityRuntimeState, AiCapabilityStatus,
};
use crate::services::ai_assets;
use crate::services::semantic::SemanticService;
use crate::services::visual::VisualService;

// ── Embedded artifact lists ──────────────────────────────────────────────────

static IMAGE_ARTIFACTS: LazyLock<Vec<AiCapabilityArtifact>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("image_artifacts.json"))
        .expect("image_artifacts.json must be valid")
});

// ── Persisted per-capability state ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedCapabilityState {
    install_state: AiCapabilityInstallState,
    installed_at: Option<i64>,
    last_error: Option<String>,
}

fn load_state(path: &Path) -> PersistedCapabilityState {
    if !path.exists() {
        return PersistedCapabilityState::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(path: &Path, state: &PersistedCapabilityState) -> Result<()> {
    let json =
        serde_json::to_string_pretty(state).context("Failed to serialize capability state")?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).context("Failed to write capability state tmp file")?;
    fs::rename(&tmp, path).context("Failed to persist capability state")?;
    Ok(())
}

fn emit_capabilities_changed(app_handle: &AppHandle) {
    let _ = app_handle.emit("ai-capabilities-changed", ());
}

// ── TextSearchCapability ─────────────────────────────────────────────────────

pub struct TextSearchCapability {
    state_path: PathBuf,
    semantic_service: std::sync::Arc<SemanticService>,
}

impl TextSearchCapability {
    pub fn new(app_data_dir: PathBuf, semantic_service: std::sync::Arc<SemanticService>) -> Self {
        fs::create_dir_all(&app_data_dir).ok();
        Self {
            state_path: app_data_dir.join("text-search-state.json"),
            semantic_service,
        }
    }

    pub fn status(&self) -> AiCapabilityStatus {
        let persisted = load_state(&self.state_path);
        let is_installed = self.semantic_service.get_model_info().is_some()
            || self.semantic_service.are_model_files_cached();
        let runtime_state = match self.semantic_service.get_runtime_status() {
            crate::services::semantic::SemanticRuntimeStatus::Idle => {
                AiCapabilityRuntimeState::Idle
            }
            crate::services::semantic::SemanticRuntimeStatus::Loading { .. } => {
                AiCapabilityRuntimeState::Loading
            }
            crate::services::semantic::SemanticRuntimeStatus::Indexing { .. } => {
                AiCapabilityRuntimeState::Ready
            }
            crate::services::semantic::SemanticRuntimeStatus::Ready { .. } => {
                AiCapabilityRuntimeState::Ready
            }
            crate::services::semantic::SemanticRuntimeStatus::Error { .. } => {
                AiCapabilityRuntimeState::Error
            }
        };

        let last_error =
            if let crate::services::semantic::SemanticRuntimeStatus::Error { message, .. } =
                self.semantic_service.get_runtime_status()
            {
                Some(message)
            } else {
                None
            };

        let install_state = if is_installed {
            AiCapabilityInstallState::Ready
        } else {
            match persisted.install_state {
                AiCapabilityInstallState::Downloading => AiCapabilityInstallState::Downloading,
                AiCapabilityInstallState::Error => AiCapabilityInstallState::Error,
                _ => AiCapabilityInstallState::NotDownloaded,
            }
        };

        AiCapabilityStatus {
            kind: AiCapabilityKind::TextSearch,
            display_name: "Text Search".to_string(),
            delivery_mode: AiCapabilityDeliveryMode::CacheManaged,
            install_state,
            runtime_state,
            installed_at: if is_installed {
                persisted.installed_at
            } else {
                None
            },
            last_error,
            size_bytes: 0,
        }
    }

    pub async fn install(&self, app_handle: &AppHandle) -> Result<()> {
        self.mark(AiCapabilityInstallState::Downloading, None)?;
        emit_capabilities_changed(app_handle);

        match self
            .semantic_service
            .init_model(Some(app_handle.clone()))
            .await
        {
            Ok(()) => {
                self.mark(AiCapabilityInstallState::Ready, None)?;
                emit_capabilities_changed(app_handle);
                Ok(())
            }
            Err(error) => {
                let msg = error.to_string();
                self.semantic_service.set_error_status(msg.clone());
                self.mark(AiCapabilityInstallState::Error, Some(msg))?;
                emit_capabilities_changed(app_handle);
                Err(error)
            }
        }
    }

    pub fn delete(&self, app_handle: &AppHandle) -> Result<()> {
        self.semantic_service.delete_cached_model()?;
        if self.state_path.exists() {
            fs::remove_file(&self.state_path).ok();
        }
        emit_capabilities_changed(app_handle);
        Ok(())
    }

    fn mark(&self, state: AiCapabilityInstallState, error: Option<String>) -> Result<()> {
        save_state(
            &self.state_path,
            &PersistedCapabilityState {
                installed_at: if state == AiCapabilityInstallState::Ready {
                    Some(chrono::Utc::now().timestamp())
                } else {
                    None
                },
                install_state: state,
                last_error: error,
            },
        )
    }
}

// ── ImageSearchCapability ────────────────────────────────────────────────────

pub struct ImageSearchCapability {
    app_data_dir: PathBuf,
    state_path: PathBuf,
    visual_service: std::sync::Arc<VisualService>,
}

impl ImageSearchCapability {
    pub fn new(app_data_dir: PathBuf, visual_service: std::sync::Arc<VisualService>) -> Self {
        fs::create_dir_all(&app_data_dir).ok();
        Self {
            state_path: app_data_dir.join("image-search-state.json"),
            visual_service,
            app_data_dir,
        }
    }

    pub fn status(&self) -> AiCapabilityStatus {
        let is_downloaded = self.visual_service.are_models_downloaded();
        let persisted = load_state(&self.state_path);

        let install_state = if is_downloaded {
            AiCapabilityInstallState::Ready
        } else {
            match &persisted.install_state {
                AiCapabilityInstallState::Downloading => AiCapabilityInstallState::Downloading,
                AiCapabilityInstallState::Error => AiCapabilityInstallState::Error,
                _ => AiCapabilityInstallState::NotDownloaded,
            }
        };

        let last_error = if install_state == AiCapabilityInstallState::Error {
            persisted.last_error.clone()
        } else {
            None
        };

        let runtime_state = if is_downloaded {
            AiCapabilityRuntimeState::Ready
        } else {
            AiCapabilityRuntimeState::Idle
        };

        let size_bytes: u64 = IMAGE_ARTIFACTS.iter().map(|a| a.size_bytes).sum();

        AiCapabilityStatus {
            kind: AiCapabilityKind::ImageSearch,
            display_name: "Image Search".to_string(),
            delivery_mode: AiCapabilityDeliveryMode::SelfManaged,
            install_state,
            runtime_state,
            installed_at: if is_downloaded {
                persisted.installed_at
            } else {
                None
            },
            last_error,
            size_bytes,
        }
    }

    pub async fn install(&self, app_handle: &AppHandle) -> Result<()> {
        self.mark(AiCapabilityInstallState::Downloading, None)?;
        emit_capabilities_changed(app_handle);

        if let Err(error) = ai_assets::install_artifacts(
            "image_search",
            &IMAGE_ARTIFACTS,
            &self.app_data_dir,
            app_handle,
        )
        .await
        {
            self.visual_service.unload_models();
            let msg = error.to_string();
            self.mark(AiCapabilityInstallState::Error, Some(msg))?;
            emit_capabilities_changed(app_handle);
            return Err(error);
        }

        if let Err(error) = self.visual_service.preload_models().await {
            self.visual_service.unload_models();
            let msg = error.to_string();
            self.mark(AiCapabilityInstallState::Error, Some(msg))?;
            emit_capabilities_changed(app_handle);
            return Err(error);
        }

        self.mark(AiCapabilityInstallState::Ready, None)?;
        emit_capabilities_changed(app_handle);
        Ok(())
    }

    pub fn delete(&self, app_handle: &AppHandle) -> Result<()> {
        self.visual_service.delete_cached_models()?;
        if self.state_path.exists() {
            fs::remove_file(&self.state_path).ok();
        }
        emit_capabilities_changed(app_handle);
        Ok(())
    }

    fn mark(&self, state: AiCapabilityInstallState, error: Option<String>) -> Result<()> {
        save_state(
            &self.state_path,
            &PersistedCapabilityState {
                installed_at: if state == AiCapabilityInstallState::Ready {
                    Some(chrono::Utc::now().timestamp())
                } else {
                    None
                },
                install_state: state,
                last_error: error,
            },
        )
    }
}

// ── Startup stale-state repair ───────────────────────────────────────────────

/// On startup, any capability persisted as `downloading` becomes `error`
/// (the process was killed mid-download). Callers can then show a retry option.
pub fn repair_stale_downloading_states(app_data_dir: &Path) {
    for filename in &["text-search-state.json", "image-search-state.json"] {
        let path = app_data_dir.join(filename);
        let mut state = load_state(&path);
        if state.install_state == AiCapabilityInstallState::Downloading {
            state.install_state = AiCapabilityInstallState::Error;
            state.last_error =
                Some("Download was interrupted. Click 'Retry' to resume.".to_string());
            save_state(&path, &state).ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_search_status_is_ready_when_cache_exists_and_state_was_ready() {
        let temp_dir = tempfile::tempdir().unwrap();
        let semantic_service =
            std::sync::Arc::new(SemanticService::new(temp_dir.path().to_path_buf()));
        let capability =
            TextSearchCapability::new(temp_dir.path().to_path_buf(), semantic_service.clone());

        capability
            .mark(AiCapabilityInstallState::Ready, None)
            .unwrap();

        let cache_root = temp_dir
            .path()
            .join(".fastembed_cache")
            .join("models--BAAI--bge-m3");
        fs::create_dir_all(&cache_root).unwrap();
        fs::write(cache_root.join("model.onnx"), b"cached").unwrap();

        let status = capability.status();

        assert_eq!(status.install_state, AiCapabilityInstallState::Ready);
        assert!(status.installed_at.is_some());
    }

    #[test]
    fn text_search_status_is_ready_when_enabled_startup_would_find_cached_model() {
        let temp_dir = tempfile::tempdir().unwrap();
        let semantic_service =
            std::sync::Arc::new(SemanticService::new(temp_dir.path().to_path_buf()));
        let capability =
            TextSearchCapability::new(temp_dir.path().to_path_buf(), semantic_service.clone());

        let legacy_cache_dir = temp_dir.path().join(".fastembed_cache").join("BAAI/bge-m3");
        fs::create_dir_all(&legacy_cache_dir).unwrap();
        fs::write(legacy_cache_dir.join("model.onnx"), b"cached").unwrap();

        let status = capability.status();

        assert_eq!(status.install_state, AiCapabilityInstallState::Ready);
    }

    #[test]
    fn text_search_status_is_not_downloaded_without_loaded_model_or_cache() {
        let temp_dir = tempfile::tempdir().unwrap();
        let semantic_service =
            std::sync::Arc::new(SemanticService::new(temp_dir.path().to_path_buf()));
        let capability =
            TextSearchCapability::new(temp_dir.path().to_path_buf(), semantic_service.clone());

        let status = capability.status();

        assert_eq!(
            status.install_state,
            AiCapabilityInstallState::NotDownloaded
        );
        assert_eq!(status.installed_at, None);
    }
}
