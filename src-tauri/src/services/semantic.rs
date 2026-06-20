use anyhow::{anyhow, Context, Result};
use fastembed::{
    InitOptionsUserDefined, Pooling, QuantizationMode, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use tokio::task;

pub const MULTILINGUAL_MODEL: &str = "paraphrase-multilingual-MiniLM-L12-v2";
const ONNX_URL: &str = "https://github.com/azure06/clipsx/releases/download/models-v1/paraphrase-multilingual-MiniLM-L12-v2-model.onnx";
const TOKENIZER_URL: &str = "https://github.com/azure06/clipsx/releases/download/models-v1/paraphrase-multilingual-MiniLM-L12-v2-tokenizer.json";
const EXPECTED_DOWNLOAD_BYTES: u64 = 252_000_000;

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
        model_name: Option<String>,
        message: String,
    },
}

/// Handles Local Semantic Search functionality using fastembed (ONNX Runtime)
/// Model assets are sourced from GitHub Releases (models-v1 tag).
pub struct SemanticService {
    /// Note: We use std::sync::RwLock because fastembed operations are blocking
    /// and should be run inside task::spawn_blocking anyway.
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
            let _ = app.emit("semantic-status-changed", ());
        }
    }

    fn model_cache_dir(&self) -> std::path::PathBuf {
        self.app_data_dir.join(".fastembed_cache")
    }

    fn model_subdir(&self, model_name: &str) -> std::path::PathBuf {
        self.model_cache_dir().join(model_name)
    }

    fn onnx_path(&self, model_name: &str) -> std::path::PathBuf {
        self.model_subdir(model_name).join("model.onnx")
    }

    fn tokenizer_path(&self, model_name: &str) -> std::path::PathBuf {
        self.model_subdir(model_name).join("tokenizer.json")
    }

    fn tokenizer_files(tokenizer_file: Vec<u8>) -> TokenizerFiles {
        TokenizerFiles {
            tokenizer_file,
            config_file: br#"{"pad_token_id":0}"#.to_vec(),
            special_tokens_map_file: br#"{"cls_token":"[CLS]","mask_token":"[MASK]","pad_token":"[PAD]","sep_token":"[SEP]","unk_token":"[UNK]"}"#.to_vec(),
            tokenizer_config_file: br#"{"model_max_length":256,"pad_token":"[PAD]"}"#.to_vec(),
        }
    }

    fn load_user_defined_model(model_dir: &std::path::Path) -> Result<TextEmbedding> {
        let onnx_file = std::fs::read(model_dir.join("model.onnx"))
            .with_context(|| format!("Failed to read model.onnx from {}", model_dir.display()))?;
        let tokenizer_file =
            std::fs::read(model_dir.join("tokenizer.json")).with_context(|| {
                format!("Failed to read tokenizer.json from {}", model_dir.display())
            })?;

        // Multilingual model is a static-quantized ONNX with mean pooling.
        let model =
            UserDefinedEmbeddingModel::new(onnx_file, Self::tokenizer_files(tokenizer_file))
                .with_pooling(Pooling::Mean)
                .with_quantization(QuantizationMode::Static);

        let options = InitOptionsUserDefined::new().with_max_length(256);
        TextEmbedding::try_new_from_user_defined(model, options)
            .map_err(|e| anyhow!("Failed to load embedding model: {}", e))
    }

    /// Downloads (if necessary) and loads the ONNX model into memory.
    /// This is a blocking operation so it must be spawned on a blocking thread.
    pub async fn init_model(
        &self,
        model_name: String,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<()> {
        // Only the multilingual model is supported; normalize legacy values.
        let model_name = if model_name != MULTILINGUAL_MODEL {
            eprintln!(
                "[semantic] Unknown model '{}', falling back to {}",
                model_name, MULTILINGUAL_MODEL
            );
            MULTILINGUAL_MODEL.to_string()
        } else {
            model_name
        };

        let model_arc = self.model.clone();
        let name_arc = self.loaded_model_name.clone();
        let status_arc = self.runtime_status.clone();
        let model_dir = self.model_subdir(&model_name);
        let onnx_path = self.onnx_path(&model_name);
        let tokenizer_path = self.tokenizer_path(&model_name);

        {
            let mut status = self.runtime_status.write().unwrap();
            *status = SemanticRuntimeStatus::Loading {
                model_name: model_name.clone(),
            };
        }
        Self::emit_status_changed(app_handle.as_ref());

        let is_downloaded = self.get_downloaded_models().contains(&model_name);
        let progress_cancel = Arc::new(StdRwLock::new(false));

        if !is_downloaded {
            std::fs::create_dir_all(&model_dir).with_context(|| {
                format!(
                    "Failed to create model cache directory {}",
                    model_dir.display()
                )
            })?;

            if let Some(app) = app_handle.clone() {
                let model_dir_clone = model_dir.clone();
                let cancel_clone = progress_cancel.clone();
                let model_name_clone = model_name.clone();
                let expected_total = EXPECTED_DOWNLOAD_BYTES;

                tokio::spawn(async move {
                    use tauri::Emitter;
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        if *cancel_clone.read().unwrap() {
                            break;
                        }

                        let mut size = 0;
                        if let Ok(entries) = walkdir::WalkDir::new(&model_dir_clone)
                            .into_iter()
                            .collect::<Result<Vec<_>, _>>()
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
                        struct ProgressPayload {
                            model: String,
                            downloaded: u64,
                            total: u64,
                        }

                        let _ = app.emit(
                            "download-progress",
                            ProgressPayload {
                                model: model_name_clone.clone(),
                                downloaded: size,
                                total: expected_total,
                            },
                        );
                    }
                });
            }

            let client = reqwest::Client::new();
            download_file(&client, ONNX_URL, &onnx_path).await?;
            download_file(&client, TOKENIZER_URL, &tokenizer_path).await?;
        }

        let model_name_for_load = model_name.clone();
        let join_result = task::spawn_blocking(move || -> Result<()> {
            let model = Self::load_user_defined_model(&model_dir)?;

            let mut lock = model_arc.write().unwrap();
            *lock = Some(model);

            let mut name_lock = name_arc.write().unwrap();
            *name_lock = Some(model_name_for_load.clone());

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
                    .unwrap_or_else(|| "unknown".to_string());
                let mut status = self.runtime_status.write().unwrap();
                *status = SemanticRuntimeStatus::Ready { model_name };
                Self::emit_status_changed(app_handle.as_ref());
                Ok(())
            }
            Ok(Err(err)) => {
                let mut status = status_arc.write().unwrap();
                *status = SemanticRuntimeStatus::Error {
                    model_name: Some(model_name.clone()),
                    message: err.to_string(),
                };
                Self::emit_status_changed(app_handle.as_ref());
                Err(err)
            }
            Err(err) => {
                let mut status = status_arc.write().unwrap();
                *status = SemanticRuntimeStatus::Error {
                    model_name: Some(model_name.clone()),
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

    /// Checks if the model is currently loaded in memory.
    pub fn is_ready(&self) -> bool {
        self.model.read().unwrap().is_some()
    }

    /// Unloads the model from memory to save RAM when semantic search is disabled.
    pub fn unload_model(&self) {
        let mut lock = self.model.write().unwrap();
        *lock = None;
        let mut name_lock = self.loaded_model_name.write().unwrap();
        *name_lock = None;
        let mut status = self.runtime_status.write().unwrap();
        *status = SemanticRuntimeStatus::Idle;
    }

    /// Returns the currently loaded model name and its dimension size (always 384).
    pub fn get_model_info(&self) -> Option<(String, i32)> {
        let lock = self.loaded_model_name.read().unwrap();
        lock.as_ref().map(|name| (name.clone(), 384))
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

    pub fn set_error_status(&self, model_name: Option<String>, message: String) {
        let mut status = self.runtime_status.write().unwrap();
        *status = SemanticRuntimeStatus::Error {
            model_name,
            message,
        };
    }

    pub fn get_downloaded_models(&self) -> Vec<String> {
        let model_dir = self.model_subdir(MULTILINGUAL_MODEL);
        if model_dir.join("model.onnx").exists() && model_dir.join("tokenizer.json").exists() {
            vec![MULTILINGUAL_MODEL.to_string()]
        } else {
            vec![]
        }
    }

    pub fn delete_model(&self, model_name: &str) -> Result<()> {
        self.unload_model();

        let model_dir = self.model_subdir(model_name);
        if model_dir.exists() {
            std::fs::remove_dir_all(&model_dir).map_err(|e| {
                anyhow!(
                    "Failed to delete model directory {}: {}",
                    model_dir.display(),
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
                    "Semantic model is not loaded. Please initialize it first."
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

async fn download_file(client: &reqwest::Client, url: &str, dest: &std::path::Path) -> Result<()> {
    use tokio::io::AsyncWriteExt as _;

    let mut response = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "clipsx/semantic-service (https://github.com/azure06/clipsx)",
        )
        .send()
        .await
        .context("Download request failed")?;
    let status = response.status();
    if !status.is_success() {
        return Err(anyhow!("Download returned HTTP {}", status));
    }
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .context("Failed to create destination file")?;
    while let Some(chunk) = response
        .chunk()
        .await
        .context("Failed to read response chunk")?
    {
        file.write_all(&chunk)
            .await
            .context("Failed to write chunk to file")?;
    }
    Ok(())
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
    fn test_tokenizer_files_include_required_metadata() {
        let files = SemanticService::tokenizer_files(vec![1, 2, 3]);
        assert_eq!(files.tokenizer_file, vec![1, 2, 3]);
        assert!(!files.config_file.is_empty());
        assert!(!files.special_tokens_map_file.is_empty());
        assert!(!files.tokenizer_config_file.is_empty());
    }
}
