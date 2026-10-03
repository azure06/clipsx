use super::ProviderDescriptor;
use crate::providers::{contracts::visual_embedding::VisualInput, error::ProviderResult};
use async_trait::async_trait;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisionDescription {
    pub text: String,
    pub input_sha256: String,
}

/// Produces inspectable derived text; it is deliberately not a visual embedding provider.
/// TODO(M4b): add an optional Ollama implementation and artifact provenance.
// async_trait adds must_use to an already must-use boxed Future.
#[allow(clippy::double_must_use)]
#[async_trait]
pub trait VisionDescriptionProvider: Send + Sync {
    fn descriptor(&self) -> ProviderDescriptor;
    async fn describe_images(
        &self,
        inputs: &[VisualInput],
    ) -> ProviderResult<Vec<VisionDescription>>;
}
