use super::{
    contracts::*,
    mcp::*,
    service_tests::{capture, make_secret, repository},
};
use reqwest::Client;
use serde_json::{json, Value};

#[test]
fn tool_inputs_expose_nested_types_without_schema_references() {
    fn assert_inline(value: &Value) {
        match value {
            Value::Object(object) => {
                assert!(
                    !object.contains_key("$ref"),
                    "Tool inputs must survive provider schema decoding"
                );
                assert!(!object.contains_key("$defs"));
                for value in object.values() {
                    assert_inline(value);
                }
            }
            Value::Array(values) => values.iter().for_each(assert_inline),
            _ => {}
        }
    }
    let definitions = tools(true);
    for tool in &definitions {
        assert_inline(&json!(tool.input_schema));
        assert_eq!(tool.input_schema["additionalProperties"], false);
    }
    let schema = |name: &str| {
        json!(
            definitions
                .iter()
                .find(|tool| tool.name == name)
                .unwrap()
                .input_schema
        )
    };
    let create = schema("create_clip");
    assert_eq!(
        create["properties"]["format"]["enum"],
        json!(["plain_text", "markdown"])
    );
    let source = &create["properties"]["sources"]["items"];
    assert_eq!(source["type"], "object");
    assert_eq!(
        source["required"],
        json!(["clipId", "representationId", "fingerprint"])
    );
    assert_eq!(source["additionalProperties"], false);
    let filters = &schema("search_clips")["properties"]["filters"];
    assert_eq!(filters["properties"]["sourceAppIds"]["type"], "array");
    assert_eq!(
        filters["properties"]["capturedAfter"]["type"],
        json!(["integer", "null"])
    );
    let revision = &schema("organize_clips")["properties"]["clips"]["items"];
    assert_eq!(revision["required"], json!(["clipId", "revision"]));
}

#[test]
fn advertised_search_examples_use_explicit_modes_and_valid_contracts() {
    let tool = tools(false)
        .into_iter()
        .find(|tool| tool.name == "search_clips")
        .unwrap();
    let schema = json!(tool.input_schema);
    let examples = schema["examples"].as_array().unwrap();
    assert_eq!(examples.len(), 3);
    let requests: Vec<ClipSearchRequest> = examples
        .iter()
        .map(|example| super::contracts::parse_tool_arguments(example.clone()).unwrap())
        .collect();
    assert_eq!(requests[0].mode, Some(RetrievalMode::Hybrid));
    assert!(!requests[0].query.is_empty());
    assert_eq!(requests[1].mode, Some(RetrievalMode::Keyword));
    assert_eq!(requests[1].query, "ERR_CONNECTION_RESET");
    assert_eq!(requests[2].mode, Some(RetrievalMode::Keyword));
    assert!(requests[2].query.is_empty());
    assert_eq!(
        requests[2].filters.as_ref().unwrap().scope.as_deref(),
        Some("pinned")
    );
    for request in requests {
        assert!((1..=50).contains(&request.limit.unwrap()));
        assert!(request.cursor.is_none());
    }
    for field in ["query", "mode", "filters", "cursor"] {
        assert!(!schema["properties"][field]["description"]
            .as_str()
            .unwrap()
            .is_empty());
    }
}

async fn rpc(
    client: &Client,
    url: &str,
    token: &str,
    session: Option<&str>,
    body: Value,
) -> (reqwest::StatusCode, Option<String>, Value) {
    let mut request = client
        .post(url)
        .bearer_auth(token)
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2025-11-25")
        .json(&body);
    if let Some(id) = session {
        request = request.header("mcp-session-id", id);
    }
    let response = request.send().await.unwrap();
    let status = response.status();
    let session = response
        .headers()
        .get("mcp-session-id")
        .map(|v| v.to_str().unwrap().to_string());
    let text = response.text().await.unwrap();
    let value = if text.trim().starts_with('{') {
        serde_json::from_str(&text).unwrap()
    } else {
        text.lines()
            .filter_map(|s| s.strip_prefix("data:"))
            .filter_map(|s| serde_json::from_str::<Value>(s).ok())
            .next_back()
            .unwrap_or(Value::Null)
    };
    (status, session, value)
}
async fn initialize(client: &Client, url: &str, token: &str) -> String {
    let (status,session,result)=rpc(client,url,token,None,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"ClipsX protocol fixture","version":"1"}}})).await;
    assert!(status.is_success(), "{status}: {result}");
    assert_eq!(result["result"]["serverInfo"]["name"], "ClipsX");
    assert_eq!(result["result"]["instructions"], MCP_INSTRUCTIONS);
    let session = session.unwrap();
    let (status, _, _) = rpc(
        client,
        url,
        token,
        Some(&session),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await;
    assert!(status.is_success());
    session
}
async fn call(
    client: &Client,
    url: &str,
    token: &str,
    session: &str,
    name: &str,
    args: Value,
) -> Value {
    let (status,_,result)=rpc(client,url,token,Some(session),json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":name,"arguments":args}})).await;
    assert!(status.is_success(), "{status}: {result}");
    result["result"].clone()
}

#[tokio::test]
async fn protocol_grants_sessions_images_writes_revocation_and_shutdown() {
    let (_temp, service) = repository().await;
    let public = capture(&service, "find this public evidence", "editor", 100).await;
    let secret = capture(&service, "find this secret evidence", "editor", 200).await;
    make_secret(&service, &secret).await;
    // Ephemeral binding is a fixture-only setting; public configuration rejects port zero.
    sqlx::query("INSERT INTO config_device_values(key,value_json,updated_at) VALUES('assistant.mcp','{\"enabled\":true,\"port\":0}',0)").execute(&service.history.pool).await.unwrap();
    let runtime = McpRuntime::default();
    runtime
        .reconcile(service.history.clone(), None)
        .await
        .unwrap();
    let url = runtime.status(&service.history).await.unwrap().endpoint;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();
    let read = issue(&service.history, "read fixture", false, None)
        .await
        .unwrap();
    let write = issue(&service.history, "write fixture", true, None)
        .await
        .unwrap();
    assert_eq!(client.post(&url).send().await.unwrap().status(), 401);
    assert_eq!(
        client
            .post(&url)
            .bearer_auth(&read.token)
            .header("origin", "https://untrusted.example")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(&url)
            .bearer_auth(&read.token)
            .header("host", "untrusted.example")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let read_session = initialize(&client, &url, &read.token).await;
    assert_eq!(
        test_access(&runtime, &service.history, &read.token)
            .await
            .unwrap(),
        5
    );
    let write_session = initialize(&client, &url, &write.token).await;
    // Pagination stays bounded over HTTP, including multibyte text.
    let long_text = "日本語".repeat(5000);
    let long_clip = capture(&service, &long_text, "editor", 300).await;
    let mut cursor = Value::Null;
    let mut recovered = String::new();
    loop {
        let page = call(
            &client,
            &url,
            &read.token,
            &read_session,
            "read_clip",
            json!({"clipId":long_clip,"pageBytes":4096,"cursor":cursor}),
        )
        .await;
        let text = page["structuredContent"]["text"].as_str().unwrap();
        assert!(text.len() <= 4096);
        recovered.push_str(text);
        cursor = page["structuredContent"]["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(recovered, long_text);
    let first = call(
        &client,
        &url,
        &read.token,
        &read_session,
        "search_clips",
        json!({"query":"","limit":1}),
    )
    .await;
    assert_eq!(
        first["structuredContent"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let next = first["structuredContent"]["nextCursor"].clone();
    assert!(!next.is_null());
    let second = call(
        &client,
        &url,
        &read.token,
        &read_session,
        "search_clips",
        json!({"query":"","limit":1,"cursor":next}),
    )
    .await;
    assert_ne!(
        first["structuredContent"]["items"][0]["clip"]["id"],
        second["structuredContent"]["items"][0]["clip"]["id"]
    );
    // A client can lose the response after commit. Retry the same ID, never a fresh mutation.
    let lost_id = crate::history::new_id();
    let lost =
        json!({"requestId":lost_id,"text":"response delivery interrupted","format":"plain_text"});
    let response=client.post(&url).bearer_auth(&write.token)
        .header("accept","application/json, text/event-stream").header("mcp-session-id",&write_session)
        .json(&json!({"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"create_clip","arguments":lost}}))
        .send().await.unwrap();
    assert!(response.status().is_success());
    drop(response);
    let replay = call(
        &client,
        &url,
        &write.token,
        &write_session,
        "create_clip",
        lost,
    )
    .await;
    assert_ne!(replay["isError"], true);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM assistant_actions WHERE request_id=?")
            .bind(&lost_id)
            .fetch_one(&service.history.pool)
            .await
            .unwrap(),
        1
    );
    for (token, session, expected) in [
        (&read.token, &read_session, 5),
        (&write.token, &write_session, 8),
    ] {
        let status = call(
            &client,
            &url,
            token,
            session,
            "get_clipboard_status",
            json!({}),
        )
        .await;
        assert_eq!(
            status["structuredContent"]["tools"]
                .as_array()
                .unwrap()
                .len(),
            expected
        );
    }
    let (_, _, discovery) = rpc(
        &client,
        &url,
        &read.token,
        Some(&read_session),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    )
    .await;
    assert_eq!(discovery["result"]["tools"].as_array().unwrap().len(), 5);
    assert_eq!(
        discovery["result"]["tools"][2]["inputSchema"]["additionalProperties"],
        false
    );
    let result = call(
        &client,
        &url,
        &read.token,
        &read_session,
        "search_clips",
        json!({"query":"find"}),
    )
    .await;
    assert_eq!(
        result["structuredContent"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        result["structuredContent"]["items"][0]["clip"]["id"],
        public
    );
    assert_eq!(
        call(
            &client,
            &url,
            &read.token,
            &read_session,
            "read_clip",
            json!({"clipId":secret})
        )
        .await["isError"],
        true
    );
    let create = json!({"requestId":crate::history::new_id(),"format":"plain_text","text":"MCP created fixture"});
    let denied = call(
        &client,
        &url,
        &read.token,
        &read_session,
        "create_clip",
        create.clone(),
    )
    .await;
    assert!(denied["isError"] == true || denied.is_null());
    let cross = rpc(
        &client,
        &url,
        &write.token,
        Some(&read_session),
        json!({"jsonrpc":"2.0","id":9,"method":"tools/list"}),
    )
    .await;
    assert!(!cross.0.is_success());
    let created = call(
        &client,
        &url,
        &write.token,
        &write_session,
        "create_clip",
        create.clone(),
    )
    .await;
    assert_ne!(created["isError"], true);
    let replay = call(
        &client,
        &url,
        &write.token,
        &write_session,
        "create_clip",
        create,
    )
    .await;
    assert_eq!(
        created["structuredContent"]["actionId"],
        replay["structuredContent"]["actionId"]
    );
    let target = created["structuredContent"]["clips"][0].clone();
    let organized=call(&client,&url,&write.token,&write_session,"organize_clips",json!({"requestId":crate::history::new_id(),"clips":[target],"favorite":true,"addTags":["MCP"]})).await;
    let undone=call(&client,&url,&write.token,&write_session,"undo_clipboard_action",json!({"requestId":crate::history::new_id(),"actionId":organized["structuredContent"]["actionId"]})).await;
    assert_ne!(undone["isError"], true);
    let mut image = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut image, image::ImageFormat::Png)
        .unwrap();
    let (image_id, _) = service
        .history
        .capture(
            crate::history::CapturedSnapshot {
                token: 10,
                source_app_id: None,
                source_app_name: None,
                format_observations: vec![],
                representations: vec![crate::history::CapturedRepresentation {
                    format_key: "image/png".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: None,
                    platform: if cfg!(target_os = "windows") {
                        "windows"
                    } else if cfg!(target_os = "macos") {
                        "macos"
                    } else {
                        "linux_x11"
                    }
                    .into(),
                    capture_priority: 0,
                    payload: crate::history::CapturedPayload::Binary(image.into_inner()),
                }],
            },
            &crate::history::CaptureSettings::default(),
        )
        .await
        .unwrap();
    let rep = service.metadata(&image_id).await.unwrap().representations[0]
        .id
        .clone();
    let image = call(
        &client,
        &url,
        &read.token,
        &read_session,
        "read_clip_image",
        json!({"clipId":image_id,"representationId":rep}),
    )
    .await;
    assert_eq!(image["content"][0]["type"], "image");
    assert_eq!(image["content"][0]["mimeType"], "image/png");
    assert!(image["structuredContent"].get("data").is_none());
    let stored: String =
        sqlx::query_scalar("SELECT token_sha256 FROM assistant_mcp_grants WHERE id=?")
            .bind(&read.grant.id)
            .fetch_one(&service.history.pool)
            .await
            .unwrap();
    assert_ne!(stored, read.token);
    let rotated = issue(
        &service.history,
        "read fixture",
        false,
        Some(&read.grant.id),
    )
    .await
    .unwrap();
    runtime.invalidate(&read.grant.id).await;
    assert_eq!(
        rpc(
            &client,
            &url,
            &read.token,
            Some(&read_session),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})
        )
        .await
        .0,
        401
    );
    let rotated_session = initialize(&client, &url, &rotated.token).await;
    revoke(&service.history, &write.grant.id).await.unwrap();
    runtime.invalidate(&write.grant.id).await;
    assert_eq!(
        rpc(
            &client,
            &url,
            &write.token,
            Some(&write_session),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})
        )
        .await
        .0,
        401
    );
    let actor = format!("mcp:{}", write.grant.id);
    let actions_before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM assistant_actions WHERE actor_id=?")
            .bind(&actor)
            .fetch_one(&service.history.pool)
            .await
            .unwrap();
    assert!(actions_before > 0);
    delete_grant(&service.history, &write.grant.id)
        .await
        .unwrap();
    delete_grant(&service.history, &read.grant.id)
        .await
        .unwrap();
    runtime.invalidate(&read.grant.id).await;
    assert!(grants(&service.history).await.unwrap().is_empty());
    let actions_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM assistant_actions WHERE actor_id=?")
            .bind(&actor)
            .fetch_one(&service.history.pool)
            .await
            .unwrap();
    assert_eq!(actions_before, actions_after);
    assert!(service.metadata(&public).await.is_ok());
    for session in [Some(rotated_session.as_str()), None] {
        assert_eq!(
            rpc(
                &client,
                &url,
                &rotated.token,
                session,
                json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})
            )
            .await
            .0,
            401
        );
    }
    configure(
        &service.history,
        McpConfiguration {
            enabled: false,
            port: 39389,
        },
    )
    .await
    .unwrap();
    runtime
        .reconcile(service.history.clone(), None)
        .await
        .unwrap();
    assert_eq!(
        runtime.status(&service.history).await.unwrap().state,
        "disabled"
    );
    assert!(client.post(&url).send().await.is_err());
}

#[tokio::test]
async fn deleting_a_grant_is_scoped_idempotent_and_rejects_invalid_ids() {
    let (_temp, service) = repository().await;
    let first = issue(&service.history, "delete fixture", false, None)
        .await
        .unwrap();
    let other = issue(&service.history, "keep fixture", true, None)
        .await
        .unwrap();
    assert!(delete_grant(&service.history, "invalid").await.is_err());
    assert_eq!(grants(&service.history).await.unwrap().len(), 2);
    delete_grant(&service.history, &first.grant.id)
        .await
        .unwrap();
    delete_grant(&service.history, &first.grant.id)
        .await
        .unwrap();
    let remaining = grants(&service.history).await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, other.grant.id);
    assert!(!remaining[0].revoked);
    assert!(
        issue(&service.history, "deleted", false, Some(&first.grant.id))
            .await
            .is_err()
    );
}

#[tokio::test]
#[ignore = "Requires CLIPSX_CODEX_BINARY pointing to an installed Codex CLI; starts no model turn"]
async fn codex_client_workflows() {
    let codex = std::env::var("CLIPSX_CODEX_BINARY").expect("Set CLIPSX_CODEX_BINARY");
    let (root, service) = repository().await;
    let public = capture(&service, "external fixture evidence", "fixture", 100).await;
    let secret = capture(&service, "external fixture secret", "fixture", 200).await;
    make_secret(&service, &secret).await;
    let mut image = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut image, image::ImageFormat::Png)
        .unwrap();
    let (image_id, _) = service
        .history
        .capture(
            crate::history::CapturedSnapshot {
                token: 300,
                source_app_id: None,
                source_app_name: None,
                format_observations: vec![],
                representations: vec![crate::history::CapturedRepresentation {
                    format_key: "image/png".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: None,
                    platform: super::representation_platform().into(),
                    capture_priority: 0,
                    payload: crate::history::CapturedPayload::Binary(image.into_inner()),
                }],
            },
            &crate::history::CaptureSettings::default(),
        )
        .await
        .unwrap();
    let image_representation = service.metadata(&image_id).await.unwrap().representations[0]
        .id
        .clone();
    sqlx::query("INSERT INTO config_device_values(key,value_json,updated_at) VALUES('assistant.mcp','{\"enabled\":true,\"port\":0}',0)")
        .execute(&service.history.pool).await.unwrap();
    let runtime = McpRuntime::default();
    runtime
        .reconcile(service.history.clone(), None)
        .await
        .unwrap();
    let read = issue(&service.history, "Codex read fixture", false, None)
        .await
        .unwrap();
    let write = issue(&service.history, "Codex write fixture", true, None)
        .await
        .unwrap();
    let input = json!({
        "root":root.path(), "codex":codex,
        "endpoint":runtime.status(&service.history).await.unwrap().endpoint,
        "readToken":read.token, "writeToken":write.token,
        "clipId":public, "secretId":secret, "imageId":image_id, "imageRepresentationId":image_representation,
    });
    let output = tokio::task::spawn_blocking(move || {
        use std::{
            io::Write,
            process::{Command, Stdio},
        };
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/verify-codex-mcp.mjs");
        let mut child = Command::new("node")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
        child.wait_with_output().unwrap()
    })
    .await
    .unwrap();
    drop(runtime);
    assert!(
        output.status.success(),
        "Codex fixture failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["passed"], true);
    assert_eq!(report["modelTurns"], 0);
    println!("{report}");
}

#[tokio::test]
async fn port_failure_is_isolated_and_defaults_are_disabled() {
    let (_temp, service) = repository().await;
    let runtime = McpRuntime::default();
    assert_eq!(
        runtime.status(&service.history).await.unwrap().state,
        "disabled"
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    configure(
        &service.history,
        McpConfiguration {
            enabled: true,
            port,
        },
    )
    .await
    .unwrap();
    runtime
        .reconcile(service.history.clone(), None)
        .await
        .unwrap();
    assert_eq!(
        runtime
            .status(&service.history)
            .await
            .unwrap()
            .diagnostic
            .as_deref(),
        Some("port_unavailable")
    );
    assert!(!capture(&service, "capture still works", "editor", 0)
        .await
        .is_empty());
}

#[tokio::test]
async fn reconfiguring_enabled_server_keeps_same_port_available() {
    let (_temp, service) = repository().await;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    configure(
        &service.history,
        McpConfiguration {
            enabled: true,
            port,
        },
    )
    .await
    .unwrap();
    let runtime = McpRuntime::default();
    runtime
        .reconcile(service.history.clone(), None)
        .await
        .unwrap();
    let url = runtime.status(&service.history).await.unwrap().endpoint;
    let grant = issue(&service.history, "reconfigure fixture", false, None)
        .await
        .unwrap();
    let client = Client::new();
    let session = initialize(&client, &url, &grant.token).await;
    runtime
        .reconcile(service.history.clone(), None)
        .await
        .unwrap();
    assert_eq!(
        runtime.status(&service.history).await.unwrap().state,
        "running"
    );
    let result = call(
        &client,
        &url,
        &grant.token,
        &session,
        "get_clipboard_status",
        json!({}),
    )
    .await;
    assert_ne!(result["isError"], true);
}
