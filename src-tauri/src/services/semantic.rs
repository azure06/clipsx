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
    app_data_dir: std::path::PathBuf,
}

impl SemanticService {
    pub fn new(app_data_dir: std::path::PathBuf) -> Self {
        Self {
            model: Arc::new(StdRwLock::new(None)),
            app_data_dir,
        }
    }

    /// Downloads (if necessary) and loads the ONNX model into memory.
    /// This is a blocking operation so it must be spawned on a blocking thread.
    pub async fn init_model(&self, model_name: String) -> Result<()> {
        let model_arc = self.model.clone();
        let cache_dir = self.app_data_dir.join(".fastembed_cache");

        task::spawn_blocking(move || -> Result<()> {
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
            Ok(())
        })
        .await??;

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
