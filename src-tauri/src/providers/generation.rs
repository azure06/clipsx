use crate::history::{now_ms, HistoryRepository};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::{contracts::generation::GenerationProvider, ollama::OllamaGenerationProvider};

const CONFIG_KEY: &str = "providers.generation.text.active";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProviderConfig {
    pub endpoint: String,
    pub model: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProviderStatus {
    pub enabled: bool,
    pub available: bool,
    pub diagnostic: Option<String>,
    pub endpoint: Option<String>,
    pub model: Option<String>,
}

pub async fn configure(
    repo: &HistoryRepository,
    endpoint: String,
    model: String,
) -> Result<GenerationProviderStatus> {
    let provider = OllamaGenerationProvider::new(&endpoint, model.clone())?;
    let _ = provider.descriptor();
    let config = GenerationProviderConfig {
        endpoint,
        model,
        enabled: true,
    };
    put_config(repo, &config).await?;
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
            endpoint: None,
            model: None,
        });
    };
    let diagnostic = if config.enabled {
        OllamaGenerationProvider::new(&config.endpoint, config.model.clone())
            .err()
            .map(|error| error.to_string())
    } else {
        Some("Text generation is disabled".into())
    };
    Ok(GenerationProviderStatus {
        enabled: config.enabled,
        available: config.enabled && diagnostic.is_none(),
        diagnostic,
        endpoint: Some(config.endpoint),
        model: Some(config.model),
    })
}

pub async fn available(repo: &HistoryRepository) -> Result<bool> {
    Ok(get_config(repo).await?.is_some_and(|config| config.enabled))
}

pub async fn generate(repo: &HistoryRepository, prompt: &str) -> Result<String> {
    let config = get_config(repo)
        .await?
        .context("generation.text provider is not configured")?;
    if !config.enabled {
        bail!("generation.text provider is disabled");
    }
    Ok(
        OllamaGenerationProvider::new(&config.endpoint, config.model)?
            .generate(prompt)
            .await?,
    )
}

async fn get_config(repo: &HistoryRepository) -> Result<Option<GenerationProviderConfig>> {
    let row = sqlx::query("SELECT value_json FROM config_device_values WHERE key=?")
        .bind(CONFIG_KEY)
        .fetch_optional(&repo.pool)
        .await?;
    row.map(|row| serde_json::from_str(&row.get::<String, _>(0)).map_err(Into::into))
        .transpose()
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
