use crate::providers::{
    contracts::visual_embedding::{VisualEmbeddingProvider, VisualEmbeddingSpace, VisualInput},
    error::{ProviderError, ProviderResult},
};
use async_trait::async_trait;

pub struct DisabledVisualEmbeddingProvider;

#[async_trait]
impl VisualEmbeddingProvider for DisabledVisualEmbeddingProvider {
    async fn describe(&self) -> ProviderResult<VisualEmbeddingSpace> {
        Err(ProviderError::Disabled)
    }

    async fn embed_images(&self, _inputs: &[VisualInput]) -> ProviderResult<Vec<Vec<f32>>> {
        Err(ProviderError::Disabled)
    }

    async fn embed_text_queries(&self, _inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        Err(ProviderError::Disabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disabled_visual_provider_performs_no_work() {
        let provider = DisabledVisualEmbeddingProvider;
        assert_eq!(provider.describe().await, Err(ProviderError::Disabled));
        assert_eq!(
            provider.embed_images(&[]).await,
            Err(ProviderError::Disabled)
        );
        assert_eq!(
            provider.embed_text_queries(&[]).await,
            Err(ProviderError::Disabled)
        );
    }
}
