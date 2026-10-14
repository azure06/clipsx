//! Nonsecret space bindings retain execution options, never copies of credentials.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum EmbeddingBinding {
    Named {
        connection: AiConnection,
        preset: Box<AiModelPreset>,
    },
    LegacyOllama {
        endpoint: String,
        config: providers::TextEmbeddingProviderConfig,
    },
}

pub(crate) async fn capture_binding(
    repo: &HistoryRepository,
    config: &providers::TextEmbeddingProviderConfig,
) -> Result<EmbeddingBinding> {
    if let Some(id) = config.provider_id.strip_prefix("ai-preset:") {
        let document = super::super::configuration::export(repo).await?;
        let mut preset = document
            .presets
            .iter()
            .find(|p| p.id == id && p.purpose == AiModelPurpose::Embedding)
            .cloned()
            .context("missing_embedding_preset")?;
        let connection = document
            .connections
            .iter()
            .find(|c| c.id == preset.connection_id)
            .cloned()
            .context("missing_connection")?;
        preset.model_id = config.model.clone();
        Ok(EmbeddingBinding::Named {
            connection,
            preset: Box::new(preset),
        })
    } else if config.provider_id == providers::OLLAMA_TEXT_EMBEDDING_ID {
        Ok(EmbeddingBinding::LegacyOllama {
            endpoint: providers::model_catalog::endpoint(repo).await?,
            config: config.clone(),
        })
    } else {
        bail!("unsupported_embedding_provider");
    }
}

pub(crate) async fn resolve_binding(
    repo: &HistoryRepository,
    binding: &EmbeddingBinding,
) -> Result<Box<dyn TextEmbeddingProvider>> {
    match binding {
        EmbeddingBinding::Named { connection, preset } => {
            let document = super::super::configuration::export(repo).await?;
            let current = document
                .connections
                .iter()
                .find(|c| c.id == connection.id && c.enabled)
                .context("embedding_binding_unavailable")?;
            let current_preset = document
                .presets
                .iter()
                .find(|p| {
                    p.id == preset.id
                        && p.connection_id == connection.id
                        && p.purpose == AiModelPurpose::Embedding
                })
                .context("embedding_binding_unavailable")?;
            // Credentials are live references. Never send a rotated key to a retired endpoint
            // or organization, even when a retained index still names that configuration.
            if current.provider != connection.provider
                || validate_connection(current)? != validate_connection(connection)?
                || serde_json::to_value(&current.options)?
                    != serde_json::to_value(&connection.options)?
            {
                bail!("embedding_binding_unavailable");
            }
            if connection.provider != AiProviderKind::Ollama
                && !current_preset
                    .options
                    .embedding
                    .as_ref()
                    .is_some_and(|o| o.hosted_indexing_enabled)
            {
                bail!(crate::failure::FailureCode::HostedIndexingDisabled.failure());
            }
            embedding_provider_for(repo, connection, preset, None).await
        }
        EmbeddingBinding::LegacyOllama { endpoint, config } => {
            if providers::model_catalog::endpoint(repo).await? != *endpoint {
                bail!("embedding_binding_unavailable");
            }
            Ok(providers::text_embedding_provider(config, endpoint, None)?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hosted_bindings_freeze_options_but_respect_live_credentials_and_access() {
        let (_root, service) = crate::recall::service_tests::repository().await;
        let repo = &service.history;
        let connection = AiConnection {
            id: crate::history::new_id(),
            name: "Hosted fixture".into(),
            provider: AiProviderKind::Openrouter,
            base_url: "https://fixture.invalid/v1/".into(),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        let preset = AiModelPreset {
            id: crate::history::new_id(),
            name: "Hosted fixture".into(),
            connection_id: connection.id.clone(),
            model_id: "fixture-model".into(),
            purpose: AiModelPurpose::Embedding,
            context_limit: 32768,
            output_limit: 4096,
            options: AiPresetOptions {
                embedding: Some(EmbeddingPresetOptions {
                    dimensions: Some(2),
                    task_policy: "symmetric".into(),
                    hosted_indexing_enabled: true,
                }),
                ..super::super::super::configuration::default_options()
            },
            capabilities: super::super::super::configuration::unknown_capabilities(),
        };
        let mut document = AiConfiguration {
            version: 3,
            connections: vec![connection.clone()],
            presets: vec![preset.clone()],
            selections: AiSelections::default(),
        };
        super::super::super::configuration::import(repo, document.clone())
            .await
            .unwrap();
        credentials::set(repo, &connection.id, Some("private-fixture-key".into()))
            .await
            .unwrap();
        let config = providers::TextEmbeddingProviderConfig {
            provider_id: format!("ai-preset:{}", preset.id),
            model: preset.model_id,
            enabled: true,
            minimum_similarity_percent: None,
        };
        let binding = capture_binding(repo, &config).await.unwrap();
        let provider = resolve_binding(repo, &binding).await.unwrap();
        let space = provider.descriptor_for_dimensions(2).unwrap();
        document.presets[0]
            .options
            .embedding
            .as_mut()
            .unwrap()
            .dimensions = Some(4);
        document.presets[0]
            .options
            .embedding
            .as_mut()
            .unwrap()
            .task_policy = "retrieval".into();
        super::super::super::configuration::import(repo, document.clone())
            .await
            .unwrap();
        credentials::set(repo, &connection.id, Some("rotated-fixture-key".into()))
            .await
            .unwrap();
        let reopened: EmbeddingBinding =
            serde_json::from_str(&serde_json::to_string(&binding).unwrap()).unwrap();
        resolve_binding(repo, &reopened)
            .await
            .unwrap()
            .verify_space(&space)
            .await
            .unwrap();
        assert!(!serde_json::to_string(&binding)
            .unwrap()
            .contains("fixture-key"));
        assert!(super::super::resolve_embedding(repo, &config, None)
            .await
            .unwrap()
            .verify_space(&space)
            .await
            .is_err());

        document.connections[0].base_url = "https://retired.invalid/v1".into();
        super::super::super::configuration::import(repo, document.clone())
            .await
            .unwrap();
        assert!(resolve_binding(repo, &binding).await.is_err());
        document.connections[0] = connection;
        document.presets[0]
            .options
            .embedding
            .as_mut()
            .unwrap()
            .hosted_indexing_enabled = false;
        super::super::super::configuration::import(repo, document.clone())
            .await
            .unwrap();
        assert!(resolve_binding(repo, &binding).await.is_err());
        document.presets[0]
            .options
            .embedding
            .as_mut()
            .unwrap()
            .hosted_indexing_enabled = true;
        document.connections[0].enabled = false;
        super::super::super::configuration::import(repo, document.clone())
            .await
            .unwrap();
        assert!(resolve_binding(repo, &binding).await.is_err());
        super::super::super::configuration::remove(
            repo,
            Some(document.connections[0].id.clone()),
            None,
        )
        .await
        .unwrap();
        assert!(resolve_binding(repo, &binding).await.is_err());
    }
}
