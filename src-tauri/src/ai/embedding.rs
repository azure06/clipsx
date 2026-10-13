//! Saved embedding resolution and provider-independent execution information.
use super::{configuration::validate_connection, contracts::*, credentials};
use crate::{
    history::HistoryRepository,
    providers::{
        self,
        contracts::text_embedding::{TextEmbeddingProvider, TextEmbeddingSpace},
        error::ProviderError,
    },
};
use anyhow::{bail, Context, Result};

/// Protocol options and host bounds. Unknown models do not inherit claimed capacities.
pub fn information(provider: AiProviderKind, model: &str) -> EmbeddingModelInformation {
    use providers::contracts::text_embedding::{MAX_BATCH_INPUTS, MAX_INPUT_BYTES};
    let (dimensions, policies, default) = match provider {
        AiProviderKind::Ollama => (Some(false), vec!["symmetric"], "symmetric"),
        AiProviderKind::Openai => (
            if model.starts_with("text-embedding-3-") {
                Some(true)
            } else if model == "text-embedding-ada-002" {
                Some(false)
            } else {
                None
            },
            vec!["symmetric"],
            "symmetric",
        ),
        AiProviderKind::Gemini if model.starts_with("gemini-embedding-2") => {
            (Some(true), vec!["gemini_prefix_v2"], "gemini_prefix_v2")
        }
        AiProviderKind::Gemini if model == "gemini-embedding-001" => (
            Some(true),
            vec!["gemini_retrieval_v1"],
            "gemini_retrieval_v1",
        ),
        AiProviderKind::Gemini => (
            None,
            vec!["gemini_retrieval_v1", "gemini_prefix_v2"],
            "gemini_retrieval_v1",
        ),
        AiProviderKind::Openrouter => (None, vec!["symmetric", "retrieval"], "symmetric"),
        _ => (Some(false), vec![], "symmetric"),
    };
    EmbeddingModelInformation {
        max_input_bytes: MAX_INPUT_BYTES as u32,
        max_batch_inputs: MAX_BATCH_INPUTS as u32,
        configurable_dimensions: dimensions,
        task_policies: policies.into_iter().map(String::from).collect(),
        default_task_policy: default.into(),
        source: "clipsx_protocol_rules_v1".into(),
    }
}

pub async fn verify_embedding(
    repo: &HistoryRepository,
    document: &AiConfiguration,
    id: &str,
) -> Result<(providers::TextEmbeddingProviderConfig, TextEmbeddingSpace)> {
    let preset = document
        .presets
        .iter()
        .find(|v| v.id == id && v.purpose == AiModelPurpose::Embedding)
        .context("missing_embedding_preset")?;
    let connection = document
        .connections
        .iter()
        .find(|v| v.id == preset.connection_id)
        .context("missing_connection")?;
    let provider = embedding_provider_for(repo, connection, preset, None).await?;
    let descriptor = provider.describe().await?;
    let config = providers::TextEmbeddingProviderConfig {
        provider_id: format!("ai-preset:{}", preset.id),
        model: preset.model_id.clone(),
        enabled: true,
        minimum_similarity_percent: None,
    };
    Ok((config, descriptor))
}
pub async fn embedding_provider_for(
    repo: &HistoryRepository,
    connection: &AiConnection,
    preset: &AiModelPreset,
    model: Option<&str>,
) -> Result<Box<dyn TextEmbeddingProvider>> {
    if !connection.enabled {
        bail!("connection_disabled");
    }
    let base = validate_connection(connection)?;
    let model = model.unwrap_or(&preset.model_id);
    if connection.provider == AiProviderKind::Ollama {
        return Ok(Box::new(
            providers::ollama::OllamaTextEmbeddingProvider::new(base.as_str(), model.into())?,
        ));
    }
    let options = preset
        .options
        .embedding
        .as_ref()
        .context("missing_embedding_options")?;
    if !options.hosted_indexing_enabled {
        bail!(crate::failure::FailureCode::HostedIndexingDisabled.failure());
    }
    let credential = credentials::get(repo, &connection.id)
        .await?
        .ok_or(ProviderError::NotConfigured)?;
    Ok(Box::new(
        providers::hosted_embedding::HostedEmbeddingProvider::new(
            connection.clone(),
            model.into(),
            credential,
            options.clone(),
        )?,
    ))
}
pub async fn resolve_embedding(
    repo: &HistoryRepository,
    config: &providers::TextEmbeddingProviderConfig,
    model: Option<&str>,
) -> Result<Box<dyn TextEmbeddingProvider>> {
    if !config.enabled {
        return Err(ProviderError::Disabled.into());
    }
    if let Some(id) = config.provider_id.strip_prefix("ai-preset:") {
        let document = super::configuration::export(repo).await?;
        let preset = document
            .presets
            .iter()
            .find(|v| v.id == id)
            .context("missing_embedding_preset")?;
        let connection = document
            .connections
            .iter()
            .find(|v| v.id == preset.connection_id)
            .context("missing_connection")?;
        return embedding_provider_for(repo, connection, preset, model).await;
    }
    let endpoint = providers::model_catalog::endpoint(repo).await?;
    Ok(providers::text_embedding_provider(
        config, &endpoint, model,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn options_are_embedding_specific_and_unknown_capabilities_stay_unknown() {
        let unknown = information(AiProviderKind::Openrouter, "custom/embedding");
        assert_eq!(unknown.configurable_dimensions, None);
        assert_eq!(unknown.max_input_bytes, 2048);
        assert_eq!(unknown.max_batch_inputs, 16);
        assert_eq!(
            information(AiProviderKind::Openai, "text-embedding-ada-002").configurable_dimensions,
            Some(false)
        );
        assert_eq!(
            information(AiProviderKind::Openai, "text-embedding-3-small").configurable_dimensions,
            Some(true)
        );
        assert_eq!(
            information(AiProviderKind::Ollama, "custom").task_policies,
            vec!["symmetric"]
        );
        assert_eq!(
            information(AiProviderKind::Gemini, "gemini-embedding-2-preview").default_task_policy,
            "gemini_prefix_v2"
        );
        assert_eq!(
            information(AiProviderKind::Gemini, "gemini-embedding-001").default_task_policy,
            "gemini_retrieval_v1"
        );
    }
}
