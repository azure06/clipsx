use anyhow::{anyhow, Result};
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use tokio::task;

pub const ACTIVE_TEXT_MODEL: EmbeddingModel = EmbeddingModel::BGEM3;

#[derive(Debug, Clone)]
pub enum SemanticRuntimeStatus {
    Idle,
    Loading {
        model_name: String,
    },
    Indexing {
        model_name: String,
        done: u64,
        total: u64,
    },
    Ready {
        model_name: String,
    },
    Error {
        message: String,
    },
}

/// Text embedding service for local semantic search.
///
/// The current stack uses fastembed's ONNX Runtime-backed BGE-M3 support while
/// keeping the outer service boundary stable so later runtime work can swap the
/// backend without touching indexing or search orchestration.
///
/// fastembed resolves BGE-M3 from its upstream source and caches files under
/// app_data/.fastembed_cache (or HF_HOME / FASTEMBED_CACHE_DIR when configured).
pub struct SemanticService {
    model: Arc<StdRwLock<Option<TextEmbedding>>>,
    loaded_model_name: Arc<StdRwLock<Option<String>>>,
    runtime_status: Arc<StdRwLock<SemanticRuntimeStatus>>,
    app_data_dir: std::path::PathBuf,
}

impl SemanticService {
    pub fn new(app_data_dir: std::path::PathBuf) -> Self {
        Self {
            model: Arc::new(StdRwLock::new(None)),
            loaded_model_name: Arc::new(StdRwLock::new(None)),
            runtime_status: Arc::new(StdRwLock::new(SemanticRuntimeStatus::Idle)),
            app_data_dir,
        }
    }

    fn emit_status_changed(app_handle: Option<&tauri::AppHandle>) {
        if let Some(app) = app_handle {
            use tauri::Emitter;
            let _ = app.emit("text-search-status-changed", ());
        }
    }

    fn model_cache_dir(&self) -> std::path::PathBuf {
        self.app_data_dir.join(".fastembed_cache")
    }

    fn model_name() -> String {
        TextEmbedding::get_model_info(&ACTIVE_TEXT_MODEL)
            .map(|info| info.model_code.clone())
            .unwrap_or_else(|_| "BAAI/bge-m3".to_string())
    }

    fn model_repo_dir_name() -> String {
        format!("models--{}", Self::model_name().replace('/', "--"))
    }

    fn model_dimensions() -> i32 {
        TextEmbedding::get_model_info(&ACTIVE_TEXT_MODEL)
            .map(|info| info.dim as i32)
            .unwrap_or(1024)
    }

    fn model_dir(&self) -> std::path::PathBuf {
        self.model_cache_dir().join(Self::model_repo_dir_name())
    }

    fn legacy_model_dir(&self) -> std::path::PathBuf {
        self.model_cache_dir().join(Self::model_name())
    }

    fn dir_contains_files(dir: &std::path::Path) -> bool {
        if !dir.exists() {
            return false;
        }

        walkdir::WalkDir::new(dir)
            .into_iter()
            .filter_map(std::result::Result::ok)
            .any(|entry| entry.file_type().is_file())
    }

    pub fn are_model_files_cached(&self) -> bool {
        Self::dir_contains_files(&self.model_dir())
            || Self::dir_contains_files(&self.legacy_model_dir())
    }

    fn should_reset_partial_cache(message: &str) -> bool {
        message.contains("Failed to retrieve")
            || message.contains("Constant_7_attr__value")
            || message.contains("model.onnx_data")
    }

    pub async fn init_model(&self, app_handle: Option<tauri::AppHandle>) -> Result<()> {
        let model_arc = self.model.clone();
        let name_arc = self.loaded_model_name.clone();
        let status_arc = self.runtime_status.clone();
        let cache_dir = self.model_cache_dir();
        let repo_dir = self.model_dir();
        let model_name = Self::model_name();

        {
            let mut status = self.runtime_status.write().unwrap();
            *status = SemanticRuntimeStatus::Loading {
                model_name: model_name.clone(),
            };
        }
        Self::emit_status_changed(app_handle.as_ref());

        let progress_cancel = Arc::new(StdRwLock::new(false));
        if let Some(app) = app_handle.clone() {
            let model_dir = repo_dir.clone();
            let cancel_clone = progress_cancel.clone();
            let model_name_clone = model_name.clone();

            tokio::spawn(async move {
                use tauri::Emitter;
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    if *cancel_clone.read().unwrap() {
                        break;
                    }

                    let mut size = 0;
                    if let Ok(entries) = walkdir::WalkDir::new(&model_dir)
                        .into_iter()
                        .collect::<std::result::Result<Vec<_>, walkdir::Error>>()
                    {
                        for entry in entries {
                            if let Ok(metadata) = entry.metadata() {
                                if metadata.is_file() {
                                    size += metadata.len();
                                }
                            }
                        }
                    }

                    #[derive(serde::Serialize, Clone)]
                    #[serde(rename_all = "camelCase")]
                    struct ProgressPayload {
                        capability: String,
                        label: String,
                        downloaded: u64,
                        total: u64,
                        phase: String,
                    }

                    let _ = app.emit(
                        "ai-capability-progress",
                        ProgressPayload {
                            capability: "text_search".to_string(),
                            label: model_name_clone.clone(),
                            downloaded: size,
                            total: 0,
                            phase: "cache_resolve".to_string(),
                        },
                    );
                }
            });
        }

        let model_name_for_load = model_name.clone();
        let join_result = task::spawn_blocking(move || -> Result<()> {
            let load_model = || {
                TextEmbedding::try_new(
                    TextInitOptions::new(ACTIVE_TEXT_MODEL)
                        .with_cache_dir(cache_dir.clone())
                        .with_show_download_progress(false),
                )
                .map_err(|error| anyhow!("Failed to load BGE-M3: {}", error))
            };

            let model = match load_model() {
                Ok(model) => model,
                Err(error) if SemanticService::should_reset_partial_cache(&error.to_string()) => {
                    if repo_dir.exists() {
                        let _ = std::fs::remove_dir_all(&repo_dir);
                    }

                    load_model()?
                }
                Err(error) => return Err(error),
            };

            let mut lock = model_arc.write().unwrap();
            *lock = Some(model);

            let mut name_lock = name_arc.write().unwrap();
            *name_lock = Some(model_name_for_load);

            Ok(())
        })
        .await;

        *progress_cancel.write().unwrap() = true;

        match join_result {
            Ok(Ok(())) => {
                let model_name = self
                    .loaded_model_name
                    .read()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(Self::model_name);
                let mut status = self.runtime_status.write().unwrap();
                *status = SemanticRuntimeStatus::Ready { model_name };
                Self::emit_status_changed(app_handle.as_ref());
                Ok(())
            }
            Ok(Err(err)) => {
                let mut status = status_arc.write().unwrap();
                *status = SemanticRuntimeStatus::Error {
                    message: err.to_string(),
                };
                Self::emit_status_changed(app_handle.as_ref());
                Err(err)
            }
            Err(err) => {
                let mut status = status_arc.write().unwrap();
                *status = SemanticRuntimeStatus::Error {
                    message: err.to_string(),
                };
                Self::emit_status_changed(app_handle.as_ref());
                Err(err.into())
            }
        }
    }

    pub fn get_runtime_status(&self) -> SemanticRuntimeStatus {
        self.runtime_status.read().unwrap().clone()
    }

    pub fn unload_model(&self) {
        let mut lock = self.model.write().unwrap();
        *lock = None;
        let mut name_lock = self.loaded_model_name.write().unwrap();
        *name_lock = None;
        let mut status = self.runtime_status.write().unwrap();
        *status = SemanticRuntimeStatus::Idle;
    }

    pub fn get_model_info(&self) -> Option<(String, i32)> {
        let lock = self.loaded_model_name.read().unwrap();
        lock.as_ref()
            .map(|name| (name.clone(), Self::model_dimensions()))
    }

    pub fn set_indexing_status(&self, done: u64, total: u64) {
        let model_name = self.loaded_model_name.read().unwrap().clone();
        if let Some(model_name) = model_name {
            let mut status = self.runtime_status.write().unwrap();
            *status = SemanticRuntimeStatus::Indexing {
                model_name,
                done,
                total,
            };
        }
    }

    pub fn set_ready_status(&self) {
        let model_name = self.loaded_model_name.read().unwrap().clone();
        let mut status = self.runtime_status.write().unwrap();
        *status = if let Some(model_name) = model_name {
            SemanticRuntimeStatus::Ready { model_name }
        } else {
            SemanticRuntimeStatus::Idle
        };
    }

    pub fn set_error_status(&self, message: String) {
        let mut status = self.runtime_status.write().unwrap();
        *status = SemanticRuntimeStatus::Error { message };
    }

    pub fn delete_cached_model(&self) -> Result<()> {
        self.unload_model();

        let model_dir = self.model_dir();
        if model_dir.exists() {
            std::fs::remove_dir_all(&model_dir).map_err(|e| {
                anyhow!(
                    "Failed to delete model directory {}: {}",
                    model_dir.display(),
                    e
                )
            })?;
        }

        let legacy_model_dir = self.legacy_model_dir();
        if legacy_model_dir.exists() {
            std::fs::remove_dir_all(&legacy_model_dir).map_err(|e| {
                anyhow!(
                    "Failed to delete legacy model directory {}: {}",
                    legacy_model_dir.display(),
                    e
                )
            })?;
        }

        Ok(())
    }

    pub async fn embed(&self, text: String) -> Result<Vec<f32>> {
        let model_arc = self.model.clone();

        task::spawn_blocking(move || -> Result<Vec<f32>> {
            let mut lock = model_arc.write().unwrap();

            if let Some(model) = lock.as_mut() {
                let embeddings = model
                    .embed(vec![text], None)
                    .map_err(|e| anyhow!("Failed to generate embedding: {}", e))?;

                if let Some(first) = embeddings.into_iter().next() {
                    Ok(first)
                } else {
                    Err(anyhow!("Model returned empty embedding array"))
                }
            } else {
                Err(anyhow!(
                    "Bundled AI text model is not loaded. Please initialize it first."
                ))
            }
        })
        .await?
    }

    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }

        let mut dot_product = 0.0;
        let mut norm_a = 0.0;
        let mut norm_b = 0.0;

        for i in 0..a.len() {
            dot_product += a[i] * b[i];
            norm_a += a[i] * a[i];
            norm_b += b[i] * b[i];
        }

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a.sqrt() * norm_b.sqrt())
    }

    pub fn vector_to_bytes(vec: &[f32]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(vec.len() * 4);
        for &f in vec {
            bytes.extend_from_slice(&f.to_le_bytes());
        }
        bytes
    }

    pub fn bytes_to_vector(bytes: &[u8]) -> Vec<f32> {
        let mut vec = Vec::with_capacity(bytes.len() / 4);
        for chunk in bytes.chunks_exact(4) {
            vec.push(f32::from_le_bytes(chunk.try_into().unwrap()));
        }
        vec
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let vec1 = vec![1.0f32, 0.0, 0.0];
        let vec2 = vec![1.0f32, 0.0, 0.0];
        assert_eq!(SemanticService::cosine_similarity(&vec1, &vec2), 1.0);

        let vec3 = vec![0.0f32, 1.0, 0.0];
        assert_eq!(SemanticService::cosine_similarity(&vec1, &vec3), 0.0);

        let vec4 = vec![1.0f32, 1.0, 0.0];
        let sim = SemanticService::cosine_similarity(&vec1, &vec4);
        assert!((sim - std::f32::consts::FRAC_1_SQRT_2).abs() < 0.001);
    }

    #[test]
    fn test_vector_bytes_round_trip() {
        let original = vec![0.25f32, -1.5, 2.0, 9.125];
        let bytes = SemanticService::vector_to_bytes(&original);
        let restored = SemanticService::bytes_to_vector(&bytes);
        assert_eq!(restored, original);
    }

    #[test]
    fn test_are_model_files_cached_returns_false_when_cache_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let service = SemanticService::new(temp_dir.path().to_path_buf());

        assert!(!service.are_model_files_cached());
    }

    #[test]
    fn test_are_model_files_cached_returns_true_when_repo_cache_has_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let service = SemanticService::new(temp_dir.path().to_path_buf());
        let repo_dir = service.model_dir();

        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("model.onnx"), b"cached").unwrap();

        assert!(service.are_model_files_cached());
    }
}
