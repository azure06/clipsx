use super::client::OllamaClient;
use crate::providers::{
    error::{ProviderError, ProviderResult},
    model_catalog::{ModelCapability, ModelDescriptor},
};
use futures::{stream, StreamExt};
use std::time::Duration;

const MAX_MODELS: usize = 128;
const INSPECTION_CONCURRENCY: usize = 4;
const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_MODEL_DETAILS_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone)]
struct ListedModel {
    id: String,
    digest: Option<String>,
    size: Option<u64>,
}

pub async fn discover_models(endpoint: &str) -> ProviderResult<Vec<ModelDescriptor>> {
    let client = OllamaClient::new(endpoint)?;
    let listed = list_models(&client).await?;
    let mut models = stream::iter(listed.into_iter().map(|listed| {
        let client = client.clone();
        async move { inspect_listed_model(&client, listed).await }
    }))
    .buffer_unordered(INSPECTION_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    models.sort_by_key(|model| model.id.to_lowercase());
    Ok(models)
}

pub async fn inspect_model(endpoint: &str, model: &str) -> ProviderResult<ModelDescriptor> {
    if model.trim().is_empty() || model.len() > 256 {
        return Err(ProviderError::InvalidConfiguration(
            "model name is invalid".into(),
        ));
    }
    let client = OllamaClient::new(endpoint)?;
    let listed = list_models(&client)
        .await?
        .into_iter()
        .find(|candidate| candidate.id == model)
        .ok_or_else(|| {
            ProviderError::InvalidConfiguration(format!("{model} is not installed in Ollama"))
        })?;
    let descriptor = inspect_listed_model(&client, listed).await;
    if let Some(diagnostic) = &descriptor.inspection_diagnostic {
        return Err(ProviderError::InvalidOutput(diagnostic.clone()));
    }
    Ok(descriptor)
}

async fn list_models(client: &OllamaClient) -> ProviderResult<Vec<ListedModel>> {
    let response = client
        .get_bounded("api/tags", Duration::from_secs(10), MAX_CATALOG_BYTES)
        .await?;
    let models = response["models"]
        .as_array()
        .ok_or_else(|| ProviderError::InvalidOutput("Ollama returned no model list".into()))?;
    if models.len() > MAX_MODELS {
        return Err(ProviderError::InvalidOutput(format!(
            "Ollama model list exceeds the {MAX_MODELS}-model limit"
        )));
    }
    let mut listed = models
        .iter()
        .filter_map(|model| {
            let id = model["name"]
                .as_str()
                .or_else(|| model["model"].as_str())?
                .to_owned();
            Some(ListedModel {
                id,
                digest: model["digest"].as_str().map(str::to_owned),
                size: model["size"].as_u64(),
            })
        })
        .collect::<Vec<_>>();
    listed.sort_by(|left, right| left.id.cmp(&right.id));
    listed.dedup_by(|left, right| left.id == right.id);
    Ok(listed)
}

async fn inspect_listed_model(client: &OllamaClient, listed: ListedModel) -> ModelDescriptor {
    let result = client
        .post_bounded(
            "api/show",
            serde_json::json!({"model": listed.id, "verbose": false}),
            Duration::from_secs(10),
            MAX_MODEL_DETAILS_BYTES,
        )
        .await;
    match result {
        Ok(value) => {
            let capabilities = parse_capabilities(&value);
            let inspection_diagnostic = capabilities.is_empty().then(|| {
                "Ollama did not report embedding or completion support for this model".into()
            });
            ModelDescriptor {
                id: listed.id,
                digest: listed.digest,
                size: listed.size,
                capabilities,
                inspection_diagnostic,
            }
        }
        Err(error) => ModelDescriptor {
            id: listed.id,
            digest: listed.digest,
            size: listed.size,
            capabilities: Vec::new(),
            inspection_diagnostic: Some(error.to_string()),
        },
    }
}

fn parse_capabilities(value: &serde_json::Value) -> Vec<ModelCapability> {
    let mut capabilities = Vec::new();
    for capability in value["capabilities"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(serde_json::Value::as_str)
    {
        match capability {
            "embedding" if !capabilities.contains(&ModelCapability::TextEmbedding) => {
                capabilities.push(ModelCapability::TextEmbedding)
            }
            "completion" if !capabilities.contains(&ModelCapability::TextGeneration) => {
                capabilities.push(ModelCapability::TextGeneration)
            }
            _ => {}
        }
    }
    capabilities
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Arc};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
    };

    #[test]
    fn classifies_supported_capabilities_without_guessing() {
        let capabilities = parse_capabilities(&serde_json::json!({
            "capabilities": ["completion", "embedding", "vision", "completion"]
        }));
        assert_eq!(
            capabilities,
            vec![
                ModelCapability::TextGeneration,
                ModelCapability::TextEmbedding
            ]
        );
        assert!(parse_capabilities(&serde_json::json!({})).is_empty());
    }

    #[tokio::test]
    async fn discovers_each_model_capability_and_keeps_partial_failures() {
        let details = HashMap::from([
            (
                "embed",
                Some(serde_json::json!({"capabilities": ["embedding"]})),
            ),
            (
                "generate",
                Some(serde_json::json!({"capabilities": ["completion"]})),
            ),
            (
                "both",
                Some(serde_json::json!({"capabilities": ["embedding", "completion"]})),
            ),
            ("broken", None),
        ]);
        let (endpoint, server) = model_server(details).await;

        let models = discover_models(&endpoint).await.unwrap();
        server.await.unwrap();

        assert_eq!(models.len(), 4);
        assert!(models
            .iter()
            .find(|model| model.id == "embed")
            .unwrap()
            .supports(ModelCapability::TextEmbedding));
        let both = models.iter().find(|model| model.id == "both").unwrap();
        assert!(both.supports(ModelCapability::TextEmbedding));
        assert!(both.supports(ModelCapability::TextGeneration));
        let broken = models.iter().find(|model| model.id == "broken").unwrap();
        assert!(broken.capabilities.is_empty());
        assert!(broken.inspection_diagnostic.is_some());
    }

    async fn model_server(
        details: HashMap<&'static str, Option<serde_json::Value>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let details = Arc::new(details);
        let requests = details.len() + 1;
        let server = tokio::spawn(async move {
            let mut tasks = Vec::new();
            for _ in 0..requests {
                let (socket, _) = listener.accept().await.unwrap();
                let details = details.clone();
                tasks.push(tokio::spawn(async move {
                    respond(socket, &details).await;
                }));
            }
            for task in tasks {
                task.await.unwrap();
            }
        });
        (endpoint, server)
    }

    async fn respond(
        mut socket: TcpStream,
        details: &HashMap<&'static str, Option<serde_json::Value>>,
    ) {
        let mut request = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let read = socket.read(&mut chunk).await.unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            if request.len() >= header_end + 4 + content_length {
                break;
            }
        }
        let request = String::from_utf8_lossy(&request);
        let (status, body) = if request.starts_with("GET /api/tags ") {
            let models = details
                .keys()
                .map(|name| {
                    serde_json::json!({
                        "name": name,
                        "digest": format!("digest-{name}"),
                        "size": 1024
                    })
                })
                .collect::<Vec<_>>();
            ("200 OK", serde_json::json!({"models": models}).to_string())
        } else {
            let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
            let model = serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|value| value["model"].as_str().map(str::to_owned))
                .unwrap();
            match details.get(model.as_str()).and_then(Option::as_ref) {
                Some(value) => ("200 OK", value.to_string()),
                None => (
                    "500 Internal Server Error",
                    "{\"error\":\"inspection failed\"}".into(),
                ),
            }
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    }
}
