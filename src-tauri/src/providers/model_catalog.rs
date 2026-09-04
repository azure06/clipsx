use crate::history::{now_ms, HistoryRepository};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::{error::ProviderError, ollama};

pub const OLLAMA_MODEL_PROVIDER_ID: &str = "builtin.model_provider.ollama";
const OLLAMA_CONNECTION_KEY: &str = "providers.ollama.connection";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelCapability {
    TextEmbedding,
    TextGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub digest: Option<String>,
    pub size: Option<u64>,
    pub capabilities: Vec<ModelCapability>,
    pub inspection_diagnostic: Option<String>,
}

impl ModelDescriptor {
    pub fn supports(&self, capability: ModelCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelProviderConnectionState {
    NotConfigured,
    Ready,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderConnectionStatus {
    pub provider_id: String,
    pub display_name: String,
    pub configured: bool,
    pub endpoint: Option<String>,
    pub state: ModelProviderConnectionState,
    pub diagnostic: Option<String>,
    pub models: Vec<ModelDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OllamaConnectionConfig {
    provider_id: String,
    endpoint: String,
}

pub async fn state(repo: &HistoryRepository) -> Result<ModelProviderConnectionStatus> {
    let Some(config) = get_connection(repo).await? else {
        return Ok(not_configured());
    };
    let mut status = inspect(&config.provider_id, config.endpoint).await;
    status.configured = true;
    record_connection_observation(repo, &status).await?;
    Ok(status)
}

pub async fn inspect(provider_id: &str, endpoint: String) -> ModelProviderConnectionStatus {
    if provider_id != OLLAMA_MODEL_PROVIDER_ID {
        return degraded(
            provider_id,
            Some(endpoint),
            format!("unknown model provider {provider_id}"),
        );
    }
    match ollama::discover_models(&endpoint).await {
        Ok(models) => ModelProviderConnectionStatus {
            provider_id: provider_id.into(),
            display_name: "Ollama".into(),
            configured: false,
            endpoint: Some(endpoint),
            state: ModelProviderConnectionState::Ready,
            diagnostic: None,
            models,
        },
        Err(error) => degraded(provider_id, Some(endpoint), error.to_string()),
    }
}

pub async fn save(
    repo: &HistoryRepository,
    provider_id: String,
    endpoint: String,
) -> Result<ModelProviderConnectionStatus> {
    let mut status = inspect(&provider_id, endpoint).await;
    if status.state != ModelProviderConnectionState::Ready {
        bail!(
            "{}",
            status
                .diagnostic
                .as_deref()
                .unwrap_or("model provider is unavailable")
        );
    }
    let endpoint = status
        .endpoint
        .clone()
        .context("validated endpoint is missing")?;
    let config = OllamaConnectionConfig {
        provider_id,
        endpoint,
    };
    put_connection(repo, &config).await?;
    status.configured = true;
    record_connection_observation(repo, &status).await?;
    Ok(status)
}

pub async fn endpoint(repo: &HistoryRepository) -> Result<String> {
    get_connection(repo)
        .await?
        .map(|config| config.endpoint)
        .context("Ollama connection is not configured")
}

pub async fn require_model(
    repo: &HistoryRepository,
    model: &str,
    capability: ModelCapability,
) -> Result<ModelDescriptor> {
    let endpoint = endpoint(repo).await?;
    let descriptor = ollama::inspect_model(&endpoint, model).await?;
    if !descriptor.supports(capability) {
        bail!("{model} does not support {}", capability_label(capability));
    }
    Ok(descriptor)
}

fn capability_label(capability: ModelCapability) -> &'static str {
    match capability {
        ModelCapability::TextEmbedding => "text embeddings",
        ModelCapability::TextGeneration => "text generation",
    }
}

fn not_configured() -> ModelProviderConnectionStatus {
    ModelProviderConnectionStatus {
        provider_id: OLLAMA_MODEL_PROVIDER_ID.into(),
        display_name: "Ollama".into(),
        configured: false,
        endpoint: None,
        state: ModelProviderConnectionState::NotConfigured,
        diagnostic: None,
        models: Vec::new(),
    }
}

fn degraded(
    provider_id: &str,
    endpoint: Option<String>,
    diagnostic: String,
) -> ModelProviderConnectionStatus {
    ModelProviderConnectionStatus {
        provider_id: provider_id.into(),
        display_name: if provider_id == OLLAMA_MODEL_PROVIDER_ID {
            "Ollama".into()
        } else {
            provider_id.into()
        },
        configured: false,
        endpoint,
        state: ModelProviderConnectionState::Degraded,
        diagnostic: Some(diagnostic),
        models: Vec::new(),
    }
}

async fn get_connection(repo: &HistoryRepository) -> Result<Option<OllamaConnectionConfig>> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM config_device_values WHERE key=?")
            .bind(OLLAMA_CONNECTION_KEY)
            .fetch_optional(&repo.pool)
            .await?;
    match raw.as_deref() {
        None | Some("null") => Ok(None),
        Some(value) => Ok(Some(serde_json::from_str(value)?)),
    }
}

async fn put_connection(repo: &HistoryRepository, config: &OllamaConnectionConfig) -> Result<()> {
    let now = now_ms();
    sqlx::query("INSERT INTO config_device_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .bind(OLLAMA_CONNECTION_KEY)
        .bind(serde_json::to_string(config)?)
        .bind(now)
        .bind(now)
        .execute(&repo.pool)
        .await?;
    Ok(())
}

async fn record_connection_observation(
    repo: &HistoryRepository,
    status: &ModelProviderConnectionStatus,
) -> Result<()> {
    let now = now_ms();
    let (last_success_at, error_code, error_message) = match status.state {
        ModelProviderConnectionState::Ready => (Some(now), None, None),
        ModelProviderConnectionState::Degraded => (
            None,
            Some("unavailable"),
            status
                .diagnostic
                .as_deref()
                .map(|value| value.chars().take(512).collect::<String>()),
        ),
        ModelProviderConnectionState::NotConfigured => return Ok(()),
    };
    sqlx::query(
        "INSERT INTO provider_runtime_diagnostics(
           provider_id,capability,last_checked_at,last_success_at,last_error_code,last_error_message)
         VALUES(?,'connection',?,?,?,?) ON CONFLICT(provider_id,capability) DO UPDATE SET
         last_checked_at=excluded.last_checked_at,
         last_success_at=COALESCE(excluded.last_success_at,provider_runtime_diagnostics.last_success_at),
         last_error_code=excluded.last_error_code,last_error_message=excluded.last_error_message",
    )
    .bind(&status.provider_id)
    .bind(now)
    .bind(last_success_at)
    .bind(error_code)
    .bind(error_message)
    .execute(&repo.pool)
    .await?;
    Ok(())
}

impl From<ProviderError> for ModelProviderConnectionStatus {
    fn from(error: ProviderError) -> Self {
        degraded(OLLAMA_MODEL_PROVIDER_ID, None, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::AppRoots;

    #[tokio::test]
    async fn fresh_device_starts_without_a_model_connection() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();

        let status = state(&repo).await.unwrap();
        assert_eq!(status.state, ModelProviderConnectionState::NotConfigured);
        assert!(!status.configured);
        assert!(status.models.is_empty());
    }
}
