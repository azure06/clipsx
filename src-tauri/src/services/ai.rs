use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::models::{AiStackInstallState, AiStackManifest};
use crate::services::ai_assets;
use crate::services::semantic::SemanticService;
use crate::services::visual::VisualService;

static STACK_MANIFEST_TEMPLATE: LazyLock<AiStackManifest> = LazyLock::new(|| {
    serde_json::from_str(include_str!("ai_stack_manifest_v1.json"))
        .expect("Embedded AI stack manifest must be valid")
});

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedAiStackState {
    version: Option<String>,
    install_state: AiStackInstallState,
    installed_at: Option<i64>,
    last_error: Option<String>,
}

pub struct AiStackService {
    app_data_dir: PathBuf,
    state_path: PathBuf,
}

impl AiStackService {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&app_data_dir).context("Failed to create AI stack data directory")?;
        Ok(Self {
            state_path: app_data_dir.join("ai-stack-state.json"),
            app_data_dir,
        })
    }

    pub fn stack_version(&self) -> String {
        self.manifest_template().version
    }

    pub fn manifest_template(&self) -> AiStackManifest {
        STACK_MANIFEST_TEMPLATE.clone()
    }

    pub fn supports_version(&self, version: &str) -> bool {
        self.manifest_template().version == version
    }

    fn emit_status_changed(app_handle: &AppHandle) {
        let _ = app_handle.emit("ai-stack-status-changed", ());
    }

    fn load_persisted_state(&self) -> Result<PersistedAiStackState> {
        if !self.state_path.exists() {
            return Ok(PersistedAiStackState::default());
        }

        let contents =
            fs::read_to_string(&self.state_path).context("Failed to read AI stack state file")?;
        let state = serde_json::from_str(&contents).context("Failed to parse AI stack state")?;
        Ok(state)
    }

    fn save_persisted_state(&self, state: &PersistedAiStackState) -> Result<()> {
        let json =
            serde_json::to_string_pretty(state).context("Failed to serialize AI stack state")?;
        let temp_path = self.state_path.with_extension("json.tmp");
        fs::write(&temp_path, json).context("Failed to write temporary AI stack state")?;
        fs::rename(&temp_path, &self.state_path).context("Failed to persist AI stack state")?;
        Ok(())
    }

    fn remove_persisted_state(&self) -> Result<()> {
        if self.state_path.exists() {
            fs::remove_file(&self.state_path).context("Failed to remove AI stack state file")?;
        }
        Ok(())
    }

    pub fn current_manifest(
        &self,
        semantic_service: &SemanticService,
        visual_service: &VisualService,
    ) -> Result<AiStackManifest> {
        let template = self.manifest_template();
        let persisted = self.load_persisted_state()?;
        let persisted = if persisted.version.as_deref() == Some(template.version.as_str()) {
            persisted
        } else {
            PersistedAiStackState::default()
        };
        let mut manifest = template;

        // The managed install currently owns image_embedding and OCR artifacts.
        // Text embedding uses fastembed cache resolution and is tracked separately
        // via semantic runtime status, not manifest install state.
        let _ = semantic_service;
        let has_visual_assets = visual_service.are_models_downloaded();

        let (install_state, last_error) = match has_visual_assets {
            true => (AiStackInstallState::Ready, None),
            false if persisted.install_state == AiStackInstallState::Downloading => (
                AiStackInstallState::Downloading,
                persisted.last_error.clone(),
            ),
            false if persisted.install_state == AiStackInstallState::Error => {
                (AiStackInstallState::Error, persisted.last_error.clone())
            }
            _ => (AiStackInstallState::NotDownloaded, None),
        };

        manifest.install_state = install_state;
        manifest.installed_at = if manifest.install_state == AiStackInstallState::Ready {
            persisted.installed_at
        } else {
            None
        };
        manifest.last_error = last_error;

        Ok(manifest)
    }

    pub async fn install_stack(
        &self,
        stack_version: &str,
        semantic_service: &SemanticService,
        visual_service: &VisualService,
        app_handle: &AppHandle,
    ) -> Result<AiStackManifest> {
        if !self.supports_version(stack_version) {
            anyhow::bail!("Unsupported AI stack: {}", stack_version);
        }

        self.mark_installing(stack_version)?;
        Self::emit_status_changed(app_handle);

        let all_artifacts: Vec<_> = self
            .manifest_template()
            .components
            .into_iter()
            .flat_map(|c| c.artifacts)
            .collect();

        if let Err(error) =
            ai_assets::install_artifacts(&all_artifacts, &self.app_data_dir, app_handle).await
        {
            semantic_service.unload_model();
            visual_service.unload_models();
            self.mark_error(stack_version, error.to_string())?;
            Self::emit_status_changed(app_handle);
            return Err(error);
        }

        if let Err(error) = semantic_service.init_model(Some(app_handle.clone())).await {
            semantic_service.set_error_status(Some("BAAI/bge-m3".to_string()), error.to_string());
        }

        if let Err(error) = visual_service.preload_models().await {
            semantic_service.unload_model();
            visual_service.unload_models();
            self.mark_error(stack_version, error.to_string())?;
            Self::emit_status_changed(app_handle);
            return Err(error);
        }

        self.mark_ready(stack_version)?;
        Self::emit_status_changed(app_handle);
        self.current_manifest(semantic_service, visual_service)
    }

    pub fn delete_stack(
        &self,
        stack_version: &str,
        semantic_service: &SemanticService,
        visual_service: &VisualService,
        app_handle: &AppHandle,
    ) -> Result<AiStackManifest> {
        if !self.supports_version(stack_version) {
            anyhow::bail!("Unsupported AI stack: {}", stack_version);
        }

        semantic_service.delete_cached_model()?;
        visual_service.delete_cached_models()?;
        self.clear()?;
        Self::emit_status_changed(app_handle);
        self.current_manifest(semantic_service, visual_service)
    }

    fn mark_installing(&self, version: &str) -> Result<()> {
        self.save_persisted_state(&PersistedAiStackState {
            version: Some(version.to_string()),
            install_state: AiStackInstallState::Downloading,
            installed_at: None,
            last_error: None,
        })
    }

    fn mark_ready(&self, version: &str) -> Result<()> {
        self.save_persisted_state(&PersistedAiStackState {
            version: Some(version.to_string()),
            install_state: AiStackInstallState::Ready,
            installed_at: Some(chrono::Utc::now().timestamp()),
            last_error: None,
        })
    }

    fn mark_error(&self, version: &str, message: String) -> Result<()> {
        self.save_persisted_state(&PersistedAiStackState {
            version: Some(version.to_string()),
            install_state: AiStackInstallState::Error,
            installed_at: None,
            last_error: Some(message),
        })
    }

    fn clear(&self) -> Result<()> {
        self.remove_persisted_state()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_services() -> (TempDir, AiStackService, SemanticService, VisualService) {
        let temp_dir = TempDir::new().unwrap();
        let base_dir = temp_dir.path().to_path_buf();
        let service = AiStackService::new(base_dir.clone()).unwrap();
        let semantic = SemanticService::new(base_dir.clone());
        let visual = VisualService::new(base_dir);
        (temp_dir, service, semantic, visual)
    }

    #[test]
    fn reports_not_downloaded_by_default() {
        let (_tmp, service, semantic, visual) = create_services();
        let manifest = service.current_manifest(&semantic, &visual).unwrap();
        assert_eq!(manifest.install_state, AiStackInstallState::NotDownloaded);
        assert!(manifest.last_error.is_none());
    }

    #[test]
    fn persisted_error_survives_without_assets() {
        let (_tmp, service, semantic, visual) = create_services();
        service
            .mark_error(&service.stack_version(), "boom".to_string())
            .unwrap();
        let manifest = service.current_manifest(&semantic, &visual).unwrap();
        assert_eq!(manifest.install_state, AiStackInstallState::Error);
        assert_eq!(manifest.last_error.as_deref(), Some("boom"));
    }

    #[test]
    fn manifest_template_loads_embedded_components() {
        let (_tmp, service, _semantic, _visual) = create_services();
        let manifest = service.manifest_template();
        assert_eq!(manifest.version, "clipsx-ai-v1");
        assert_eq!(manifest.components.len(), 3);
        assert!(manifest
            .components
            .iter()
            .any(|component| component.kind
                == crate::models::ai::AiStackComponentKind::TextEmbedding));
    }

    #[test]
    fn supports_only_embedded_stack_version() {
        let (_tmp, service, _semantic, _visual) = create_services();
        assert!(service.supports_version("clipsx-ai-v1"));
        assert!(!service.supports_version("clipsx-ai-v2"));
    }
}
