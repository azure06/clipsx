use super::{visual_embedding::VisualInput, ProviderDescriptor};
use crate::providers::error::ProviderResult;
use async_trait::async_trait;

#[async_trait]
pub trait OcrProvider: Send + Sync {
    fn descriptor(&self) -> ProviderDescriptor;
    async fn recognize(&self, input: &VisualInput) -> ProviderResult<String>;
}
