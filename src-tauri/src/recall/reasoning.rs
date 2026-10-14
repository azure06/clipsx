//! Model options are resolved in the host; clients cannot invent supported controls.
use super::{configuration, contracts::*, credentials};
use crate::{history::HistoryRepository, providers};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Cache = HashMap<String, (Instant, AssistantModelOptions)>;
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn options(repo: &HistoryRepository, preset_id: &str) -> Result<AssistantModelOptions> {
    let config = configuration::export(repo).await?;
    let preset = config
        .presets
        .iter()
        .find(|p| p.id == preset_id && p.purpose == AiModelPurpose::Chat)
        .context("missing_chat_preset")?;
    let connection = config
        .connections
        .iter()
        .find(|c| c.id == preset.connection_id && c.enabled)
        .context("connection_disabled")?;
    let information = if matches!(preset.options.limit_policy, Some(AiLimitPolicy::Auto)) {
        super::model_information::resolve(repo, connection, preset, false)
            .await
            .ok()
            .flatten()
    } else {
        super::model_information::cached(
            repo,
            connection,
            &preset.model_id,
            crate::history::now_ms(),
        )
        .await?
    };
    let policy = super::execution_policy::resolve(preset, information.as_ref(), None)?;
    let mut effective = preset.clone();
    effective.output_limit = policy.output_limit;
    for_preset(repo, connection, &effective).await
}

pub async fn validate(
    repo: &HistoryRepository,
    connection: &AiConnection,
    preset: &AiModelPreset,
    selection: &ReasoningSelection,
) -> Result<()> {
    if !for_preset(repo, connection, preset)
        .await?
        .reasoning
        .contains(selection)
    {
        bail!("unsupported_reasoning_option");
    }
    Ok(())
}

async fn for_preset(
    repo: &HistoryRepository,
    connection: &AiConnection,
    preset: &AiModelPreset,
) -> Result<AssistantModelOptions> {
    let base = configuration::validate_connection(connection)?;
    let key = serde_json::to_string(&(connection, preset))?;
    if let Some((at, value)) = CACHE.lock().await.get(&key) {
        if at.elapsed() < Duration::from_secs(300) {
            return Ok(value.clone());
        }
    }
    let value = match connection.provider {
        AiProviderKind::Ollama => {
            let client = providers::ollama::client::OllamaClient::new(base.as_str())?;
            let value = client
                .post_bounded(
                    "api/show",
                    serde_json::json!({"model":preset.model_id,"verbose":false}),
                    Duration::from_secs(8),
                    1024 * 1024,
                )
                .await?;
            ollama_options(&value)
        }
        AiProviderKind::Openrouter => {
            let credential = credentials::get(repo, &connection.id)
                .await?
                .context("credential_required")?;
            let value =
                crate::ai::http::request_json(connection, &base.join("models")?, &credential, None)
                    .await?;
            let row = value["data"]
                .as_array()
                .context("invalid_model_catalog")?
                .iter()
                .take(1000)
                .find(|row| row["id"].as_str() == Some(&preset.model_id))
                .context("model_not_in_catalog")?;
            openrouter_options(row, preset.output_limit)
        }
        _ => documented_options(connection.provider, &preset.model_id, preset.output_limit),
    };
    let mut cache = CACHE.lock().await;
    cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(300));
    if cache.len() >= 64 {
        cache.clear();
    }
    cache.insert(key, (Instant::now(), value.clone()));
    Ok(value)
}

fn empty() -> AssistantModelOptions {
    AssistantModelOptions {
        reasoning: vec![],
        reasoning_source: None,
    }
}
fn effort(value: &str) -> ReasoningSelection {
    ReasoningSelection::Effort {
        value: value.into(),
    }
}
fn efforts(values: &[&str]) -> AssistantModelOptions {
    AssistantModelOptions {
        reasoning: values.iter().map(|value| effort(value)).collect(),
        reasoning_source: Some("documented_model_family".into()),
    }
}
fn budgets(limit: u32) -> Vec<ReasoningSelection> {
    // Leave room for the answer; never silently increase the preset's output limit.
    [1024, 2048, 4096, 8192, 16384]
        .into_iter()
        .filter(|tokens| *tokens < limit)
        .map(|tokens| ReasoningSelection::Budget { tokens })
        .collect()
}

fn ollama_options(value: &Value) -> AssistantModelOptions {
    let Some(values) = value["thinking"]["values"].as_array() else {
        return empty();
    };
    if values.as_slice() == [Value::Bool(false)] {
        return empty();
    }
    let mut reasoning = vec![];
    for value in values.iter().take(16) {
        let option = match value {
            Value::Bool(enabled) => Some(ReasoningSelection::Thinking { enabled: *enabled }),
            Value::String(value)
                if !value.is_empty()
                    && value.len() <= 64
                    && value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b)) =>
            {
                Some(effort(value))
            }
            _ => None,
        };
        if let Some(option) = option {
            if !reasoning.contains(&option) {
                reasoning.push(option);
            }
        }
    }
    AssistantModelOptions {
        reasoning,
        reasoning_source: Some("ollama_model_metadata".into()),
    }
}

fn openrouter_options(row: &Value, output_limit: u32) -> AssistantModelOptions {
    let metadata = &row["reasoning"];
    let mandatory = metadata["mandatory"].as_bool() == Some(true);
    // Filter against the installed OpenRouter adapter's accepted effort vocabulary.
    let accepted = ["none", "minimal", "low", "medium", "high", "xhigh"];
    let mut reasoning = vec![];
    if let Some(values) = metadata.get("supported_efforts") {
        for value in accepted {
            if value == "none" && mandatory {
                continue;
            }
            if values.is_null()
                || values
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(value)))
            {
                reasoning.push(effort(value));
            }
        }
    }
    if metadata["supports_max_tokens"].as_bool() == Some(true) {
        reasoning.extend(budgets(output_limit));
    }
    AssistantModelOptions {
        reasoning,
        reasoning_source: metadata.is_object().then(|| "provider_catalog".into()),
    }
}

fn documented_options(
    provider: AiProviderKind,
    model: &str,
    output_limit: u32,
) -> AssistantModelOptions {
    // Conservative documented families. Unknown IDs keep only their preset defaults.
    // Sources: ai-sdk.dev/providers/ai-sdk-providers/{openai,anthropic,google}.
    match provider {
        AiProviderKind::Openai => {
            let id = model.split("-20").next().unwrap_or(model);
            if [
                "o3",
                "o3-mini",
                "o4-mini",
                "gpt-5",
                "gpt-5-mini",
                "gpt-5-nano",
                "gpt-5.1",
                "gpt-5.2",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.4-nano",
                "gpt-6-astra",
            ]
            .contains(&id)
            {
                efforts(&["low", "medium", "high"])
            } else {
                empty()
            }
        }
        AiProviderKind::Anthropic => {
            if [
                "claude-sonnet-4-6",
                "claude-opus-4-6",
                "claude-opus-4-7",
                "claude-opus-4-8",
                "claude-opus-5",
                "claude-sonnet-5",
                "claude-fable-5",
            ]
            .iter()
            .any(|prefix| model == *prefix || model.starts_with(&format!("{prefix}-")))
            {
                efforts(&["low", "medium", "high"])
            } else if [
                "claude-3-7-sonnet",
                "claude-sonnet-4",
                "claude-opus-4",
                "claude-haiku-4-5",
            ]
            .iter()
            .any(|prefix| model == *prefix || model.starts_with(&format!("{prefix}-")))
            {
                AssistantModelOptions {
                    reasoning: budgets(output_limit),
                    reasoning_source: Some("documented_model_family".into()),
                }
            } else {
                empty()
            }
        }
        AiProviderKind::Gemini => {
            if model.starts_with("gemini-3") {
                if model.contains("flash") {
                    efforts(&["minimal", "low", "medium", "high"])
                } else if model.starts_with("gemini-3.1-pro") {
                    efforts(&["low", "medium", "high"])
                } else if model.starts_with("gemini-3-pro") {
                    efforts(&["low", "high"])
                } else {
                    empty()
                }
            } else if model.starts_with("gemini-2.5-pro") || model.starts_with("gemini-2.5-flash") {
                AssistantModelOptions {
                    reasoning: budgets(output_limit),
                    reasoning_source: Some("documented_model_family".into()),
                }
            } else {
                empty()
            }
        }
        _ => empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn conversation_overrides_survive_reopen_are_frozen_and_never_edit_the_preset() {
        use super::super::{agent::AgentRuntime, agent_tests, conversations, transport::Transport};
        let (_root, service, preset) = agent_tests::setup(Some(true)).await;
        let config = configuration::export(&service.history).await.unwrap();
        let key = serde_json::to_string(&(&config.connections[0], &config.presets[0])).unwrap();
        CACHE.lock().await.insert(
            key,
            (
                Instant::now(),
                AssistantModelOptions {
                    reasoning: vec![effort("high")],
                    reasoning_source: Some("fixture_model_metadata".into()),
                },
            ),
        );
        let thread = conversations::initialize(&service.history, "options-test")
            .await
            .unwrap();
        let saved = conversations::update(
            &service.history,
            RecallThreadUpdate {
                thread_id: thread.id.clone(),
                title: "Options".into(),
                archived: false,
                preset_id: Some(preset.id.clone()),
                web_enabled: false,
                reasoning: Some(effort("high")),
            },
        )
        .await
        .unwrap();
        assert_eq!(saved.reasoning, Some(effort("high")));
        assert_eq!(
            conversations::load(&service.history, &thread.id)
                .await
                .unwrap()
                .thread
                .reasoning,
            saved.reasoning
        );
        let runtime = AgentRuntime::default();
        let transport = Transport::default();
        let mut request = agent_tests::request(&preset);
        request.reasoning = saved.reasoning;
        let context = runtime
            .begin(&service.history, &transport, request)
            .await
            .unwrap();
        assert_eq!(context.reasoning, Some(effort("high")));
        assert!(context.preset.options.openai.is_none());
        let unchanged = configuration::export(&service.history).await.unwrap();
        assert!(unchanged.presets[0].options.openai.is_none());
        runtime.finish(&transport, &context.run_id).await;
        let mut request = agent_tests::request(&preset);
        request.reasoning = Some(effort("unsupported"));
        assert!(runtime
            .begin(&service.history, &transport, request)
            .await
            .is_err());
        assert!(serde_json::from_value::<ReasoningSelection>(
            json!({"kind":"effort","value":"high","headers":{}})
        )
        .is_err());
    }
    #[test]
    fn ollama_uses_reported_controls_without_guessing_from_names() {
        assert!(ollama_options(&json!({"capabilities":["thinking"]}))
            .reasoning
            .is_empty());
        assert!(ollama_options(&json!({"thinking":{"values":[false]}}))
            .reasoning
            .is_empty());
        assert_eq!(
            ollama_options(&json!({"thinking":{"values":["low","high","high",42]}})).reasoning,
            vec![effort("low"), effort("high")]
        );
        assert_eq!(
            ollama_options(&json!({"thinking":{"values":[true]}})).reasoning,
            vec![ReasoningSelection::Thinking { enabled: true }]
        );
    }
    #[test]
    fn catalog_controls_intersect_adapter_support_and_mandatory_reasoning() {
        let options = openrouter_options(
            &json!({"reasoning":{"supported_efforts":["max","high","none"],"mandatory":true,"supports_max_tokens":true}}),
            2048,
        );
        assert_eq!(
            options.reasoning,
            vec![effort("high"), ReasoningSelection::Budget { tokens: 1024 }]
        );
        assert!(openrouter_options(&json!({}), 8192).reasoning.is_empty());
    }
    #[test]
    fn unknown_models_do_not_get_controls_and_budgets_leave_answer_room() {
        assert!(
            documented_options(AiProviderKind::Openai, "custom-model", 4096)
                .reasoning
                .is_empty()
        );
        assert!(
            documented_options(AiProviderKind::Anthropic, "claude-sonnet-4-5", 1024)
                .reasoning
                .is_empty()
        );
        assert_eq!(
            documented_options(AiProviderKind::Gemini, "gemini-3-pro-preview", 8192).reasoning,
            vec![effort("low"), effort("high")]
        );
    }
}
