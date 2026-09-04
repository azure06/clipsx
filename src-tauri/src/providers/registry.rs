pub fn text_embedding_provider(
    config: &TextEmbeddingProviderConfig,
    endpoint: &str,
    model: Option<&str>,
) -> ProviderResult<Box<dyn TextEmbeddingProvider>> {
    if !config.enabled {
        return Err(ProviderError::Disabled);
    }
    match config.provider_id.as_str() {
        OLLAMA_TEXT_EMBEDDING_ID => Ok(Box::new(OllamaTextEmbeddingProvider::new(
            endpoint,
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
    pub model: String,
    pub enabled: bool,
    #[serde(default)]
    pub minimum_similarity_percent: Option<u8>,
}
