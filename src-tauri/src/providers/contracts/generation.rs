use super::ProviderDescriptor;
use crate::providers::error::ProviderResult;
use async_trait::async_trait;

#[async_trait]
pub trait GenerationProvider: Send + Sync {
    fn descriptor(&self) -> ProviderDescriptor;
    async fn generate(&self, prompt: &str) -> ProviderResult<String>;
}
