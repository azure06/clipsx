use super::{
    client::{transport_error, OllamaClient},
    models::{is_remote_model, list_models, parse_capabilities},
};
use crate::{
    ai::contracts::{AiCapabilities, AiModelPurpose},
    providers::{error::ProviderError, model_catalog::ModelCapability},
};
use futures::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};

pub(crate) const ENDPOINT: &str = "http://127.0.0.1:11434";
pub(crate) const SMALL_CHAT: &str = "qwen3.5:2b";
pub(crate) const BALANCED_CHAT: &str = "qwen3.5:4b";
const LFM_CHAT: &str = "lfm2.5:8b";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: &'static str,
    pub purpose: AiModelPurpose,
    pub copy_key: &'static str,
    pub download_bytes: u64,
}

const fn candidate(
    id: &'static str,
    purpose: AiModelPurpose,
    copy_key: &'static str,
    megabytes: u64,
) -> Candidate {
    Candidate {
        id,
        purpose,
        copy_key,
        download_bytes: megabytes * 1_000_000,
    }
}

pub(crate) const CANDIDATES: &[Candidate] = {
    use AiModelPurpose::{Chat, Decision, Embedding};
    &[
        candidate(SMALL_CHAT, Chat, "qwenSmall", 3100),
        candidate(BALANCED_CHAT, Chat, "qwenBalanced", 4000),
        candidate(LFM_CHAT, Chat, "lfm", 5200),
        candidate("embeddinggemma:latest", Embedding, "gemma", 622),
        candidate("qwen3-embedding:0.6b", Embedding, "qwenEmbedSmall", 639),
        candidate("qwen3-embedding:4b", Embedding, "qwenEmbedLarge", 2500),
        candidate("tev1:0.8b", Decision, "tev", 1500),
        candidate("d1:3b", Decision, "d1", 3700),
        candidate("pplx-decider-flash:4b", Decision, "decider", 5600),
    ]
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: Stage,
    pub downloaded_bytes: u64,
    pub model: Option<&'static str>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Downloading,
    Verifying,
    Saving,
}

async fn local_details(client: &OllamaClient, model: Candidate) -> Result<Value, ProviderError> {
    let details = client
        .post_bounded(
            "api/show",
            json!({ "model": model.id }),
            Duration::from_secs(8),
            1024 * 1024,
        )
        .await?;
    let required = match model.purpose {
        AiModelPurpose::Chat => ModelCapability::TextGeneration,
        AiModelPurpose::Embedding => ModelCapability::TextEmbedding,
        AiModelPurpose::Decision => ModelCapability::Decision,
        AiModelPurpose::Rerank => return Err(ProviderError::ModelUnavailable),
    };
    if is_remote_model(&details) || !parse_capabilities(&details).contains(&required) {
        return Err(ProviderError::ModelUnavailable);
    }
    Ok(details)
}

pub(crate) async fn installed(client: &OllamaClient) -> Result<Vec<String>, ProviderError> {
    let listed = list_models(client).await?;
    Ok(CANDIDATES
        .iter()
        .filter(|candidate| listed.iter().any(|m| !m.remote && m.id == candidate.id))
        .map(|candidate| candidate.id.to_owned())
        .collect())
}

pub(crate) async fn prepare(
    client: &OllamaClient,
    model: Candidate,
    allow_download: bool,
    progress: &impl Fn(Progress),
) -> anyhow::Result<AiCapabilities> {
    let id = model.id;
    match list_models(client).await?.into_iter().find(|m| m.id == id) {
        Some(listed) if listed.remote => return Err(ProviderError::ModelUnavailable.into()),
        Some(_) => {}
        None if allow_download => {
            progress(Progress {
                stage: Stage::Downloading,
                downloaded_bytes: 0,
                model: Some(id),
            });
            pull(client, id, progress).await?;
        }
        None => return Err(ProviderError::ModelUnavailable.into()),
    }
    progress(Progress {
        stage: Stage::Verifying,
        downloaded_bytes: 0,
        model: Some(id),
    });
    let details = local_details(client, model).await?;
    match model.purpose {
        AiModelPurpose::Chat => verify_chat(client, id, &details).await.map_err(Into::into),
        AiModelPurpose::Embedding => Ok(crate::ai::configuration::unknown_capabilities()),
        AiModelPurpose::Decision => {
            crate::ai::decision::verify_local(client, id).await?;
            Ok(crate::ai::configuration::unknown_capabilities())
        }
        AiModelPurpose::Rerank => Err(ProviderError::ModelUnavailable.into()),
    }
}

async fn verify_chat(
    client: &OllamaClient,
    id: &str,
    details: &Value,
) -> Result<AiCapabilities, ProviderError> {
    let capabilities = details["capabilities"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let supports = |name: &str| {
        capabilities
            .iter()
            .any(|value| value.as_str() == Some(name))
    };
    let mut request = json!({
        "model": id,
        "stream": false,
        "messages": [{ "role": "user", "content": "Reply with the word Ready." }],
        "options": { "num_predict": if id == LFM_CHAT { 1024 } else { 128 }, "num_ctx": 4096 },
    });
    if supports("thinking") && id != LFM_CHAT {
        request["think"] = json!(false);
    }
    let response = client
        .post_bounded("api/chat", request, Duration::from_secs(180), 64 * 1024)
        .await?;
    if is_remote_model(&response)
        || response["done"].as_bool() != Some(true)
        || !response["message"]["content"]
            .as_str()
            .is_some_and(|text| !text.trim().is_empty())
    {
        return Err(ProviderError::InvalidOutput(
            "Ollama did not return a test reply".into(),
        ));
    }
    Ok(AiCapabilities {
        tools: Some(supports("tools")),
        vision: Some(supports("vision")),
        web_search: None,
        source: Some("ollama".into()),
    })
}

async fn pull(
    client: &OllamaClient,
    model: &'static str,
    progress: &impl Fn(Progress),
) -> Result<(), ProviderError> {
    let mut stream = client
        .post_stream(
            "api/pull",
            json!({ "model": model, "stream": true }),
            Duration::from_secs(2 * 60 * 60),
        )
        .await?
        .bytes_stream();
    let mut decoder = PullProgress::default();
    let report = |downloaded_bytes| {
        progress(Progress {
            stage: Stage::Downloading,
            downloaded_bytes,
            model: Some(model),
        })
    };
    while let Some(chunk) = stream.next().await {
        if decoder.push(&chunk.map_err(transport_error)?, &report)? {
            return Ok(());
        }
    }
    if decoder.finish_line(&report)? {
        return Ok(());
    }
    Err(ProviderError::InvalidOutput(
        "Ollama download ended early".into(),
    ))
}

#[derive(Default)]
struct PullProgress {
    pending: Vec<u8>,
    layers: HashMap<String, u64>,
    reported: u64,
}
impl PullProgress {
    fn push(&mut self, chunk: &[u8], progress: &impl Fn(u64)) -> Result<bool, ProviderError> {
        for part in chunk.split_inclusive(|byte| *byte == b'\n') {
            if self.pending.len() + part.len() > 64 * 1024 {
                return Err(ProviderError::InvalidOutput(
                    "Ollama download event is too large".into(),
                ));
            }
            self.pending.extend_from_slice(part);
            if part.ends_with(b"\n") && self.finish_line(progress)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn finish_line(&mut self, progress: &impl Fn(u64)) -> Result<bool, ProviderError> {
        let line = std::mem::take(&mut self.pending);
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(false);
        }
        let value: Value = serde_json::from_slice(&line)
            .map_err(|_| ProviderError::InvalidOutput("Invalid Ollama download event".into()))?;
        if value["error"].is_string() {
            return Err(super::client::response_failure(0, "api/pull", None));
        }
        if let (Some(digest), Some(completed)) =
            (value["digest"].as_str(), value["completed"].as_u64())
        {
            if self.layers.len() < 128 || self.layers.contains_key(digest) {
                let bytes = self.layers.entry(digest.into()).or_default();
                *bytes = (*bytes).max(completed.min(value["total"].as_u64().unwrap_or(completed)));
                let downloaded_bytes = self.layers.values().copied().fold(0, u64::saturating_add);
                if downloaded_bytes.saturating_sub(self.reported) >= 1024 * 1024 {
                    self.reported = downloaded_bytes;
                    progress(downloaded_bytes);
                }
            }
        }
        Ok(value["status"].as_str() == Some("success"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Bytes,
        extract::State,
        routing::{get, post},
        Router,
    };
    use std::{
        cell::Cell,
        sync::{Arc, Mutex},
    };

    #[test]
    fn local_setup_reads_split_events_and_totals_distinct_layers() {
        let mut decoder = PullProgress::default();
        let latest = Cell::new(0);
        let progress = |bytes| latest.set(bytes);
        assert!(!decoder
            .push(b"{\"digest\":\"a\",\"total\":2097152,", &progress)
            .unwrap());
        assert!(!decoder
            .push(
                b"\"completed\":2097152}\n{\"digest\":\"b\",\"completed\":1048576}\n",
                &progress
            )
            .unwrap());
        assert_eq!(latest.get(), 3 * 1024 * 1024);
        assert!(decoder
            .push(b"{\"status\":\"success\"}\n", &progress)
            .unwrap());
    }

    #[test]
    fn local_setup_rejects_stream_errors_and_unbounded_lines() {
        let mut decoder = PullProgress::default();
        assert!(decoder
            .push(b"{\"error\":\"internal detail\"}\n", &|_| {})
            .is_err());
        assert!(decoder.push(&vec![b'x'; 64 * 1024 + 1], &|_| {}).is_err());
    }

    #[tokio::test]
    async fn local_setup_only_downloads_reviewed_models_and_verifies_a_local_reply() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .route(
                "/api/tags",
                get(|| async {
                    json!({"models": [
                        {"name": SMALL_CHAT},
                        {"name": BALANCED_CHAT, "remote_host": "https://fixture.invalid"},
                        {"name": "custom-model:latest"}
                    ]})
                    .to_string()
                }),
            )
            .route(
                "/api/show",
                post(|| async {
                    json!({"capabilities": ["completion", "tools", "thinking"]}).to_string()
                }),
            )
            .route(
                "/api/pull",
                post({
                    let calls = Arc::clone(&calls);
                    move |body: Bytes| async move {
                        let body: Value = serde_json::from_slice(&body).unwrap();
                        calls
                            .lock()
                            .unwrap()
                            .push(body["model"].as_str().unwrap().to_owned());
                        "{\"status\":\"success\"}\n"
                    }
                }),
            )
            .route(
                "/api/chat",
                post(
                    |State(calls): State<Arc<Mutex<Vec<String>>>>, body: Bytes| async move {
                        let body: Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(body["messages"][0]["content"], "Reply with the word Ready.");
                        if body["model"] == LFM_CHAT {
                            assert!(body.get("think").is_none());
                        } else {
                            assert_eq!(body["think"], false);
                        }
                        calls
                            .lock()
                            .unwrap()
                            .push(format!("test:{}", body["model"].as_str().unwrap()));
                        json!({"done": true, "message": {"content": "Ready"}}).to_string()
                    },
                ),
            )
            .with_state(Arc::clone(&calls));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client =
            OllamaClient::new(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let model = |id| *CANDIDATES.iter().find(|model| model.id == id).unwrap();
        assert_eq!(installed(&client).await.unwrap(), vec![SMALL_CHAT]);
        assert!(prepare(&client, model(BALANCED_CHAT), true, &|_| {})
            .await
            .is_err());
        assert!(prepare(&client, model(LFM_CHAT), false, &|_| {})
            .await
            .is_err());
        assert_eq!(
            prepare(&client, model(SMALL_CHAT), false, &|_| {})
                .await
                .unwrap()
                .tools,
            Some(true)
        );
        prepare(&client, model(LFM_CHAT), true, &|_| {})
            .await
            .unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            [
                format!("test:{SMALL_CHAT}"),
                LFM_CHAT.into(),
                format!("test:{LFM_CHAT}")
            ]
        );
        server.abort();
    }
}
