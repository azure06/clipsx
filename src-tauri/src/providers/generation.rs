use crate::history::{now_ms, HistoryRepository};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::{
    contracts::generation::{
        GenerationCancellation, GenerationMessage, GenerationProvider, GenerationRequest,
        GenerationResponse, GenerationRole,
    },
    model_catalog::{self, ModelCapability},
    ollama::OllamaGenerationProvider,
};

const CONFIG_KEY: &str = "providers.generation.text.active";
const PROVIDER_ID: &str = "builtin.generation.ollama";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProviderConfig {
    pub provider_id: String,
    pub model: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProviderStatus {
    pub enabled: bool,
    pub available: bool,
    pub diagnostic: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
}

pub async fn configure(
    repo: &HistoryRepository,
    model: String,
) -> Result<GenerationProviderStatus> {
    model_catalog::require_model(repo, &model, ModelCapability::TextGeneration).await?;
    let config = GenerationProviderConfig {
        provider_id: PROVIDER_ID.into(),
        model,
        enabled: true,
    };
    put_config(repo, &config).await?;
    record_success(repo).await?;
    status(repo).await
}

pub async fn disable(repo: &HistoryRepository) -> Result<()> {
    let Some(mut config) = get_config(repo).await? else {
        return Ok(());
    };
    config.enabled = false;
    put_config(repo, &config).await
}

pub async fn status(repo: &HistoryRepository) -> Result<GenerationProviderStatus> {
    let Some(config) = get_config(repo).await? else {
        return Ok(GenerationProviderStatus {
            enabled: false,
            available: false,
            diagnostic: Some("Text generation is not configured".into()),
            provider_id: None,
            model: None,
        });
    };
    let capability_diagnostic = if config.enabled {
        model_catalog::require_model(repo, &config.model, ModelCapability::TextGeneration)
            .await
            .err()
            .map(|error| error.to_string())
    } else {
        None
    };
    let diagnostic = if !config.enabled {
        Some("Text generation is disabled".into())
    } else {
        capability_diagnostic.or(provider_diagnostic(repo).await?)
    };
    Ok(GenerationProviderStatus {
        enabled: config.enabled,
        available: config.enabled && diagnostic.is_none(),
        diagnostic,
        provider_id: Some(config.provider_id),
        model: Some(config.model),
    })
}

pub async fn available(repo: &HistoryRepository) -> Result<bool> {
    let Some(config) = get_config(repo).await? else {
        return Ok(false);
    };
    if !config.enabled {
        return Ok(false);
    }
    Ok(
        model_catalog::require_model(repo, &config.model, ModelCapability::TextGeneration)
            .await
            .is_ok(),
    )
}

pub async fn generate(repo: &HistoryRepository, prompt: &str) -> Result<String> {
    let cancellation = GenerationCancellation::default();
    let output = generate_stream(
        repo,
        vec![GenerationMessage {
            role: GenerationRole::User,
            content: prompt.to_owned(),
        }],
        4_096,
        &cancellation,
        &|_| Ok(()),
    )
    .await?;
    Ok(output.text)
}

pub async fn resolve(
    repo: &HistoryRepository,
) -> Result<(GenerationProviderConfig, Box<dyn GenerationProvider>)> {
    let config = get_config(repo)
        .await?
        .context("generation.text provider is not configured")?;
    if !config.enabled {
        bail!("generation.text provider is disabled");
    }
    let provider: Box<dyn GenerationProvider> = match config.provider_id.as_str() {
        PROVIDER_ID => Box::new(OllamaGenerationProvider::new(
            &model_catalog::endpoint(repo).await?,
            config.model.clone(),
        )?),
        value => bail!("unknown text-generation provider {value}"),
    };
    Ok((config, provider))
}

pub async fn generate_stream(
    repo: &HistoryRepository,
    messages: Vec<GenerationMessage>,
    max_output_tokens: u32,
    cancellation: &GenerationCancellation,
    on_delta: &(dyn Fn(String) -> super::error::ProviderResult<()> + Send + Sync),
) -> Result<GenerationResponse> {
    let (config, provider) = resolve(repo).await?;
    let result = provider
        .generate_stream(
            &GenerationRequest {
                messages,
                max_output_tokens,
            },
            cancellation,
            on_delta,
        )
        .await;
    match result {
        Ok(output) => {
            record_success_for(repo, &config.provider_id).await?;
            Ok(output)
        }
        Err(error) => {
            if !matches!(error, super::error::ProviderError::Cancelled) {
                record_failure_for(repo, &config.provider_id, &error).await?;
            }
            Err(error.into())
        }
    }
}

async fn get_config(repo: &HistoryRepository) -> Result<Option<GenerationProviderConfig>> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM config_device_values WHERE key=?")
            .bind(CONFIG_KEY)
            .fetch_optional(&repo.pool)
            .await?;
    match raw.as_deref() {
        None | Some("null") => Ok(None),
        Some(value) => Ok(Some(serde_json::from_str(value)?)),
    }
}

async fn put_config(repo: &HistoryRepository, config: &GenerationProviderConfig) -> Result<()> {
    let now = now_ms();
    sqlx::query("INSERT INTO config_device_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .bind(CONFIG_KEY)
        .bind(serde_json::to_string(config)?)
        .bind(now)
        .bind(now)
        .execute(&repo.pool)
        .await?;
    Ok(())
}

async fn record_success(repo: &HistoryRepository) -> Result<()> {
    record_success_for(repo, PROVIDER_ID).await
}

pub(crate) async fn record_success_for(repo: &HistoryRepository, provider_id: &str) -> Result<()> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO provider_runtime_diagnostics(provider_id,capability,last_checked_at,last_success_at)
         VALUES(?,'text_generation',?,?) ON CONFLICT(provider_id,capability) DO UPDATE SET
         last_checked_at=excluded.last_checked_at,last_success_at=excluded.last_success_at,
         last_error_code=NULL,last_error_message=NULL",
    )
    .bind(provider_id)
    .bind(now)
    .bind(now)
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn record_failure(
    repo: &HistoryRepository,
    error: &super::error::ProviderError,
) -> Result<()> {
    record_failure_for(repo, PROVIDER_ID, error).await
}

pub(crate) async fn record_failure_for(
    repo: &HistoryRepository,
    provider_id: &str,
    error: &super::error::ProviderError,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO provider_runtime_diagnostics(provider_id,capability,last_checked_at,last_error_code,last_error_message)
         VALUES(?,'text_generation',?,?,?) ON CONFLICT(provider_id,capability) DO UPDATE SET
         last_checked_at=excluded.last_checked_at,last_error_code=excluded.last_error_code,
         last_error_message=excluded.last_error_message",
    )
    .bind(provider_id)
    .bind(now_ms())
    .bind(error.code())
    .bind(error.to_string().chars().take(512).collect::<String>())
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn provider_diagnostic(repo: &HistoryRepository) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT last_error_message FROM provider_runtime_diagnostics
         WHERE provider_id=? AND capability='text_generation'",
    )
    .bind(PROVIDER_ID)
    .fetch_optional(&repo.pool)
    .await?
    .flatten())
}
