//! Bounded observations, independent from execution-policy decisions.
use super::{configuration, contracts::*, credentials};
use crate::history::{now_ms, sha256, HistoryRepository};
use anyhow::Result;
use serde_json::Value;
use std::time::Duration;

pub fn identity(connection: &AiConnection, model: &str) -> String {
    sha256(
        format!(
            "{:?}|{}|{}|{}",
            connection.provider,
            connection.id,
            connection.base_url.trim_end_matches('/'),
            model
        )
        .as_bytes(),
    )
}
fn limit(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .filter(|v| *v > 0 && *v <= 2_097_152)
        .map(|v| v as u32)
}
pub fn parse(connection: &AiConnection, model: &str, row: &Value, now: i64) -> ModelInformation {
    let mut info = ModelInformation {
        identity: identity(connection, model),
        context_limit: None,
        input_limit: None,
        output_limit: None,
        runtime_context_limit: None,
        tools: None,
        vision: None,
        structured_output: None,
        reasoning_output: None,
        source: "provider_catalog".into(),
        observed_at: now as f64,
    };
    match connection.provider {
        AiProviderKind::Ollama => {
            info.context_limit = row["model_info"].as_object().and_then(|m| {
                m.iter()
                    .find_map(|(k, v)| k.ends_with(".context_length").then(|| limit(v)).flatten())
            });
            info.runtime_context_limit = row["parameters"].as_str().and_then(|s| {
                s.lines().find_map(|line| {
                    let mut p = line.split_whitespace();
                    (p.next() == Some("num_ctx"))
                        .then(|| p.next()?.parse::<u32>().ok())
                        .flatten()
                })
            });
            if let Some(caps) = row["capabilities"].as_array() {
                info.tools = Some(caps.iter().any(|v| v == "tools"));
                info.vision = Some(caps.iter().any(|v| v == "vision"));
                info.reasoning_output = Some(caps.iter().any(|v| v == "thinking"));
            }
            // A training maximum cannot establish the server's current allocation.
            if info.runtime_context_limit.is_none() {
                info.source = "runtime_context_unknown".into();
            }
        }
        AiProviderKind::Gemini => {
            info.input_limit = limit(&row["inputTokenLimit"]);
            info.output_limit = limit(&row["outputTokenLimit"]);
            info.reasoning_output = row["thinking"].as_bool();
        }
        AiProviderKind::Openrouter => {
            info.context_limit = limit(&row["context_length"]);
            info.output_limit = limit(&row["top_provider"]["max_completion_tokens"]);
            if let Some(parameters) = row["supported_parameters"].as_array() {
                info.tools = Some(parameters.iter().any(|v| v == "tools"));
                info.structured_output = Some(parameters.iter().any(|v| v == "structured_outputs"));
            }
            info.vision = row["architecture"]["input_modalities"]
                .as_array()
                .map(|v| v.iter().any(|m| m == "image"));
        }
        AiProviderKind::Anthropic => {
            info.input_limit = limit(&row["max_input_tokens"]);
            info.output_limit = limit(&row["max_tokens"]);
            info.vision = row["capabilities"]["image_input"]["supported"].as_bool();
            info.structured_output =
                row["capabilities"]["structured_outputs"]["supported"].as_bool();
            info.reasoning_output = row["capabilities"]["thinking"]["supported"].as_bool();
        }
        AiProviderKind::Openai => {
            info.context_limit = limit(&row["context_window"]);
            info.output_limit = limit(&row["max_output_tokens"]);
        }
        AiProviderKind::Tavily => {}
    }
    // Reviewed rules v1 (2026-10-12), official API only: custom routes may impose different limits.
    // https://developers.openai.com/api/docs/models/gpt-4.1
    // https://developers.openai.com/api/docs/models/gpt-4o
    if connection.provider == AiProviderKind::Openai
        && url::Url::parse(&connection.base_url)
            .ok()
            .is_some_and(|u| u.host_str() == Some("api.openai.com"))
    {
        let documented = match model {
            "gpt-4.1" | "gpt-4.1-2025-04-14" => Some((1_047_576, 32_768)),
            "gpt-4o" | "gpt-4o-2024-08-06" | "gpt-4o-2024-11-20" => Some((128_000, 16_384)),
            _ => None,
        };
        if let Some((context, output)) = documented {
            if info.context_limit.is_none() || info.output_limit.is_none() {
                info.source = "provider_catalog_and_documented_rules_v1_20261012".into();
            }
            info.context_limit.get_or_insert(context);
            info.output_limit.get_or_insert(output);
            info.tools.get_or_insert(true);
            info.vision.get_or_insert(true);
            info.structured_output.get_or_insert(true);
        }
    }
    info
}
pub async fn save(repo: &HistoryRepository, info: &ModelInformation) -> Result<()> {
    sqlx::query("DELETE FROM ai_model_observations WHERE observed_at<?")
        .bind(now_ms() - 300_000)
        .execute(&repo.pool)
        .await?;
    sqlx::query("INSERT INTO ai_model_observations(identity,information_json,observed_at) VALUES(?,?,?) ON CONFLICT(identity) DO UPDATE SET information_json=excluded.information_json,observed_at=excluded.observed_at")
        .bind(&info.identity).bind(serde_json::to_string(info)?).bind(info.observed_at as i64).execute(&repo.pool).await?;
    Ok(())
}
pub async fn cached(
    repo: &HistoryRepository,
    connection: &AiConnection,
    model: &str,
    now: i64,
) -> Result<Option<ModelInformation>> {
    let row: Option<String>=sqlx::query_scalar("SELECT information_json FROM ai_model_observations WHERE identity=? AND observed_at>? AND observed_at<=?")
        .bind(identity(connection,model)).bind(now-300_000).bind(now).fetch_optional(&repo.pool).await?;
    Ok(row.and_then(|v| serde_json::from_str(&v).ok()))
}
pub async fn resolve(
    repo: &HistoryRepository,
    connection: &AiConnection,
    preset: &AiModelPreset,
    refresh: bool,
) -> Result<Option<ModelInformation>> {
    if !refresh {
        if let Some(info) = cached(repo, connection, &preset.model_id, now_ms()).await? {
            return Ok(Some(info));
        }
    }
    let base = configuration::validate_connection(connection)?;
    let row = if connection.provider == AiProviderKind::Ollama {
        let client = crate::providers::ollama::client::OllamaClient::new(base.as_str())?;
        let mut row = client
            .post_bounded(
                "api/show",
                serde_json::json!({"model":preset.model_id,"verbose":false}),
                Duration::from_secs(8),
                1024 * 1024,
            )
            .await?;
        // Loaded runner context is more authoritative than model metadata.
        if let Ok(ps) = client
            .get_bounded("api/ps", Duration::from_secs(8), 1024 * 1024)
            .await
        {
            if let Some(runtime) = ps["models"]
                .as_array()
                .and_then(|v| {
                    v.iter()
                        .find(|m| m["name"] == preset.model_id || m["model"] == preset.model_id)
                })
                .and_then(|v| limit(&v["context_length"]))
            {
                row["parameters"] = Value::String(format!("num_ctx {runtime}"));
            }
        }
        row
    } else {
        let key = credentials::get(repo, &connection.id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("credential_required"))?;
        let mut destination = base.join("models")?;
        if connection.provider != AiProviderKind::Openrouter {
            destination
                .path_segments_mut()
                .map_err(|_| anyhow::anyhow!("invalid_endpoint"))?
                .push(&preset.model_id);
        }
        let value =
            crate::providers::hosted_embedding::request_json(connection, &destination, &key, None)
                .await?;
        if connection.provider == AiProviderKind::Openrouter {
            value["data"]
                .as_array()
                .and_then(|v| v.iter().find(|m| m["id"] == preset.model_id))
                .cloned()
                .unwrap_or(Value::Null)
        } else {
            value
        }
    };
    let mut info = parse(connection, &preset.model_id, &row, now_ms());
    if connection.provider == AiProviderKind::Ollama && info.runtime_context_limit.is_none() {
        // Keep the advertised limit visible, but do not budget against it as runtime capacity.
        info.source = "runtime_context_unknown".into();
    }
    save(repo, &info).await?;
    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn connection(provider: AiProviderKind) -> AiConnection {
        AiConnection {
            id: "c".into(),
            name: "c".into(),
            provider,
            base_url: "https://example.com/".into(),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        }
    }
    #[test]
    fn parses_provider_limits_without_inventing_missing_capabilities() {
        for (provider, row, input, output) in [
            (
                AiProviderKind::Gemini,
                json!({"inputTokenLimit":32000,"outputTokenLimit":8000}),
                Some(32000),
                Some(8000),
            ),
            (
                AiProviderKind::Anthropic,
                json!({"max_input_tokens":200000,"max_tokens":64000}),
                Some(200000),
                Some(64000),
            ),
            (AiProviderKind::Openai, json!({"id":"unknown"}), None, None),
        ] {
            let i = parse(&connection(provider), "m", &row, 0);
            assert_eq!(i.input_limit, input);
            assert_eq!(i.output_limit, output);
            assert_eq!(i.tools, None);
        }
        let i = parse(
            &connection(AiProviderKind::Openrouter),
            "m",
            &json!({"context_length":32768,"supported_parameters":["tools","structured_outputs"]}),
            0,
        );
        assert_eq!(i.context_limit, Some(32768));
        assert_eq!(i.tools, Some(true));
        assert_eq!(i.structured_output, Some(true));
    }
    #[test]
    fn ollama_training_and_runtime_are_distinct() {
        let c = connection(AiProviderKind::Ollama);
        let mut row = json!({"model_info":{"llama.context_length":131072},"capabilities":["completion","thinking"]});
        let i = parse(&c, "m", &row, 0);
        assert_eq!(i.context_limit, Some(131072));
        assert_eq!(i.runtime_context_limit, None);
        row["parameters"] = json!("num_ctx 4096\n");
        assert_eq!(parse(&c, "m", &row, 0).runtime_context_limit, Some(4096));
        assert_eq!(
            parse(&c, "m", &json!({"context_length":-1}), 0).context_limit,
            None
        );
    }
    #[test]
    fn endpoint_and_model_changes_invalidate_identity() {
        let mut c = connection(AiProviderKind::Openai);
        let a = identity(&c, "a");
        assert_ne!(a, identity(&c, "b"));
        c.base_url = "https://other.example/".into();
        assert_ne!(a, identity(&c, "a"));
    }
    #[tokio::test]
    async fn observation_cache_expires_and_refresh_replaces_without_credentials() {
        let (_root, service) = crate::recall::service_tests::repository().await;
        let c = connection(AiProviderKind::Openai);
        let now = now_ms();
        let info = parse(&c, "m", &json!({"context_window":32768}), now);
        save(&service.history, &info).await.unwrap();
        assert_eq!(
            cached(&service.history, &c, "m", now)
                .await
                .unwrap()
                .unwrap()
                .context_limit,
            Some(32768)
        );
        assert!(cached(&service.history, &c, "m", now + 300001)
            .await
            .unwrap()
            .is_none());
        assert!(cached(&service.history, &c, "other", now)
            .await
            .unwrap()
            .is_none());
        let changed = parse(&c, "m", &json!({"context_window":8192}), now);
        save(&service.history, &changed).await.unwrap();
        assert_eq!(
            cached(&service.history, &c, "m", now)
                .await
                .unwrap()
                .unwrap()
                .context_limit,
            Some(8192)
        );
    }
}

#[cfg(test)]
mod documented_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn official_rules_do_not_assume_custom_routes_or_override_observed_limits() {
        let mut c = AiConnection {
            id: "c".into(),
            name: "c".into(),
            provider: AiProviderKind::Openai,
            base_url: "https://api.openai.com/v1/".into(),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        let i = parse(&c, "gpt-4.1-2025-04-14", &json!({}), 0);
        assert_eq!(i.context_limit, Some(1_047_576));
        assert!(i.source.contains("documented_rules_v1"));
        assert_eq!(
            parse(&c, "gpt-4.1", &json!({"context_window":8192}), 0).context_limit,
            Some(8192)
        );
        c.base_url = "https://custom.example/v1".into();
        assert!(parse(&c, "gpt-4.1", &json!({}), 0).context_limit.is_none());
    }
}
