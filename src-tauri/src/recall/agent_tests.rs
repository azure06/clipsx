use super::{
    agent::AgentRuntime,
    configuration,
    contracts::*,
    service_tests::{capture, make_secret, repository},
    transport::Transport,
};
use crate::history::new_id;
use serde_json::json;

pub(super) async fn setup(
    tools: Option<bool>,
) -> (
    tempfile::TempDir,
    super::service::ClipboardService,
    AiModelPreset,
) {
    let (root, service) = repository().await;
    let connection = AiConnection {
        id: new_id(),
        name: "Local".into(),
        provider: AiProviderKind::Ollama,
        base_url: "http://127.0.0.1:11434".into(),
        enabled: true,
        options: AiConnectionOptions {
            organization: None,
            project: None,
        },
    };
    let preset = AiModelPreset {
        id: new_id(),
        name: "Chat".into(),
        connection_id: connection.id.clone(),
        model_id: "fixture-chat".into(),
        purpose: AiModelPurpose::Chat,
        context_limit: 32768,
        output_limit: 4096,
        options: configuration::default_options(),
        capabilities: AiCapabilities {
            tools,
            vision: None,
            web_search: None,
            source: None,
        },
    };
    configuration::import(
        &service.history,
        AiConfiguration {
            version: 1,
            connections: vec![connection],
            presets: vec![preset.clone()],
            selections: AiSelections {
                default_chat: Some(preset.id.clone()),
                active_embedding: None,
                web_search: None,
            },
        },
    )
    .await
    .unwrap();
    (root, service, preset)
}
pub(super) fn request(preset: &AiModelPreset) -> AssistantRunRequest {
    AssistantRunRequest {
        run_id: new_id(),
        preset_id: preset.id.clone(),
        filters: None,
        attachments: vec![],
        web_enabled: false,
    }
}
#[tokio::test]
async fn run_freezes_actor_filters_and_limits_with_no_secret_access() {
    let (_root, service, preset) = setup(Some(true)).await;
    let allowed = capture(&service, "eligible words", "allowed-app", 100).await;
    let excluded = capture(&service, "excluded words", "other-app", 200).await;
    let secret = capture(&service, "secret words", "allowed-app", 300).await;
    make_secret(&service, &secret).await;
    let runtime = AgentRuntime::default();
    let transport = Transport::default();
    let mut input = request(&preset);
    input.filters = Some(ClipFilters {
        source_app_ids: vec!["allowed-app".into()],
        ..Default::default()
    });
    let context = runtime
        .begin(&service.history, &transport, input)
        .await
        .unwrap();
    assert_eq!(context.web_route, "off");
    assert!(context.connection.base_url.ends_with("/v1/"));
    assert!(runtime
        .begin(&service.history, &transport, request(&preset))
        .await
        .is_err());
    for _ in 0..3 {
        let result = runtime
            .tool(
                &service.history,
                None,
                &context.run_id,
                "search_clips",
                &json!({"query":"","mode":"keyword"}).to_string(),
            )
            .await
            .unwrap();
        let ids = result["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["clip"]["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert!(ids.contains(&allowed.as_str()));
        assert!(!ids.contains(&excluded.as_str()));
        assert!(!ids.contains(&secret.as_str()));
    }
    assert!(runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "search_clips",
            "{\"query\":\"\"}"
        )
        .await
        .is_err());
    assert!(runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "read_clip",
            &json!({"clipId":secret}).to_string()
        )
        .await
        .is_err());
    let action=runtime.tool(&service.history,None,&context.run_id,"create_clip",&json!({"requestId":new_id(),"text":"saved by assistant","format":"plain_text","model":{"provider":"fake","model":"fake"}}).to_string()).await.unwrap();
    let clip = action["clips"][0]["clipId"].as_str().unwrap();
    let attribution: String =
        sqlx::query_scalar("SELECT model_json FROM assistant_clip_provenance WHERE clip_id=?")
            .bind(clip)
            .fetch_one(&service.history.pool)
            .await
            .unwrap();
    assert!(attribution.contains("fixture-chat"));
    assert!(!attribution.contains("fake"));
    runtime.finish(&transport, &context.run_id).await;
    assert!(runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "get_clipboard_status",
            "{}"
        )
        .await
        .is_err());
    let next = runtime
        .begin(&service.history, &transport, request(&preset))
        .await
        .unwrap();
    runtime.finish(&transport, &next.run_id).await;
}
#[tokio::test]
async fn malformed_tool_arguments_have_a_safe_category_and_never_record_a_write() {
    let (_root, service, preset) = setup(Some(true)).await;
    let runtime = AgentRuntime::default();
    let transport = Transport::default();
    let context = runtime
        .begin(&service.history, &transport, request(&preset))
        .await
        .unwrap();
    let unique: std::collections::HashSet<_> = context.status.tools.iter().collect();
    assert_eq!(unique.len(), context.status.tools.len());
    let request_id = new_id();
    for (name, arguments) in [
        ("create_clip", "{".to_string()),
        (
            "create_clip",
            json!({"requestId":request_id,"format":"private-invalid-format"}).to_string(),
        ),
        ("read_clip", json!({"clipId":42}).to_string()),
    ] {
        let error = runtime
            .tool(&service.history, None, &context.run_id, name, &arguments)
            .await
            .unwrap_err();
        let failure = super::service::public_failure(error);
        assert_eq!(failure.code, crate::failure::FailureCode::InvalidParameters);
        assert!(!serde_json::to_string(&failure).unwrap().contains("private"));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM assistant_actions")
        .fetch_one(&service.history.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let valid = json!({"requestId":request_id,"text":"corrected content","format":"plain_text"})
        .to_string();
    let action = runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "create_clip",
            &valid,
        )
        .await
        .unwrap();
    assert_eq!(action["clips"].as_array().unwrap().len(), 1);
    assert_eq!(
        action,
        runtime
            .tool(
                &service.history,
                None,
                &context.run_id,
                "create_clip",
                &valid
            )
            .await
            .unwrap()
    );
    runtime.finish(&transport, &context.run_id).await;
}

#[tokio::test]
async fn unknown_tools_require_read_only_verification_and_web_never_silently_switches() {
    let (_root, service, preset) = setup(None).await;
    let runtime = AgentRuntime::default();
    let transport = Transport::default();
    let mut input = request(&preset);
    input.web_enabled = true;
    let context = runtime
        .begin(&service.history, &transport, input)
        .await
        .unwrap();
    assert_eq!(context.web_route, "unavailable");
    let args =
        json!({"requestId":new_id(),"text":"verified action","format":"plain_text"}).to_string();
    assert!(runtime
        .verify_tools(&service.history, &context.run_id, true)
        .await
        .is_err());
    assert!(runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "create_clip",
            &args
        )
        .await
        .is_err());
    runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "get_clipboard_status",
            "{}",
        )
        .await
        .unwrap();
    runtime
        .verify_tools(&service.history, &context.run_id, true)
        .await
        .unwrap();
    let first = runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "create_clip",
            &args,
        )
        .await
        .unwrap();
    let retry = runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "create_clip",
            &args,
        )
        .await
        .unwrap();
    assert_eq!(first, retry);
    assert!(runtime
        .tool(
            &service.history,
            None,
            &context.run_id,
            "web_search",
            "{\"query\":\"test\"}"
        )
        .await
        .is_err());
    let config = configuration::export(&service.history).await.unwrap();
    assert_eq!(config.presets[0].capabilities.tools, Some(true));
    runtime.finish(&transport, &context.run_id).await;
}
