use super::{visual_embedding::VisualInput, ProviderDescriptor};
use crate::providers::error::ProviderResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguage {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrProviderDiagnostics {
    pub provider_id: String,
    pub provider_version: String,
    pub available: bool,
    pub languages: Vec<OcrLanguage>,
    pub recovery_code: Option<String>,
    pub recovery_message: Option<String>,
}

// async_trait adds must_use to an already must-use boxed Future.
#[allow(clippy::double_must_use)]
#[async_trait]
pub trait OcrProvider: Send + Sync {
    fn descriptor(&self) -> ProviderDescriptor;
    async fn diagnostics(&self) -> ProviderResult<OcrProviderDiagnostics>;
    async fn recognize(&self, input: &VisualInput, language: &str) -> ProviderResult<String>;
}
