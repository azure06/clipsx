use crate::providers::error::{ProviderError, ProviderResult};
use futures::StreamExt;
use reqwest::{redirect::Policy, Client};
use std::{net::IpAddr, time::Duration};
use url::Url;

#[derive(Clone)]
pub struct OllamaClient {
    endpoint: Url,
    client: Client,
}

impl OllamaClient {
    pub fn new(endpoint: &str) -> ProviderResult<Self> {
        let endpoint = validate_endpoint(endpoint)?;
        let client = Client::builder()
            .redirect(Policy::none())
            .build()
            .map_err(|error| ProviderError::Unavailable(error.to_string()))?;
        Ok(Self { endpoint, client })
    }

    pub fn endpoint(&self) -> &Url {
        &self.endpoint
    }

    fn api(&self, path: &str) -> ProviderResult<Url> {
        self.endpoint
            .join(path)
            .map_err(|error| ProviderError::InvalidConfiguration(error.to_string()))
    }

    pub async fn get(&self, path: &str, timeout: Duration) -> ProviderResult<serde_json::Value> {
        let response = self
            .client
            .get(self.api(path)?)
            .timeout(timeout)
            .send()
            .await
            .map_err(|error| ProviderError::Unavailable(error.to_string()))?;
        response_json(response, path).await
    }

    pub async fn post(
        &self,
        path: &str,
        body: serde_json::Value,
        timeout: Duration,
    ) -> ProviderResult<serde_json::Value> {
        let response = self
            .client
            .post(self.api(path)?)
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(|error| ProviderError::Unavailable(error.to_string()))?;
        response_json(response, path).await
    }

    pub async fn post_bounded(
        &self,
        path: &str,
        body: serde_json::Value,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> ProviderResult<serde_json::Value> {
        let response = self
            .client
            .post(self.api(path)?)
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(|error| ProviderError::Unavailable(error.to_string()))?;
        response_json_bounded(response, path, max_response_bytes).await
    }
}

async fn response_json_bounded(
    response: reqwest::Response,
    operation: &str,
    max_response_bytes: usize,
) -> ProviderResult<serde_json::Value> {
    if !response.status().is_success() {
        return response_json(response, operation).await;
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| ProviderError::Unavailable(error.to_string()))?;
        if bytes.len().saturating_add(chunk.len()) > max_response_bytes {
            return Err(ProviderError::InvalidOutput(
                "provider response exceeds its host limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|error| ProviderError::InvalidOutput(error.to_string()))
}

async fn response_json(
    response: reqwest::Response,
    operation: &str,
) -> ProviderResult<serde_json::Value> {
    if response.status().is_redirection() {
        return Err(ProviderError::Unavailable(
            "Ollama redirect rejected".into(),
        ));
    }
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"].as_str().map(str::to_owned))
            .or_else(|| (!body.trim().is_empty()).then(|| body.trim().to_owned()))
            .map(|value| value.chars().take(300).collect::<String>());
        let context_overflow = status == 400
            && operation == "api/embed"
            && detail.as_deref().is_some_and(|value| {
                let value = value.to_ascii_lowercase();
                value.contains("context length")
                    || value.contains("context window")
                    || value.contains("too long")
            });
        return Err(ProviderError::Rejected {
            operation: format!("/{}", operation.trim_start_matches('/')),
            status,
            detail,
            context_overflow,
        });
    }
    response
        .json()
        .await
        .map_err(|error| ProviderError::InvalidOutput(error.to_string()))
}

fn validate_endpoint(raw: &str) -> ProviderResult<Url> {
    let mut url =
        Url::parse(raw).map_err(|error| ProviderError::InvalidConfiguration(error.to_string()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(ProviderError::InvalidConfiguration(
            "invalid Ollama endpoint".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| ProviderError::InvalidConfiguration("endpoint host required".into()))?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
    if !loopback {
        return Err(ProviderError::InvalidConfiguration(
            "remote_consent_required".into(),
        ));
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}
