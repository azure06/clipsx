//! Device-local named connections, presets, and validated credential-free imports.
use super::{contracts::*, credentials};
use crate::{
    history::{new_id, now_ms, HistoryRepository},
    providers::{
        self,
        contracts::text_embedding::{TextEmbeddingProvider, TextEmbeddingSpace},
        error::ProviderError,
    },
};
use anyhow::{bail, Context, Result};
use sqlx::{Row, SqliteConnection};
use std::collections::HashSet;

// Serialize imports and recovery so an older activation cannot overtake a newer save.
static EMBEDDING_ACTIVATION_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(serde::Serialize, serde::Deserialize)]
enum EmbeddingActivation {
    Enable {
        config: providers::TextEmbeddingProviderConfig,
        space: Box<TextEmbeddingSpace>,
    },
    Disable,
}

/// Replay only a previously validated, nonsecret activation; no provider probe is needed.
pub async fn reconcile_embedding_activation(repo: &HistoryRepository) -> Result<bool> {
    let _guard = EMBEDDING_ACTIVATION_GATE.lock().await;
    reconcile_embedding_activation_locked(repo).await
}

async fn reconcile_embedding_activation_locked(repo: &HistoryRepository) -> Result<bool> {
    let intent: Option<String> =
        sqlx::query_scalar("SELECT intent_json FROM ai_embedding_activation WHERE singleton=1")
            .fetch_optional(&repo.pool)
            .await?;
    let Some(intent) = intent else {
        return Ok(false);
    };
    match serde_json::from_str::<EmbeddingActivation>(&intent)? {
        EmbeddingActivation::Enable { config, space } => {
            crate::search::semantic::configure_descriptor(repo, config, *space).await?;
        }
        EmbeddingActivation::Disable => crate::search::semantic::disable(repo).await?,
    }
    sqlx::query("DELETE FROM ai_embedding_activation WHERE singleton=1 AND intent_json=?")
        .bind(intent)
        .execute(&repo.pool)
        .await?;
    Ok(true)
}

pub fn unknown_capabilities() -> AiCapabilities {
    AiCapabilities {
        tools: None,
        vision: None,
        web_search: None,
        source: None,
    }
}
pub fn default_options() -> AiPresetOptions {
    AiPresetOptions {
        temperature: None,
        openai: None,
        anthropic: None,
        gemini: None,
        embedding: None,
        limit_policy: None,
    }
}
pub fn validate_connection(connection: &AiConnection) -> Result<url::Url> {
    if uuid::Uuid::parse_str(&connection.id)?.to_string() != connection.id {
        bail!("invalid_connection_id");
    }
    bounded(&connection.name, 128)?;
    if connection.base_url.len() > 2048 {
        bail!("invalid_endpoint");
    }
    let mut url = url::Url::parse(&connection.base_url)?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if url.scheme() != "https"
        && !(url.scheme() == "http" && loopback && connection.provider == AiProviderKind::Ollama)
    {
        bail!("insecure_endpoint");
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("invalid_endpoint");
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    for value in [
        &connection.options.organization,
        &connection.options.project,
    ]
    .into_iter()
    .flatten()
    {
        bounded(value, 128)?;
    }
    if connection.provider != AiProviderKind::Openai
        && (connection.options.organization.is_some() || connection.options.project.is_some())
    {
        bail!("unsupported_provider_option");
    }
    Ok(url)
}
fn bounded(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        bail!("invalid_configuration");
    }
    Ok(())
}
fn validate(document: &AiConfiguration) -> Result<()> {
    if ![1, 2, 3].contains(&document.version)
        || document.connections.len() > 64
        || document.presets.len() > 256
    {
        bail!("invalid_configuration");
    }
    let mut ids = HashSet::new();
    for connection in &document.connections {
        validate_connection(connection)?;
        if !ids.insert(&connection.id) {
            bail!("duplicate_connection");
        }
    }
    ids.clear();
    for preset in &document.presets {
        if uuid::Uuid::parse_str(&preset.id)?.to_string() != preset.id {
            bail!("invalid_preset_id");
        }
        bounded(&preset.name, 128)?;
        bounded(&preset.model_id, 256)?;
        if !ids.insert(&preset.id) {
            bail!("duplicate_preset");
        }
        let connection = document
            .connections
            .iter()
            .find(|c| c.id == preset.connection_id)
            .context("missing_connection")?;
        if connection.provider == AiProviderKind::Tavily
            || !(1024..=2_097_152).contains(&preset.context_limit)
            || preset.output_limit == 0
            || preset.output_limit > 131072
            || preset.output_limit >= preset.context_limit
        {
            bail!("invalid_model_limits");
        }
        let opts = &preset.options;
        if document.version < 3 && matches!(opts.limit_policy, Some(AiLimitPolicy::Auto)) {
            bail!("invalid_configuration_version");
        }
        if preset.purpose != AiModelPurpose::Chat
            && matches!(opts.limit_policy, Some(AiLimitPolicy::Auto))
        {
            bail!("unsupported_limit_policy");
        }
        if preset.purpose == AiModelPurpose::Decision
            && (connection.provider != AiProviderKind::Ollama
                || opts.temperature.is_some()
                || opts.openai.is_some()
                || opts.anthropic.is_some()
                || opts.gemini.is_some())
        {
            bail!("unsupported_decision_provider");
        }
        if opts
            .temperature
            .is_some_and(|v| !v.is_finite() || !(0.0..=2.0).contains(&v))
        {
            bail!("invalid_temperature");
        }
        if opts.openai.is_some()
            && !matches!(
                connection.provider,
                AiProviderKind::Openai | AiProviderKind::Openrouter | AiProviderKind::Ollama
            )
            || opts.anthropic.is_some() && connection.provider != AiProviderKind::Anthropic
            || opts.gemini.is_some() && connection.provider != AiProviderKind::Gemini
        {
            bail!("unsupported_provider_option");
        }
        if opts
            .openai
            .as_ref()
            .and_then(|v| v.reasoning_effort.as_deref())
            .is_some_and(|v| !["none", "minimal", "low", "medium", "high", "xhigh"].contains(&v))
        {
            bail!("invalid_reasoning_effort");
        }
        if opts
            .anthropic
            .as_ref()
            .and_then(|v| v.thinking_budget)
            .is_some_and(|v| v < 1024 || v >= preset.output_limit)
            || opts
                .gemini
                .as_ref()
                .and_then(|v| v.thinking_budget)
                .is_some_and(|v| v > 32768)
        {
            bail!("invalid_thinking_budget");
        }
        if let Some(source) = &preset.capabilities.source {
            bounded(source, 128)?;
        }
        if preset.purpose == AiModelPurpose::Embedding {
            if matches!(
                connection.provider,
                AiProviderKind::Anthropic | AiProviderKind::Tavily
            ) {
                bail!("unsupported_embedding_provider");
            }
            let embedding = opts
                .embedding
                .as_ref()
                .context("missing_embedding_options")?;
            if embedding.dimensions.is_some_and(|v| v == 0 || v > 65536) {
                bail!("invalid_dimensions");
            }
            let valid = match connection.provider {
                AiProviderKind::Gemini => ["gemini_retrieval_v1", "gemini_prefix_v2"]
                    .contains(&embedding.task_policy.as_str()),
                AiProviderKind::Openrouter => {
                    ["symmetric", "retrieval"].contains(&embedding.task_policy.as_str())
                }
                _ => embedding.task_policy == "symmetric",
            };
            if !valid
                || connection.provider == AiProviderKind::Ollama && embedding.dimensions.is_some()
            {
                bail!("invalid_task_policy");
            }
        } else if opts.embedding.is_some() {
            bail!("unsupported_provider_option");
        }
    }
    for (id, purpose) in [
        (&document.selections.default_chat, AiModelPurpose::Chat),
        (
            &document.selections.extension_generation,
            AiModelPurpose::Chat,
        ),
        (
            &document.selections.default_decision,
            AiModelPurpose::Decision,
        ),
        (
            &document.selections.active_embedding,
            AiModelPurpose::Embedding,
        ),
    ] {
        if let Some(id) = id {
            let preset = document
                .presets
                .iter()
                .find(|v| &v.id == id)
                .context("missing_preset")?;
            if preset.purpose != purpose {
                bail!("invalid_selection");
            }
        }
    }
    if let Some(id) = &document.selections.web_search {
        if !document
            .connections
            .iter()
            .any(|v| &v.id == id && v.provider == AiProviderKind::Tavily)
        {
            bail!("invalid_web_selection");
        }
    }
    Ok(())
}
async fn read(pool: &sqlx::SqlitePool) -> Result<AiConfiguration> {
    let mut connection = pool.acquire().await?;
    read_in(&mut connection).await
}
async fn read_in(pool: &mut SqliteConnection) -> Result<AiConfiguration> {
    let connections = sqlx::query_scalar::<_, String>(
        "SELECT configuration_json FROM ai_connections ORDER BY created_at,id",
    )
    .fetch_all(&mut *pool)
    .await?
    .into_iter()
    .map(|v| serde_json::from_str(&v))
    .collect::<std::result::Result<Vec<_>, _>>()?;
    let presets = sqlx::query_scalar::<_, String>(
        "SELECT configuration_json FROM ai_model_presets ORDER BY created_at,id",
    )
    .fetch_all(&mut *pool)
    .await?
    .into_iter()
    .map(|v| serde_json::from_str(&v))
    .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut selections = AiSelections {
        default_chat: None,
        active_embedding: None,
        web_search: None,
        ..AiSelections::default()
    };
    for (key, id) in sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT selection_key,selected_id FROM ai_selections",
    )
    .fetch_all(&mut *pool)
    .await?
    {
        match key.as_str() {
            "default_chat" => selections.default_chat = id,
            "active_embedding" => selections.active_embedding = id,
            "web_search" => selections.web_search = id,
            "extension_generation" => selections.extension_generation = id,
            "default_decision" => selections.default_decision = id,
            _ => (),
        }
    }
    Ok(AiConfiguration {
        version: 3,
        connections,
        presets,
        selections,
    })
}
async fn persist(tx: &mut SqliteConnection, document: &AiConfiguration) -> Result<()> {
    for connection in &document.connections {
        sqlx::query("INSERT INTO ai_connections(id,configuration_json,credential_ref,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_test_at=CASE WHEN configuration_json=excluded.configuration_json THEN last_test_at ELSE NULL END,last_test_code=CASE WHEN configuration_json=excluded.configuration_json THEN last_test_code ELSE NULL END,configuration_json=excluded.configuration_json,updated_at=excluded.updated_at")
        .bind(&connection.id).bind(serde_json::to_string(connection)?).bind(format!("ai:{}",connection.id)).bind(now_ms()).bind(now_ms()).execute(&mut *tx).await?;
    }
    for preset in &document.presets {
        sqlx::query("INSERT INTO ai_model_presets(id,connection_id,configuration_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,configuration_json=excluded.configuration_json,updated_at=excluded.updated_at")
        .bind(&preset.id).bind(&preset.connection_id).bind(serde_json::to_string(preset)?).bind(now_ms()).bind(now_ms()).execute(&mut *tx).await?;
    }
    for (key, id) in [
        ("default_chat", &document.selections.default_chat),
        ("active_embedding", &document.selections.active_embedding),
        ("web_search", &document.selections.web_search),
        (
            "extension_generation",
            &document.selections.extension_generation,
        ),
        ("default_decision", &document.selections.default_decision),
    ] {
        sqlx::query("INSERT INTO ai_selections(selection_key,selected_id) VALUES(?,?) ON CONFLICT(selection_key) DO UPDATE SET selected_id=excluded.selected_id").bind(key).bind(id).execute(&mut *tx).await?;
    }
    if let Some(marker) = sqlx::query_scalar::<_, Option<String>>(
        "SELECT selected_id FROM ai_selections WHERE selection_key='legacy_migrated'",
    )
    .fetch_optional(&mut *tx)
    .await?
    .flatten()
    {
        let marker: serde_json::Value = serde_json::from_str(&marker)?;
        if let Some(connection) = document
            .connections
            .iter()
            .find(|v| Some(v.id.as_str()) == marker["connectionId"].as_str())
        {
            sqlx::query("UPDATE config_device_values SET value_json=?,updated_at=? WHERE key='providers.ollama.connection'").bind(serde_json::json!({"providerId":"builtin.model_provider.ollama","endpoint":connection.base_url}).to_string()).bind(now_ms()).execute(&mut *tx).await?;
        }
    }
    Ok(())
}
pub async fn migrate_legacy(repo: &HistoryRepository) -> Result<()> {
    let mut tx = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM ai_selections WHERE selection_key='legacy_migrated')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if exists {
        migrate_generation_assignment(&mut tx).await?;
        tx.commit().await?;
        return Ok(());
    }
    let legacy = sqlx::query_scalar::<_, String>(
        "SELECT value_json FROM config_device_values WHERE key='providers.ollama.connection'",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let mut marker = None;
    if let Some(legacy) = legacy.filter(|v| v != "null") {
        let value: serde_json::Value = serde_json::from_str(&legacy)?;
        let connection = AiConnection {
            id: new_id(),
            name: "Ollama".into(),
            provider: AiProviderKind::Ollama,
            base_url: value["endpoint"]
                .as_str()
                .context("invalid_legacy_connection")?
                .into(),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        let mut document = AiConfiguration {
            version: 1,
            connections: vec![connection.clone()],
            presets: vec![],
            selections: AiSelections {
                default_chat: None,
                active_embedding: None,
                web_search: None,
                ..AiSelections::default()
            },
        };
        for (key, purpose) in [
            ("providers.generation.text.active", AiModelPurpose::Chat),
            ("providers.text_embedding.active", AiModelPurpose::Embedding),
        ] {
            if let Some(raw) = sqlx::query_scalar::<_, String>(
                "SELECT value_json FROM config_device_values WHERE key=?",
            )
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?
            {
                let value: serde_json::Value = serde_json::from_str(&raw)?;
                if let Some(model) = value["model"].as_str() {
                    let mut options = default_options();
                    if purpose == AiModelPurpose::Embedding {
                        options.embedding = Some(EmbeddingPresetOptions {
                            dimensions: None,
                            task_policy: "symmetric".into(),
                            hosted_indexing_enabled: false,
                        });
                    }
                    let preset = AiModelPreset {
                        id: new_id(),
                        name: model.into(),
                        connection_id: connection.id.clone(),
                        model_id: model.into(),
                        purpose,
                        context_limit: 32768,
                        output_limit: 4096,
                        options,
                        capabilities: unknown_capabilities(),
                    };
                    if purpose == AiModelPurpose::Chat {
                        document.selections.default_chat = Some(preset.id.clone());
                        if value["enabled"] == true {
                            document.selections.extension_generation = Some(preset.id.clone());
                        }
                    } else {
                        document.selections.active_embedding = Some(preset.id.clone());
                    }
                    document.presets.push(preset);
                }
            }
        }
        validate(&document)?;
        persist(&mut tx, &document).await?;
        marker=Some(serde_json::json!({"connectionId":connection.id,"generationPresetId":document.selections.default_chat}).to_string());
    }
    sqlx::query("INSERT INTO ai_selections(selection_key,selected_id) VALUES('legacy_migrated',?)")
        .bind(marker)
        .execute(&mut *tx)
        .await?;
    migrate_generation_assignment(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}
// Backfill an already-migrated installation once, preserving disabled legacy generation.
async fn migrate_generation_assignment(tx: &mut SqliteConnection) -> Result<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM ai_selections WHERE selection_key='extension_generation')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if exists {
        return Ok(());
    }
    let marker: Option<String> = sqlx::query_scalar(
        "SELECT selected_id FROM ai_selections WHERE selection_key='legacy_migrated'",
    )
    .fetch_optional(&mut *tx)
    .await?
    .flatten();
    let raw: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_device_values WHERE key='providers.generation.text.active'",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let enabled = raw
        .as_deref()
        .and_then(|v| serde_json::from_str::<serde_json::Value>(v).ok())
        .is_some_and(|v| v["enabled"] == true);
    let id = marker
        .and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok())
        .and_then(|v| v["generationPresetId"].as_str().map(str::to_owned))
        .filter(|_| enabled);
    sqlx::query(
        "INSERT INTO ai_selections(selection_key,selected_id) VALUES('extension_generation',?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}
pub async fn export(repo: &HistoryRepository) -> Result<AiConfiguration> {
    migrate_legacy(repo).await?;
    read(&repo.pool).await
}
pub async fn state(repo: &HistoryRepository) -> Result<AiConfigurationState> {
    let configuration = export(repo).await?;
    let mut connection_states = vec![];
    for connection in &configuration.connections {
        let row = sqlx::query("SELECT last_test_at,last_test_code FROM ai_connections WHERE id=?")
            .bind(&connection.id)
            .fetch_one(&repo.pool)
            .await?;
        let credential = credentials::get(repo, &connection.id).await;
        let credential_error = credential.is_err();
        connection_states.push(AiConnectionState {
            connection_id: connection.id.clone(),
            credential_configured: credential.ok().flatten().is_some(),
            last_test_at: row.get::<Option<i64>, _>(0).map(|v| v as f64),
            diagnostic: if credential_error {
                Some("credential_storage_unavailable".into())
            } else {
                row.get(1)
            },
        });
    }
    Ok(AiConfigurationState {
        configuration,
        connection_states,
    })
}
pub async fn import(
    repo: &HistoryRepository,
    incoming: AiConfiguration,
) -> Result<AiConfigurationState> {
    let _guard = EMBEDDING_ACTIVATION_GATE.lock().await;
    let current = export(repo).await?;
    let merged = merge(&current, incoming)?;
    import_merged(repo, current, merged).await
}

pub fn merge(current: &AiConfiguration, incoming: AiConfiguration) -> Result<AiConfiguration> {
    if serde_json::to_vec(&incoming)?.len() > 1024 * 1024 {
        bail!("configuration_too_large");
    }
    if incoming.connections.len() > 64
        || incoming.presets.len() > 256
        || incoming
            .connections
            .iter()
            .map(|v| &v.id)
            .collect::<HashSet<_>>()
            .len()
            != incoming.connections.len()
        || incoming
            .presets
            .iter()
            .map(|v| &v.id)
            .collect::<HashSet<_>>()
            .len()
            != incoming.presets.len()
    {
        bail!("invalid_configuration");
    }
    let mut merged = current.clone();
    for item in incoming.connections {
        if let Some(old) = merged.connections.iter_mut().find(|v| v.id == item.id) {
            if old.provider != item.provider {
                bail!("connection_provider_conflict");
            }
            *old = item;
        } else {
            merged.connections.push(item);
        }
    }
    if incoming.version < 3
        && incoming
            .presets
            .iter()
            .any(|p| matches!(p.options.limit_policy, Some(AiLimitPolicy::Auto)))
    {
        bail!("invalid_configuration_version");
    }
    for item in incoming.presets {
        if let Some(old) = merged.presets.iter_mut().find(|v| v.id == item.id) {
            *old = item;
        } else {
            merged.presets.push(item);
        }
    }
    if ![1, 2, 3].contains(&incoming.version) {
        bail!("unsupported_configuration_version");
    }
    merged.selections = incoming.selections;
    if incoming.version == 1 {
        merged.selections.extension_generation = current.selections.extension_generation.clone();
        merged.selections.default_decision = current.selections.default_decision.clone();
    }
    validate(&merged)?;
    Ok(merged)
}

async fn import_merged(
    repo: &HistoryRepository,
    current: AiConfiguration,
    merged: AiConfiguration,
) -> Result<AiConfigurationState> {
    let changed = serde_json::to_string(&current.selections.active_embedding)?
        != serde_json::to_string(&merged.selections.active_embedding)?
        || current
            .presets
            .iter()
            .filter(|p| Some(&p.id) == current.selections.active_embedding.as_ref())
            .map(|v| serde_json::to_string(v).expect("serializable configuration"))
            .collect::<Vec<_>>()
            != merged
                .presets
                .iter()
                .filter(|p| Some(&p.id) == merged.selections.active_embedding.as_ref())
                .map(|v| serde_json::to_string(v).expect("serializable configuration"))
                .collect::<Vec<_>>();
    let active_connection = |doc: &AiConfiguration| {
        doc.selections
            .active_embedding
            .as_ref()
            .and_then(|id| doc.presets.iter().find(|v| &v.id == id))
            .and_then(|preset| {
                doc.connections
                    .iter()
                    .find(|v| v.id == preset.connection_id)
            })
            .map(|v| serde_json::to_string(v).expect("serializable configuration"))
    };
    let changed = changed || active_connection(&current) != active_connection(&merged);
    let validated = if changed {
        match &merged.selections.active_embedding {
            Some(id) => Some(verify_embedding(repo, &merged, id).await?),
            None => None,
        }
    } else {
        None
    };
    let mut tx = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    if serde_json::to_string(&read_in(&mut tx).await?)? != serde_json::to_string(&current)? {
        bail!("configuration_changed");
    }
    persist(&mut tx, &merged).await?;
    if changed {
        let intent = match validated {
            Some((config, space)) => EmbeddingActivation::Enable {
                config,
                space: Box::new(space),
            },
            None => EmbeddingActivation::Disable,
        };
        sqlx::query("INSERT INTO ai_embedding_activation(singleton,intent_json,updated_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET intent_json=excluded.intent_json,updated_at=excluded.updated_at")
            .bind(serde_json::to_string(&intent)?)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    reconcile_embedding_activation_locked(repo).await?;
    state(repo).await
}
pub async fn connection(repo: &HistoryRepository, id: &str) -> Result<AiConnection> {
    uuid::Uuid::parse_str(id)?;
    let value =
        sqlx::query_scalar::<_, String>("SELECT configuration_json FROM ai_connections WHERE id=?")
            .bind(id)
            .fetch_one(&repo.pool)
            .await?;
    Ok(serde_json::from_str(&value)?)
}
pub async fn set_credential(
    repo: &HistoryRepository,
    id: &str,
    value: Option<String>,
) -> Result<()> {
    connection(repo, id).await?;
    credentials::set(repo, id, value).await?;
    sqlx::query("UPDATE ai_connections SET last_test_at=NULL,last_test_code=NULL WHERE id=?")
        .bind(id)
        .execute(&repo.pool)
        .await?;
    Ok(())
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
        bail!("hosted_indexing_disabled");
    }
    let credential = credentials::get(repo, &connection.id)
        .await?
        .context("credential_required")?;
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
        let document = export(repo).await?;
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

// None means unknown, while an empty list means the catalog reports no supported ClipsX use.
fn catalog_purposes(
    provider: AiProviderKind,
    row: &serde_json::Value,
    id: &str,
) -> Option<Vec<AiModelPurpose>> {
    let contains = |values: &serde_json::Value, name: &str| {
        values
            .as_array()
            .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(name)))
    };
    match provider {
        AiProviderKind::Anthropic => Some(vec![AiModelPurpose::Chat]),
        AiProviderKind::Gemini => {
            let methods = &row["supportedGenerationMethods"];
            methods.as_array()?;
            let mut purposes = Vec::new();
            if contains(methods, "generateContent") {
                purposes.push(AiModelPurpose::Chat);
            }
            if contains(methods, "embedContent") || contains(methods, "batchEmbedContents") {
                purposes.push(AiModelPurpose::Embedding);
            }
            Some(purposes)
        }
        AiProviderKind::Openrouter => {
            let modalities = &row["architecture"]["output_modalities"];
            modalities.as_array()?;
            let mut purposes = Vec::new();
            if contains(modalities, "text") {
                purposes.push(AiModelPurpose::Chat);
            }
            if contains(modalities, "embeddings") {
                purposes.push(AiModelPurpose::Embedding);
            }
            Some(purposes)
        }
        AiProviderKind::Openai => {
            if [
                "text-embedding-3-small",
                "text-embedding-3-large",
                "text-embedding-ada-002",
            ]
            .contains(&id)
            {
                Some(vec![AiModelPurpose::Embedding])
            } else if ["audio", "realtime", "transcribe", "tts", "image"]
                .iter()
                .any(|part| id.contains(part))
            {
                Some(Vec::new())
            } else if ["gpt-4", "gpt-5", "gpt-6", "o1", "o3", "o4"]
                .iter()
                .any(|prefix| id.starts_with(prefix))
            {
                Some(vec![AiModelPurpose::Chat])
            } else {
                None
            }
        }
        _ => None,
    }
}

pub async fn discover(repo: &HistoryRepository, id: &str) -> Result<Vec<AiDiscoveredModel>> {
    let connection = connection(repo, id).await?;
    if !connection.enabled {
        bail!("connection_disabled");
    }
    let credential = if connection.provider == AiProviderKind::Ollama {
        None
    } else {
        credentials::get(repo, id).await?
    };
    let result = discover_connection(&connection, credential.as_deref()).await;
    if let Ok(models) = &result {
        for model in models {
            if let Some(info) = &model.model_information {
                super::model_information::save(repo, info).await?;
            }
        }
    }
    let code = if result.is_ok() {
        "ready"
    } else if result
        .as_ref()
        .err()
        .is_some_and(|e| e.to_string() == "credential_required")
    {
        "credential_required"
    } else {
        "connection_test_failed"
    };
    sqlx::query("UPDATE ai_connections SET last_test_at=?,last_test_code=? WHERE id=?")
        .bind(now_ms())
        .bind(code)
        .bind(id)
        .execute(&repo.pool)
        .await?;
    result
}

// Draft checks deliberately do not write configuration, credentials or test observations.
pub async fn test_connection(
    repo: &HistoryRepository,
    draft: &AiConnection,
    credential: Option<String>,
) -> Result<usize> {
    validate_connection(draft)?;
    if let Some(value) = &credential {
        bounded(value, 8192)?;
    }
    let credential = if credential.is_some() || draft.provider == AiProviderKind::Ollama {
        credential
    } else {
        let saved = export(repo)
            .await?
            .connections
            .into_iter()
            .find(|saved| saved.id == draft.id)
            .context("credential_required")?;
        // A saved key must never follow a draft to a different destination.
        if saved.provider != draft.provider
            || validate_connection(&saved)? != validate_connection(draft)?
        {
            bail!("credential_required");
        }
        credentials::get(repo, &draft.id).await?
    };
    Ok(discover_connection(draft, credential.as_deref())
        .await?
        .len())
}

async fn discover_connection(
    connection: &AiConnection,
    credential: Option<&str>,
) -> Result<Vec<AiDiscoveredModel>> {
    let base = validate_connection(connection)?;
    if connection.provider == AiProviderKind::Ollama {
        return Ok(providers::ollama::discover_models(base.as_str())
            .await?
            .into_iter()
            .take(500)
            .map(|v| AiDiscoveredModel {
                id: v.id,
                purposes: (!v.capabilities.is_empty()).then(|| {
                    v.capabilities
                        .iter()
                        .map(|capability| match capability {
                            providers::model_catalog::ModelCapability::TextEmbedding => {
                                AiModelPurpose::Embedding
                            }
                            providers::model_catalog::ModelCapability::TextGeneration => {
                                AiModelPurpose::Chat
                            }
                            providers::model_catalog::ModelCapability::Decision => {
                                AiModelPurpose::Decision
                            }
                        })
                        .collect()
                }),
                capabilities: unknown_capabilities(),
                model_information: None,
            })
            .collect());
    }
    if connection.provider == AiProviderKind::Tavily {
        bail!("model_discovery_unavailable");
    }
    let credential = credential.context("credential_required")?;
    if connection.provider == AiProviderKind::Openrouter {
        // Catalog visibility alone does not prove that the supplied key is valid.
        providers::hosted_embedding::request_json(connection, &base.join("key")?, credential, None)
            .await?;
    }
    let value = providers::hosted_embedding::request_json(
        connection,
        &base.join("models")?,
        credential,
        None,
    )
    .await?;
    let mut rows = value[if connection.provider == AiProviderKind::Gemini {
        "models"
    } else {
        "data"
    }]
    .as_array()
    .context("invalid_model_catalog")?
    .clone();
    rows.truncate(500);
    if connection.provider == AiProviderKind::Openrouter {
        let embeddings = providers::hosted_embedding::request_json(
            connection,
            &base.join("embeddings/models")?,
            credential,
            None,
        )
        .await?;
        for row in embeddings["data"]
            .as_array()
            .context("invalid_model_catalog")?
            .iter()
            .take(500)
        {
            let mut row = row.clone();
            row["architecture"]["output_modalities"] = serde_json::json!(["embeddings"]);
            rows.push(row);
        }
    }
    Ok(rows
        .iter()
        .take(1000)
        .filter_map(|row| {
            let id = row[if connection.provider == AiProviderKind::Gemini {
                "name"
            } else {
                "id"
            }]
            .as_str()?
            .strip_prefix("models/")
            .unwrap_or(
                row[if connection.provider == AiProviderKind::Gemini {
                    "name"
                } else {
                    "id"
                }]
                .as_str()?,
            )
            .to_string();
            if id.is_empty() || id.len() > 256 {
                return None;
            }
            if row["lifecycle"].as_str() == Some("retired") {
                return None;
            }
            let purposes = catalog_purposes(connection.provider, row, &id);
            let mut capabilities = unknown_capabilities();
            if purposes.is_some() {
                capabilities.source = Some(
                    if connection.provider == AiProviderKind::Openai {
                        "clipsx_model_family"
                    } else {
                        "provider_catalog"
                    }
                    .into(),
                );
            }
            if let Some(parameters) = row["supported_parameters"].as_array() {
                capabilities.tools = Some(parameters.iter().any(|v| v.as_str() == Some("tools")));
                capabilities.source = Some("provider_catalog".into());
            }
            Some(AiDiscoveredModel {
                id: id.clone(),
                purposes,
                capabilities,
                model_information: Some(super::model_information::parse(
                    connection,
                    &id,
                    row,
                    now_ms(),
                )),
            })
        })
        .collect::<Vec<_>>())
}

#[cfg(test)]
mod discovery_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn catalog_purposes_distinguish_reported_inferred_and_unknown_models() {
        assert_eq!(
            catalog_purposes(
                AiProviderKind::Gemini,
                &json!({"supportedGenerationMethods":["embedContent"]}),
                "embed"
            ),
            Some(vec![AiModelPurpose::Embedding])
        );
        assert_eq!(
            catalog_purposes(
                AiProviderKind::Gemini,
                &json!({"supportedGenerationMethods":["generateContent"]}),
                "chat"
            ),
            Some(vec![AiModelPurpose::Chat])
        );
        assert_eq!(
            catalog_purposes(
                AiProviderKind::Openrouter,
                &json!({"architecture":{"output_modalities":["embeddings"]}}),
                "embed"
            ),
            Some(vec![AiModelPurpose::Embedding])
        );
        assert_eq!(
            catalog_purposes(AiProviderKind::Anthropic, &json!({}), "claude"),
            Some(vec![AiModelPurpose::Chat])
        );
        assert_eq!(
            catalog_purposes(AiProviderKind::Openai, &json!({}), "text-embedding-3-small"),
            Some(vec![AiModelPurpose::Embedding])
        );
        assert_eq!(
            catalog_purposes(AiProviderKind::Openai, &json!({}), "gpt-4o"),
            Some(vec![AiModelPurpose::Chat])
        );
        assert_eq!(
            catalog_purposes(AiProviderKind::Openai, &json!({}), "gpt-4o-mini-tts"),
            Some(vec![])
        );
        assert_eq!(
            catalog_purposes(AiProviderKind::Openai, &json!({}), "custom-unknown"),
            None
        );
    }
}
