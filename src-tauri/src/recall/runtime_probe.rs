//! Opt-in production-webview fixture probe. Does not open clipboard storage or telemetry.
use super::transport::{Provider, RunConnection, Transport};
use anyhow::Result;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const PRIVATE_SENTINEL: &str = "host-private-probe-sentinel";
const IMAGE: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=";

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    requests: usize,
    images: usize,
    native_tools: usize,
    tool_results: usize,
    authenticated: usize,
    context_operations: usize,
}
#[derive(Default)]
struct Evidence {
    receipts: HashMap<String, Receipt>,
    invalid_request: bool,
}
struct Probe {
    result_path: PathBuf,
    endpoint: url::Url,
    run: Mutex<Option<String>>,
    evidence: Arc<Mutex<Evidence>>,
}

#[tauri::command]
fn runtime_gate_begin(
    webview: tauri::Webview,
    probe: State<'_, Probe>,
    transport: State<'_, Transport>,
    provider: Provider,
) -> Result<Value, &'static str> {
    if webview.label() != "main" {
        return Err("access_denied");
    }
    let mut active = probe.run.lock().map_err(|_| "probe_unavailable")?;
    if let Some(previous) = active.take() {
        transport.finish_run(&previous);
    }
    let run_id = uuid::Uuid::now_v7().to_string();
    let name = serde_json::to_value(provider)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    let base_url = format!("https://fixture.invalid/{name}/v1");
    transport.bind_run(
        run_id.clone(),
        RunConnection {
            provider,
            base_url: base_url.parse().unwrap(),
            credential: Some(PRIVATE_SENTINEL.into()),
            organization: None,
            project: None,
            fixture_destination: Some(probe.endpoint.clone()),
        },
    )?;
    *active = Some(run_id.clone());
    Ok(
        json!({ "runId": run_id, "connection": { "id": name, "provider": provider, "baseUrl": base_url } }),
    )
}

#[tauri::command]
fn runtime_gate_tool(
    webview: tauri::Webview,
    probe: State<'_, Probe>,
    run_id: String,
) -> Result<Value, &'static str> {
    if webview.label() != "main"
        || probe.run.lock().map_err(|_| "probe_unavailable")?.as_ref() != Some(&run_id)
    {
        return Err("access_denied");
    }
    // Each fixture's first HTTP request has registered exactly one incomplete receipt.
    let mut evidence = probe.evidence.lock().map_err(|_| "probe_unavailable")?;
    let receipt = evidence
        .receipts
        .values_mut()
        .find(|r| r.requests == 1 && r.native_tools == 0)
        .ok_or("fixture_sequence")?;
    receipt.native_tools += 1;
    Ok(json!({"evidence": "verified-evidence"}))
}

#[tauri::command]
async fn runtime_gate_finish(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    probe: State<'_, Probe>,
    results: HashMap<String, bool>,
    user_agent: String,
) -> Result<(), &'static str> {
    if webview.label() != "main" {
        return Err("access_denied");
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    let evidence = probe.evidence.lock().map_err(|_| "probe_unavailable")?;
    let receipts_passed = ["openai", "anthropic", "gemini", "openrouter", "ollama"]
        .iter()
        .all(|name| {
            evidence.receipts.get(*name).is_some_and(|r| {
                r.requests == 3
                    && r.images == 2
                    && r.authenticated == 3
                    && r.native_tools == 1
                    && r.tool_results == 1
                    && r.context_operations == 1
            })
        });
    let passed = receipts_passed
        && !evidence.invalid_request
        && results.len() == 6
        && results.values().all(|value| *value);
    let report = json!({"passed": passed, "providerFixtures": results, "nativeReceipts": evidence.receipts, "requestValidationPassed": !evidence.invalid_request, "userAgent": user_agent.chars().take(1024).collect::<String>(), "liveProvidersTested": false});
    let bytes = serde_json::to_vec_pretty(&report).map_err(|_| "report_unavailable")?;
    if String::from_utf8_lossy(&bytes).contains(PRIVATE_SENTINEL) {
        return Err("credential_exposed");
    }
    std::fs::write(&probe.result_path, bytes).map_err(|_| "report_unavailable")?;
    app.exit(if passed { 0 } else { 1 });
    Ok(())
}

async fn fixture_request(mut stream: TcpStream, evidence: Arc<Mutex<Evidence>>) -> Result<()> {
    let mut bytes = Vec::new();
    let header_end;
    loop {
        let mut buffer = [0u8; 4096];
        let count = stream.read(&mut buffer).await?;
        if count == 0 {
            anyhow::bail!("fixture request incomplete")
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > 8 * 1024 * 1024 {
            anyhow::bail!("fixture request oversized")
        }
        if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }
    let headers = String::from_utf8_lossy(&bytes[..header_end]).to_string();
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .and_then(|v| v.trim().parse::<usize>().ok())
        })
        .unwrap_or_default();
    if content_length > 8 * 1024 * 1024 {
        anyhow::bail!("fixture request oversized")
    }
    while bytes.len() < header_end + content_length {
        let mut buffer = [0u8; 4096];
        let count = stream.read(&mut buffer).await?;
        if count == 0 {
            anyhow::bail!("fixture body incomplete")
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let body = String::from_utf8(bytes[header_end..header_end + content_length].to_vec())?;
    if body == "{\"cancel\":true}" {
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await?;
        tokio::time::sleep(Duration::from_secs(10)).await;
        return Ok(());
    }
    let name = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| path.split('/').nth(1))
        .unwrap_or_default();
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../src/features/recall/runtime/fixtures/streams.json"
    ))?;
    let request_json: Value = serde_json::from_str(&body)?;
    let context_operation = request_json["stream"] != true
        && !headers
            .lines()
            .next()
            .unwrap_or_default()
            .contains(":streamGenerateContent");
    let stage = {
        let mut evidence = evidence.lock().unwrap();
        let receipt = evidence.receipts.entry(name.into()).or_default();
        receipt.requests += 1;
        receipt.images += usize::from(body.contains(IMAGE));
        receipt.authenticated += usize::from(headers.contains(PRIVATE_SENTINEL));
        receipt.tool_results += usize::from(body.contains("verified-evidence"));
        receipt.context_operations += usize::from(context_operation);
        let stage = if receipt.requests == 1 {
            "tool"
        } else {
            "text"
        };
        if body.contains(PRIVATE_SENTINEL)
            || !headers.contains(PRIVATE_SENTINEL)
            || (!context_operation && !body.contains(IMAGE))
            || (context_operation && request_json.get("tools").is_some())
        {
            evidence.invalid_request = true;
        }
        stage
    };
    if context_operation {
        let responses: Value = serde_json::from_str(include_str!(
            "../../../src/features/recall/runtime/fixtures/context-responses.json"
        ))?;
        let response = responses
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("unknown context fixture"))?
            .to_string();
        let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", response.len());
        stream.write_all(headers.as_bytes()).await?;
        stream.write_all(response.as_bytes()).await?;
        return Ok(());
    }
    let records = fixtures
        .get(name)
        .and_then(|v| v.get(stage))
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("unknown fixture"))?;
    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Fixture-Private-Token: host-private-probe-sentinel\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await?;
    for record in records {
        let event = format!("data: {record}\n\n");
        for part in event.as_bytes().chunks(13) {
            let chunk = format!("{:x}\r\n", part.len());
            stream.write_all(chunk.as_bytes()).await?;
            stream.write_all(part).await?;
            stream.write_all(b"\r\n").await?;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    stream.write_all(b"0\r\n\r\n").await?;
    Ok(())
}

pub fn run(result_path: PathBuf) -> Result<()> {
    let evidence = Arc::new(Mutex::new(Evidence::default()));
    let endpoint = tauri::async_runtime::block_on(async {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let receipts = evidence.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let receipts = receipts.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = fixture_request(stream, receipts).await;
                });
            }
        });
        Ok::<_, anyhow::Error>(format!("http://{address}").parse::<url::Url>()?)
    })?;
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(Transport::default())
        .manage(Probe {
            result_path,
            endpoint,
            run: Mutex::new(None),
            evidence,
        })
        .invoke_handler(tauri::generate_handler![
            runtime_gate_begin,
            runtime_gate_tool,
            runtime_gate_finish,
            super::transport::ai_http_start,
            super::transport::ai_http_acknowledge,
            super::transport::ai_http_cancel
        ])
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("recall-runtime-gate.html".into()),
            )
            .visible(false)
            .build()?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(60)).await;
                handle.exit(2);
            });
            Ok(())
        })
        .run(context)?;
    Ok(())
}
