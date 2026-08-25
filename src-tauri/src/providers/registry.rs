#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCapability {
    TextEmbedding,
    VisualEmbedding,
    VisionDescription,
    Generation,
    Ocr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderRegistration {
    pub id: &'static str,
    pub capability: ProviderCapability,
    pub available: bool,
}

pub fn provider_capabilities() -> Vec<ProviderRegistration> {
    vec![
        ProviderRegistration {
            id: OLLAMA_TEXT_EMBEDDING_ID,
            capability: ProviderCapability::TextEmbedding,
            available: true,
        },
        ProviderRegistration {
            id: "builtin.visual.disabled",
            capability: ProviderCapability::VisualEmbedding,
            available: false,
        },
        ProviderRegistration {
            id: "builtin.vision-description.disabled",
            capability: ProviderCapability::VisionDescription,
            available: false,
        },
        ProviderRegistration {
            id: "builtin.generation.disabled",
            capability: ProviderCapability::Generation,
            available: false,
        },
        ProviderRegistration {
            id: "builtin.ocr.native",
            capability: ProviderCapability::Ocr,
            available: crate::artifacts::ocr_runtime_available(),
        },
    ]
}

pub fn text_embedding_provider(
    config: &TextEmbeddingProviderConfig,
    model: Option<&str>,
) -> ProviderResult<Box<dyn TextEmbeddingProvider>> {
    if !config.enabled {
        return Err(ProviderError::Disabled);
    }
    match config.provider_id.as_str() {
        OLLAMA_TEXT_EMBEDDING_ID => Ok(Box::new(OllamaTextEmbeddingProvider::new(
            &config.endpoint,
            model.unwrap_or(&config.model).to_string(),
        )?)),
        value => Err(ProviderError::Unavailable(format!(
            "unknown text-embedding provider {value}"
        ))),
    }
}
use crate::providers::{
    contracts::text_embedding::TextEmbeddingProvider,
    error::{ProviderError, ProviderResult},
    ollama::OllamaTextEmbeddingProvider,
};
use serde::{Deserialize, Serialize};

pub const OLLAMA_TEXT_EMBEDDING_ID: &str = "builtin.embedding.ollama";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextEmbeddingProviderConfig {
    pub provider_id: String,
    pub endpoint: String,
    pub model: String,
    pub enabled: bool,
}
