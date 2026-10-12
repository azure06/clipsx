//! The renderer supplies a saved run ID, never provider credentials or arbitrary destinations.
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{ipc::Channel, State};
use tokio::sync::{mpsc, watch};

const PLACEHOLDER: &str = "clipsx-host-transport";
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
const CHUNK_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Deserialize, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Ollama,
    Openai,
    Anthropic,
    Gemini,
    Openrouter,
}

/// Host-only resolved configuration. Not serializable and never returned by IPC.
pub struct RunConnection {
    pub provider: Provider,
    pub base_url: url::Url,
    pub credential: Option<String>,
    pub organization: Option<String>,
    pub project: Option<String>,
    #[cfg(feature = "recall-runtime-probe")]
    pub fixture_destination: Option<url::Url>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpRequest {
    pub run_id: String,
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HttpEvent {
    Headers {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        sequence: u32,
        bytes: Vec<u8>,
    },
    Terminal {
        code: Option<&'static str>,
    },
}

struct ActiveRequest {
    run_id: String,
    cancel: watch::Sender<bool>,
    acknowledge: mpsc::Sender<u32>,
}
#[derive(Default)]
struct Inner {
    runs: HashMap<String, Arc<RunConnection>>,
    requests: HashMap<String, ActiveRequest>,
}
#[derive(Clone, Default)]
pub struct Transport {
    inner: Arc<Mutex<Inner>>,
}

impl Transport {
    pub fn bind_run(&self, run_id: String, connection: RunConnection) -> Result<(), &'static str> {
        validate_base(&connection)?;
        uuid::Uuid::parse_str(&run_id).map_err(|_| "invalid_run")?;
        let mut inner = self.inner.lock().map_err(|_| "transport_unavailable")?;
        if !inner.runs.is_empty() {
            return Err("run_in_progress");
        }
        inner.runs.insert(run_id, Arc::new(connection));
        Ok(())
    }

    pub fn finish_run(&self, run_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.runs.remove(run_id);
            for request in inner.requests.values().filter(|r| r.run_id == run_id) {
                let _ = request.cancel.send(true);
            }
        }
    }

    fn start(
        &self,
        request: HttpRequest,
        send: impl Fn(HttpEvent) -> Result<(), ()> + Send + Sync + 'static,
    ) -> Result<(), &'static str> {
        uuid::Uuid::parse_str(&request.request_id).map_err(|_| "invalid_request")?;
        let mut inner = self.inner.lock().map_err(|_| "transport_unavailable")?;
        let connection = inner
            .runs
            .get(&request.run_id)
            .cloned()
            .ok_or("invalid_run")?;
        let (destination, headers) = validate_request(&connection, &request)?;
        if inner.requests.len() >= 2 {
            return Err("request_limit");
        }
        if inner.requests.contains_key(&request.request_id) {
            return Err("request_conflict");
        }
        let (cancel, cancelled) = watch::channel(false);
        let (acknowledge, acknowledgements) = mpsc::channel(1);
        inner.requests.insert(
            request.request_id.clone(),
            ActiveRequest {
                run_id: request.run_id.clone(),
                cancel,
                acknowledge,
            },
        );
        drop(inner);
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let outcome = stream_request(
                destination,
                headers,
                &request,
                cancelled,
                acknowledgements,
                &send,
            )
            .await;
            let _ = send(HttpEvent::Terminal {
                code: outcome.err(),
            });
            if let Ok(mut inner) = service.inner.lock() {
                inner.requests.remove(&request.request_id);
            }
        });
        Ok(())
    }
}

fn validate_base(connection: &RunConnection) -> Result<(), &'static str> {
    let url = &connection.base_url;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if url.scheme() != "https"
        && !(url.scheme() == "http" && loopback && matches!(connection.provider, Provider::Ollama))
    {
        return Err("insecure_endpoint");
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid_endpoint");
    }
    Ok(())
}

fn validate_request(
    connection: &RunConnection,
    request: &HttpRequest,
) -> Result<(url::Url, reqwest::header::HeaderMap), &'static str> {
    validate_base(connection)?;
    if request.method != "POST" || request.body.len() > MAX_BODY || request.headers.len() > 20 {
        return Err("invalid_request");
    }
    let destination = url::Url::parse(&request.url).map_err(|_| "invalid_destination")?;
    if destination.origin() != connection.base_url.origin()
        || !destination.username().is_empty()
        || destination.password().is_some()
        || destination.fragment().is_some()
    {
        return Err("invalid_destination");
    }
    let prefix = format!("{}/", connection.base_url.path().trim_end_matches('/'));
    let path = destination
        .path()
        .strip_prefix(&prefix)
        .ok_or("invalid_destination")?;
    let allowed = match connection.provider {
        Provider::Openai => path == "responses",
        Provider::Anthropic => path == "messages",
        Provider::Ollama | Provider::Openrouter => path == "chat/completions",
        Provider::Gemini => {
            path.starts_with("models/")
                && path.ends_with(":streamGenerateContent")
                && !path[7..].contains('/')
        }
    };
    if !allowed
        || destination.query_pairs().any(|(name, value)| {
            !(matches!(connection.provider, Provider::Gemini) && name == "alt" && value == "sse")
        })
    {
        return Err("invalid_destination");
    }
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in &request.headers {
        let name = name.to_ascii_lowercase();
        if value.len() > 2048 {
            return Err("invalid_headers");
        }
        match name.as_str() {
            "authorization" if value == &format!("Bearer {PLACEHOLDER}") => {}
            "x-api-key" | "x-goog-api-key" if value == PLACEHOLDER => {}
            "authorization" | "x-api-key" | "x-goog-api-key" => {
                return Err("renderer_authentication_forbidden")
            }
            "content-type" if value == "application/json" => {}
            "anthropic-version" | "anthropic-beta"
                if matches!(connection.provider, Provider::Anthropic) =>
            {
                headers.insert(
                    reqwest::header::HeaderName::from_bytes(name.as_bytes())
                        .map_err(|_| "invalid_headers")?,
                    value.parse().map_err(|_| "invalid_headers")?,
                );
            }
            "user-agent" | "accept" | "x-ai-sdk-version" | "content-type" => {}
            _ => return Err("invalid_headers"),
        }
    }
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    if matches!(connection.provider, Provider::Openai) {
        for (name, value) in [
            ("openai-organization", &connection.organization),
            ("openai-project", &connection.project),
        ] {
            if let Some(value) = value {
                headers.insert(
                    reqwest::header::HeaderName::from_static(name),
                    value.parse().map_err(|_| "invalid_configuration")?,
                );
            }
        }
    }
    if let Some(credential) = &connection.credential {
        let (name, value) = match connection.provider {
            Provider::Anthropic => ("x-api-key", credential.clone()),
            Provider::Gemini => ("x-goog-api-key", credential.clone()),
            _ => ("authorization", format!("Bearer {credential}")),
        };
        headers.insert(
            reqwest::header::HeaderName::from_static(name),
            value.parse().map_err(|_| "invalid_credential")?,
        );
    } else if !matches!(connection.provider, Provider::Ollama) {
        return Err("credential_unresolved");
    }
    #[cfg(feature = "recall-runtime-probe")]
    let destination = if let Some(fixture) = &connection.fixture_destination {
        let mut fixture = fixture.clone();
        fixture.set_path(destination.path());
        fixture.set_query(destination.query());
        fixture
    } else {
        destination
    };
    Ok((destination, headers))
}

async fn stream_request(
    destination: url::Url,
    headers: reqwest::header::HeaderMap,
    request: &HttpRequest,
    mut cancelled: watch::Receiver<bool>,
    mut acknowledgements: mpsc::Receiver<u32>,
    send: &(impl Fn(HttpEvent) -> Result<(), ()> + Send + Sync),
) -> Result<(), &'static str> {
    let operation = async {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            // Local reasoning can stream for several minutes. Keep an idle limit
            // as well as a bounded total duration instead of cutting off active streams.
            .read_timeout(Duration::from_secs(120))
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|_| "connection_unavailable")?;
        let response = client
            .post(destination)
            .headers(headers)
            .body(request.body.clone())
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "request_timeout"
                } else {
                    "connection_unavailable"
                }
            })?;
        let status = response.status();
        if !status.is_success() {
            if matches!(status.as_u16(), 400 | 413 | 422) {
                let mut stream = response.bytes_stream();
                let mut body = Vec::new();
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.map_err(|_| "provider_rejected")?;
                    if body.len() + chunk.len() > 16 * 1024 {
                        break;
                    }
                    body.extend_from_slice(&chunk);
                }
                if context_overflow(&body) {
                    return Err("context_overflow");
                }
                return Err("provider_rejected");
            }
            return Err(match status.as_u16() {
                401 | 403 => "provider_authentication",
                429 => "provider_rate_limited",
                500..=599 => "provider_server_error",
                300..=399 => "redirect_forbidden",
                _ => "provider_rejected",
            });
        }
        let headers = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| HashMap::from([("content-type".to_string(), v.to_string())]))
            .unwrap_or_default();
        send(HttpEvent::Headers {
            status: status.as_u16(),
            headers,
        })
        .map_err(|_| "receiver_unavailable")?;
        let mut bytes = response.bytes_stream();
        let mut total = 0usize;
        let mut sequence = 0u32;
        while let Some(chunk) = bytes.next().await {
            let chunk = chunk.map_err(|error| {
                if error.is_timeout() {
                    "request_timeout"
                } else {
                    "invalid_response"
                }
            })?;
            total = total.checked_add(chunk.len()).ok_or("response_limit")?;
            if total > MAX_RESPONSE {
                return Err("response_limit");
            }
            for chunk in chunk.chunks(CHUNK_BYTES) {
                sequence += 1;
                send(HttpEvent::Chunk {
                    sequence,
                    bytes: chunk.to_vec(),
                })
                .map_err(|_| "receiver_unavailable")?;
                let acknowledged =
                    tokio::time::timeout(Duration::from_secs(30), acknowledgements.recv())
                        .await
                        .map_err(|_| "receiver_timeout")?;
                if acknowledged != Some(sequence) {
                    return Err("invalid_acknowledgement");
                }
            }
        }
        Ok(())
    };
    tokio::select! { result = operation => result, _ = cancelled.changed() => Err("cancelled") }
}

fn context_overflow(body: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else {
        return false;
    };
    let error = value.get("error").unwrap_or(&value);
    let code = error
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if matches!(
        code,
        "context_length_exceeded" | "context_window_exceeded" | "prompt_too_long"
    ) {
        return true;
    }
    let message = error
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    message.contains("maximum context length")
        || message.contains("prompt is too long")
        || message.contains("input token count exceeds")
        || message.contains("exceeds the context window")
}

fn main_webview(webview: &tauri::Webview) -> Result<(), &'static str> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("access_denied")
    }
}
#[tauri::command]
pub fn ai_http_start(
    webview: tauri::Webview,
    state: State<'_, Transport>,
    request: HttpRequest,
    channel: Channel<HttpEvent>,
) -> Result<(), &'static str> {
    main_webview(&webview)?;
    state.start(request, move |event| channel.send(event).map_err(|_| ()))
}
#[tauri::command]
pub fn ai_http_acknowledge(
    webview: tauri::Webview,
    state: State<'_, Transport>,
    request_id: String,
    sequence: u32,
) -> Result<(), &'static str> {
    main_webview(&webview)?;
    let inner = state.inner.lock().map_err(|_| "transport_unavailable")?;
    inner
        .requests
        .get(&request_id)
        .ok_or("request_unavailable")?
        .acknowledge
        .try_send(sequence)
        .map_err(|_| "invalid_acknowledgement")
}
#[tauri::command]
pub fn ai_http_cancel(
    webview: tauri::Webview,
    state: State<'_, Transport>,
    request_id: String,
) -> Result<(), &'static str> {
    main_webview(&webview)?;
    let inner = state.inner.lock().map_err(|_| "transport_unavailable")?;
    if let Some(request) = inner.requests.get(&request_id) {
        let _ = request.cancel.send(true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn connection(provider: Provider) -> RunConnection {
        RunConnection {
            provider,
            base_url: "https://provider.example/v1".parse().unwrap(),
            credential: Some("host-private-key".into()),
            organization: None,
            project: None,
            #[cfg(feature = "recall-runtime-probe")]
            fixture_destination: None,
        }
    }
    fn request() -> HttpRequest {
        HttpRequest {
            run_id: uuid::Uuid::now_v7().to_string(),
            request_id: uuid::Uuid::now_v7().to_string(),
            url: "https://provider.example/v1/responses".into(),
            method: "POST".into(),
            headers: HashMap::from([("authorization".into(), format!("Bearer {PLACEHOLDER}"))]),
            body: "{}".into(),
        }
    }
    #[test]
    fn credentials_are_injected_only_after_destination_validation() {
        let (_, headers) = validate_request(&connection(Provider::Openai), &request()).unwrap();
        assert_eq!(headers["authorization"], "Bearer host-private-key");
        for url in [
            "https://other.example/v1/responses",
            "https://provider.example/v1/files",
            "https://provider.example/v1/responses?key=secret",
            "https://attacker@provider.example/v1/responses",
        ] {
            let mut request = request();
            request.url = url.into();
            assert!(validate_request(&connection(Provider::Openai), &request).is_err());
        }
        let mut request = request();
        request
            .headers
            .insert("authorization".into(), "Bearer renderer-secret".into());
        assert!(matches!(
            validate_request(&connection(Provider::Openai), &request),
            Err("renderer_authentication_forbidden")
        ));
    }
    #[test]
    fn remote_http_is_rejected_and_ollama_loopback_is_allowed() {
        let mut connection = connection(Provider::Openai);
        connection.base_url = "http://127.0.0.1:11434/v1".parse().unwrap();
        assert_eq!(validate_base(&connection), Err("insecure_endpoint"));
        connection.provider = Provider::Ollama;
        assert!(validate_base(&connection).is_ok());
        connection.base_url = "http://remote.example/v1".parse().unwrap();
        assert_eq!(validate_base(&connection), Err("insecure_endpoint"));
    }
}

#[cfg(test)]
mod context_error_tests {
    #[test]
    fn overflow_is_curated_without_echoing_arbitrary_provider_errors() {
        assert!(super::context_overflow(
            br#"{"error":{"code":"context_length_exceeded","message":"private"}}"#
        ));
        assert!(super::context_overflow(
            br#"{"error":{"message":"prompt is too long: private"}}"#
        ));
        assert!(!super::context_overflow(
            br#"{"error":{"message":"invalid temperature"}}"#
        ));
        assert!(!super::context_overflow(b"not json"));
    }
}
