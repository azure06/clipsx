use super::ProviderDescriptor;
use crate::providers::error::ProviderResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Application execution bounds, not advertised model capacities.
pub const MAX_INPUT_BYTES: usize = 2_048;
pub const MAX_BATCH_INPUTS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextEmbeddingSpace {
    pub provider: ProviderDescriptor,
    pub dimensions: usize,
    pub normalization: String,
    pub distance_metric: String,
}

// async_trait adds must_use to an already must-use boxed Future.
#[allow(clippy::double_must_use)]
#[async_trait]
pub trait TextEmbeddingProvider: Send + Sync {
    /// Hosted adapters can verify immutable space policy without a paid network probe.
    fn descriptor_for_dimensions(&self, _dimensions: usize) -> Option<TextEmbeddingSpace> {
        None
    }
    async fn describe(&self) -> ProviderResult<TextEmbeddingSpace>;
    /// Runtime work must verify the complete space; absence of a cheap descriptor is not approval.
    async fn verify_space(&self, expected: &TextEmbeddingSpace) -> ProviderResult<()> {
        let actual = match self.descriptor_for_dimensions(expected.dimensions) {
            Some(value) => value,
            None => self.describe().await?,
        };
        if actual != *expected {
            return Err(crate::providers::error::ProviderError::EmbeddingSpaceChanged);
        }
        Ok(())
    }
    async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>>;
    async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>>;
}
