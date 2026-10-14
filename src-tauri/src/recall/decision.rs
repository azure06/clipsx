//! Explicit synthetic capability check. No clipboard data or automation is involved.
use super::{configuration, contracts::*};
use crate::{history::HistoryRepository, providers::ollama::client::OllamaClient};
use anyhow::{bail, Context, Result};
use std::time::Duration;

pub async fn test(repo: &HistoryRepository, preset_id: &str) -> Result<DecisionTestResult> {
    let document = configuration::export(repo).await?;
    let preset = document
        .presets
        .iter()
        .find(|p| p.id == preset_id && p.purpose == AiModelPurpose::Decision)
        .context("missing_decision_preset")?;
    let connection = document
        .connections
        .iter()
        .find(|c| c.id == preset.connection_id && c.enabled && c.provider == AiProviderKind::Ollama)
        .context("connection_disabled")?;
    let client = OllamaClient::new(&connection.base_url)?;
    let value = client.post_bounded("v1/systemone", serde_json::json!({
        "model": preset.model_id,
        "state": "A meeting is scheduled for Tuesday at 10 AM.",
        "questions": {"category": {"type":"choice", "instructions":"Classify this text.",
            "criteria":{"schedule":"An appointment or meeting", "code":"Computer source code"}}}
    }), Duration::from_secs(60), 64 * 1024).await?;
    parse_result(&value).map_err(|_| {
        crate::providers::error::ProviderError::InvalidOutput("invalid decision response".into())
            .into()
    })
}

fn parse_result(value: &serde_json::Value) -> Result<DecisionTestResult> {
    let answer = &value["answers"]["category"];
    let choice = answer["choice"]
        .as_str()
        .context("invalid_decision_response")?;
    let confidence = answer["confidence"]
        .as_f64()
        .context("invalid_decision_response")?;
    if answer["type"] != "choice"
        || !["schedule", "code"].contains(&choice)
        || !confidence.is_finite()
        || !(0.0..=1.0).contains(&confidence)
    {
        bail!("invalid_decision_response");
    }
    let probabilities = answer["probabilities"]
        .as_object()
        .context("invalid_decision_response")?;
    if probabilities.len() != 2
        || ["schedule", "code"].iter().any(|key| {
            probabilities
                .get(*key)
                .and_then(|v| v.as_f64())
                .is_none_or(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
        })
    {
        bail!("invalid_decision_response");
    }
    Ok(DecisionTestResult {
        choice: choice.into(),
        confidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn explicit_test_uses_saved_local_endpoint_without_changing_assignments() {
        use axum::{body::Bytes, routing::post, Router};
        let (_root, service) = crate::recall::service_tests::repository().await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let connection = AiConnection {
            id: crate::history::new_id(),
            name: "Decision fixture".into(),
            provider: AiProviderKind::Ollama,
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            enabled: true,
            options: AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        let preset = AiModelPreset {
            id: crate::history::new_id(),
            name: "Decision fixture".into(),
            connection_id: connection.id.clone(),
            model_id: "fixture-decision".into(),
            purpose: AiModelPurpose::Decision,
            context_limit: 32768,
            output_limit: 4096,
            options: configuration::default_options(),
            capabilities: configuration::unknown_capabilities(),
        };
        let app = Router::new().route("/v1/systemone", post(|bytes: Bytes| async move {
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["model"], "fixture-decision");
            assert_eq!(body["state"], "A meeting is scheduled for Tuesday at 10 AM.");
            assert_eq!(body["questions"]["category"]["type"], "choice");
            serde_json::json!({"answers":{"category":{"type":"choice","choice":"schedule","confidence":0.8,"probabilities":{"schedule":0.95,"code":0.05}}}}).to_string()
        }));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let mut document = AiConfiguration {
            version: 2,
            connections: vec![connection],
            presets: vec![preset.clone()],
            selections: AiSelections::default(),
        };
        configuration::import(&service.history, document.clone())
            .await
            .unwrap();
        let before =
            serde_json::to_value(configuration::export(&service.history).await.unwrap()).unwrap();
        assert_eq!(
            test(&service.history, &preset.id).await.unwrap().choice,
            "schedule"
        );
        assert_eq!(
            before,
            serde_json::to_value(configuration::export(&service.history).await.unwrap()).unwrap()
        );
        document.connections[0].enabled = false;
        configuration::import(&service.history, document)
            .await
            .unwrap();
        assert!(test(&service.history, &preset.id).await.is_err());
        server.abort();
    }
    #[test]
    fn decision_responses_require_known_choices_and_bounded_probabilities() {
        let mut fixture = serde_json::json!({"answers":{"category":{"type":"choice", "choice":"schedule", "confidence":0.9, "probabilities":{"schedule":0.95,"code":0.05}}}});
        assert_eq!(parse_result(&fixture).unwrap().choice, "schedule");
        fixture["answers"]["category"]["choice"] = serde_json::json!("invented");
        assert!(parse_result(&fixture).is_err());
        fixture["answers"]["category"]["choice"] = serde_json::json!("schedule");
        fixture["answers"]["category"]["confidence"] = serde_json::json!(2);
        assert!(parse_result(&fixture).is_err());
        assert!(parse_result(&serde_json::json!({"message":{"content":"chat response"}})).is_err());
    }
}
