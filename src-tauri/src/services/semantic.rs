use anyhow::{anyhow, Result};
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use tokio::task;

/// Handes Local Semantic Search functionality using fastembed.
pub struct SemanticService {
    /// Note: We use std::sync::RwLock because fastembed operations are blocking
    /// and should be run inside task::spawn_blocking anyway.
    model: Arc<StdRwLock<Option<TextEmbedding>>>,
    // Track the name of the currently loaded model
    loaded_model_name: Arc<StdRwLock<Option<String>>>,
    app_data_dir: std::path::PathBuf,
}

impl SemanticService {
    pub fn new(app_data_dir: std::path::PathBuf) -> Self {
        Self {
            model: Arc::new(StdRwLock::new(None)),
            loaded_model_name: Arc::new(StdRwLock::new(None)),
            app_data_dir,
        }
    }

    /// Downloads (if necessary) and loads the ONNX model into memory.
    /// This is a blocking operation so it must be spawned on a blocking thread.
    pub async fn init_model(
        &self,
        model_name: String,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<()> {
        let model_arc = self.model.clone();
        let name_arc = self.loaded_model_name.clone();
        let cache_dir = self.app_data_dir.join(".fastembed_cache");

        // We know the approximate sizes of the repositories for progress bars
        let expected_total_bytes: u64 = match model_name.as_str() {
            "all-MiniLM-L6-v2" => 85_000_000,
            "paraphrase-multilingual-MiniLM-L12-v2" => 450_000_000,
            _ => 100_000_000,
        };

        // If we need to send progress events, spawn a poller
        let is_downloaded = self.get_downloaded_models().contains(&model_name);
        let progress_cancel = Arc::new(StdRwLock::new(false));

        if !is_downloaded {
            if let Some(app) = app_handle {
                let cache_clone = cache_dir.clone();
                let cancel_clone = progress_cancel.clone();
                let m_name = model_name.clone();

                tokio::spawn(async move {
                    use tauri::Emitter;
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        if *cancel_clone.read().unwrap() {
                            break;
                        }

                        // Calculate dir size
                        let mut size = 0;
                        if let Ok(entries) = walkdir::WalkDir::new(&cache_clone)
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

                        // Send event
                        #[derive(serde::Serialize, Clone)]
                        struct ProgressPayload {
                            model: String,
                            downloaded: u64,
                            total: u64,
                        }

                        let _ = app.emit(
                            "download-progress",
                            ProgressPayload {
                                model: m_name.clone(),
                                downloaded: size,
                                total: expected_total_bytes,
                            },
                        );
                    }
                });
            }
        }

        let res = task::spawn_blocking(move || -> Result<()> {
            let model_enum = match model_name.as_str() {
                "all-MiniLM-L6-v2" => EmbeddingModel::AllMiniLML6V2,
                "paraphrase-multilingual-MiniLM-L12-v2" => EmbeddingModel::ParaphraseMLMiniLML12V2,
                _ => EmbeddingModel::AllMiniLML6V2, // Default fallback
            };

            let mut options = InitOptions::new(model_enum);
            options.cache_dir = cache_dir;

            let model = TextEmbedding::try_new(options)
                .map_err(|e| anyhow!("Failed to load embedding model: {}", e))?;

            let mut lock = model_arc.write().unwrap();
            *lock = Some(model);

            let mut name_lock = name_arc.write().unwrap();
            *name_lock = Some(model_name.clone());

            Ok(())
        })
        .await?;

        // Stop poller
        *progress_cancel.write().unwrap() = true;

        // Flatten the double Result from spawn_blocking
        res?;

        Ok(())
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
    }

    /// Returns the currently loaded model name and its dimension size.
    pub fn get_model_info(&self) -> Option<(String, i32)> {
        let lock = self.loaded_model_name.read().unwrap();
        if let Some(name) = lock.as_ref() {
            let dim = match name.as_str() {
                "paraphrase-multilingual-MiniLM-L12-v2" => 384,
                "all-MiniLM-L6-v2" => 384,
                _ => 384, // Default fallback dimension
            };
            Some((name.clone(), dim))
        } else {
            None
        }
    }

    /// Returns a list of model IDs (e.g., "all-MiniLM-L6-v2") that have been downloaded
    /// by checking the .fastembed_cache directory for corresponding folders.
    pub fn get_downloaded_models(&self) -> Vec<String> {
        let cache_dir = self.app_data_dir.join(".fastembed_cache");
        let mut downloaded = Vec::new();

        if let Ok(entries) = std::fs::read_dir(cache_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        let dir_name = entry.file_name().to_string_lossy().to_string();
                        // fastembed usually creates folders like "fast-all-MiniLM-L6-v2"
                        if dir_name.contains("all-MiniLM-L6-v2") {
                            downloaded.push("all-MiniLM-L6-v2".to_string());
                        } else if dir_name.contains("paraphrase-multilingual-MiniLM-L12-v2") {
                            downloaded.push("paraphrase-multilingual-MiniLM-L12-v2".to_string());
                        }
                    }
                }
            }
        }

        // Deduplicate in case multiple folders match
        downloaded.sort();
        downloaded.dedup();
        downloaded
    }

    /// Deletes the cached model files for a given model ID to free up disk space.
    pub fn delete_model(&self, model_name: &str) -> Result<()> {
        // If the model to delete is currently loaded, unload it first
        {
            let lock = self.model.read().unwrap();
            if lock.is_some() {
                // We're just checking if any model is loaded.
                // A more robust check would verify if the loaded model IS the one being deleted,
                // but since fastembed doesn't expose the loaded model name easily, we can just
                // unload whatever is in memory if we are doing a delete operation, leaving it safe.
            }
        }
        self.unload_model();

        let cache_dir = self.app_data_dir.join(".fastembed_cache");
        if let Ok(entries) = std::fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        let dir_name = entry.file_name().to_string_lossy().to_string();
                        if dir_name.contains(model_name) {
                            let path = entry.path();
                            std::fs::remove_dir_all(&path).map_err(|e| {
                                anyhow!(
                                    "Failed to delete model directory {}: {}",
                                    path.display(),
                                    e
                                )
                            })?;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Generates an embedding vector for the given text.
    pub async fn embed(&self, text: String) -> Result<Vec<f32>> {
        let model_arc = self.model.clone();

        task::spawn_blocking(move || -> Result<Vec<f32>> {
            let mut lock = model_arc.write().unwrap();

            if let Some(model) = lock.as_mut() {
                // fastembed expects an array of strings
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

    /// Calculate the cosine similarity between two vectors.
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

    /// Serialize f32 vector to bytes for SQLite storage
    pub fn vector_to_bytes(vec: &[f32]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(vec.len() * 4);
        for &f in vec {
            bytes.extend_from_slice(&f.to_le_bytes());
        }
        bytes
    }

    /// Deserialize bytes from SQLite to f32 vector
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
        let vec1 = vec![1.0, 0.0, 0.0];
        let vec2 = vec![1.0, 0.0, 0.0];
        assert_eq!(SemanticService::cosine_similarity(&vec1, &vec2), 1.0);

        let vec3 = vec![0.0, 1.0, 0.0];
        assert_eq!(SemanticService::cosine_similarity(&vec1, &vec3), 0.0);

        let vec4 = vec![1.0, 1.0, 0.0];
        // Dot product = 1.0
        // Norm A = 1.0, Norm B = sqrt(2) ~ 1.414
        // Sim = 1 / 1.414 ~ 0.707
        let sim = SemanticService::cosine_similarity(&vec1, &vec4);
        assert!((sim - 0.7071).abs() < 0.001);
    }
}
