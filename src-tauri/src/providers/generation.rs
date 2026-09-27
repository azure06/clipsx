use super::error::ProviderError;
use crate::history::{now_ms, HistoryRepository};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tokio::sync::Semaphore;

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

fn generation_admission() -> &'static Semaphore {
    static ADMISSION: OnceLock<Semaphore> = OnceLock::new();
    ADMISSION.get_or_init(|| Semaphore::new(1))
}

pub async fn acquire_generation_admission(
    cancellation: &GenerationCancellation,
) -> Result<tokio::sync::SemaphorePermit<'static>> {
    tokio::select! {
        permit = generation_admission().acquire() => Ok(permit.context("generation admission closed")?),
        _ = cancellation.cancelled() => Err(super::error::ProviderError::Cancelled.into()),
    }
}

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
            .map(|_| {
                crate::failure::FailureCode::ModelUnavailable
                    .message()
                    .to_owned()
            })
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
        .ok_or(ProviderError::NotConfigured)?;
    if !config.enabled {
        return Err(ProviderError::Disabled.into());
    }
    let provider: Box<dyn GenerationProvider> = match config.provider_id.as_str() {
        PROVIDER_ID => Box::new(OllamaGenerationProvider::new(
            &model_catalog::endpoint(repo).await?,
            config.model.clone(),
        )?),
        _ => {
            return Err(
                ProviderError::InvalidConfiguration("unknown generation provider".into()).into(),
            )
        }
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
    let _permit = acquire_generation_admission(cancellation).await?;
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
            let _ = record_success_for(repo, &config.provider_id).await;
            Ok(output)
        }
        Err(error) => {
            if !matches!(error, super::error::ProviderError::Cancelled) {
                // Diagnostics must not replace the original provider failure.
                let _ = record_failure_for(repo, &config.provider_id, &error).await;
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
    .bind(error.failure().code.as_str())
    .bind(error.failure().code.message())
    .execute(&repo.pool)
    .await?;
    Ok(())
}

async fn provider_diagnostic(repo: &HistoryRepository) -> Result<Option<String>> {
    let code: Option<String> = sqlx::query_scalar("SELECT last_error_code FROM provider_runtime_diagnostics WHERE provider_id=? AND capability='text_generation'")
        .bind(PROVIDER_ID).fetch_optional(&repo.pool).await?.flatten();
    let Some(code) = code else {
        return Ok(None);
    };
    let message = diagnostic_message(&code);
    // Replace historical raw details when diagnostics are read; unrelated capabilities are untouched.
    sqlx::query("UPDATE provider_runtime_diagnostics SET last_error_message=? WHERE provider_id=? AND capability='text_generation' AND last_error_code=?")
        .bind(message).bind(PROVIDER_ID).bind(code).execute(&repo.pool).await?;
    Ok(Some(message.to_owned()))
}

fn diagnostic_message(code: &str) -> &'static str {
    use crate::failure::FailureCode;
    let code = match code {
        "disabled" => FailureCode::ProviderDisabled,
        "invalid_configuration" => FailureCode::ProviderConfiguration,
        "unavailable" => FailureCode::ConnectionUnavailable,
        "request_rejected" => FailureCode::ProviderRejected,
        "invalid_descriptor" | "invalid_output" => FailureCode::InvalidResponse,
        _ => serde_json::from_value(serde_json::Value::String(code.to_owned()))
            .unwrap_or(FailureCode::UnknownFailure),
    };
    code.message()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::{FailureCode, OperationFailure, Recovery};

    #[tokio::test]
    async fn diagnostics_are_safe_and_legacy_cleanup_is_generation_only() {
        let temp = tempfile::tempdir().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let error = ProviderError::Rejected {
            operation: "api/generate".into(),
            status: 400,
            detail: Some("private clipboard credential".into()),
            context_overflow: true,
        };
        record_failure_for(&repo, PROVIDER_ID, &error)
            .await
            .unwrap();
        let message: String = sqlx::query_scalar("SELECT last_error_message FROM provider_runtime_diagnostics WHERE provider_id=? AND capability='text_generation'").bind(PROVIDER_ID).fetch_one(&repo.pool).await.unwrap();
        assert!(!message.contains("private"));
        sqlx::query("UPDATE provider_runtime_diagnostics SET last_error_message='old private credential',last_error_code='unavailable' WHERE provider_id=?").bind(PROVIDER_ID).execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO provider_runtime_diagnostics(provider_id,capability,last_error_message) VALUES(?,'text_embedding','unrelated')").bind(PROVIDER_ID).execute(&repo.pool).await.unwrap();
        assert_eq!(
            provider_diagnostic(&repo).await.unwrap().unwrap(),
            FailureCode::ConnectionUnavailable.message()
        );
        let other: String = sqlx::query_scalar("SELECT last_error_message FROM provider_runtime_diagnostics WHERE provider_id=? AND capability='text_embedding'").bind(PROVIDER_ID).fetch_one(&repo.pool).await.unwrap();
        assert_eq!(other, "unrelated");
        let error = resolve(&repo).await.err().unwrap();
        let failure = OperationFailure::from_error(&error);
        assert_eq!(failure.code, FailureCode::ProviderNotConfigured);
        assert_eq!(failure.recovery, Recovery::Wait);
    }
}
