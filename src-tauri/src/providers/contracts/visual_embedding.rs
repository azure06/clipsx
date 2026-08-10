use super::ProviderDescriptor;
use crate::providers::error::{ProviderError, ProviderResult};
use async_trait::async_trait;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisualInput {
    pub bytes: Arc<[u8]>,
    pub mime_type: String,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VisualEmbeddingSpace {
    pub provider: ProviderDescriptor,
    pub dimensions: usize,
    pub normalization: String,
    pub distance_metric: String,
    pub modality: String,
}

impl VisualEmbeddingSpace {
    pub fn validate(&self) -> ProviderResult<()> {
        if self.dimensions == 0 {
            return Err(ProviderError::InvalidDescriptor(
                "dimensions must be positive".into(),
            ));
        }
        if self.modality != "multimodal" {
            return Err(ProviderError::InvalidDescriptor(
                "visual providers must declare a shared multimodal space".into(),
            ));
        }
        if self.normalization != "l2" || self.distance_metric != "cosine" {
            return Err(ProviderError::InvalidDescriptor(
                "M4b requires L2-normalized cosine vectors".into(),
            ));
        }
        Ok(())
    }

    pub fn validate_batch(&self, vectors: &[Vec<f32>], expected: usize) -> ProviderResult<()> {
        self.validate()?;
        if vectors.len() != expected {
            return Err(ProviderError::InvalidOutput(
                "vector count does not match input count".into(),
            ));
        }
        for vector in vectors {
            if vector.len() != self.dimensions || vector.iter().any(|value| !value.is_finite()) {
                return Err(ProviderError::InvalidOutput(
                    "invalid vector dimensions or values".into(),
                ));
            }
            let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
            if !(0.98..=1.02).contains(&norm) {
                return Err(ProviderError::InvalidOutput(
                    "vector is not L2 normalized".into(),
                ));
            }
        }
        Ok(())
    }
}

/// Compatible image and text-query vectors in one immutable space.
/// TODO(M4b): connect an explicitly installed, checksum-verified local package.
#[async_trait]
pub trait VisualEmbeddingProvider: Send + Sync {
    async fn describe(&self) -> ProviderResult<VisualEmbeddingSpace>;
    async fn embed_images(&self, inputs: &[VisualInput]) -> ProviderResult<Vec<Vec<f32>>>;
    async fn embed_text_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> VisualEmbeddingSpace {
        VisualEmbeddingSpace {
            provider: ProviderDescriptor {
                provider_id: "test.visual".into(),
                provider_version: "1".into(),
                model_id: "test".into(),
                model_revision: "sha256:test".into(),
            },
            dimensions: 2,
            normalization: "l2".into(),
            distance_metric: "cosine".into(),
            modality: "multimodal".into(),
        }
    }

    #[test]
    fn validates_shared_space_and_vectors() {
        assert!(space().validate_batch(&[vec![1.0, 0.0]], 1).is_ok());
        let mut invalid = space();
        invalid.modality = "image".into();
        assert!(invalid.validate().is_err());
        assert!(space().validate_batch(&[vec![2.0, 0.0]], 1).is_err());
    }
}
