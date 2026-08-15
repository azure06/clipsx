use super::ProviderDescriptor;
use crate::providers::error::ProviderResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextEmbeddingSpace {
    pub provider: ProviderDescriptor,
    pub dimensions: usize,
    pub normalization: String,
    pub distance_metric: String,
}

#[async_trait]
pub trait TextEmbeddingProvider: Send + Sync {
    async fn describe(&self) -> ProviderResult<TextEmbeddingSpace>;
    async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>>;
    async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>>;
}
