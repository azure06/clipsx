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
            .map_err(transport_error)?;
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

    pub async fn get_bounded(
        &self,
        path: &str,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> ProviderResult<serde_json::Value> {
        let response = self
            .client
            .get(self.api(path)?)
            .timeout(timeout)
            .send()
            .await
            .map_err(transport_error)?;
        response_json_bounded(response, path, max_response_bytes).await
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
            .map_err(transport_error)?;
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
            .map_err(transport_error)?;
        response_json_bounded(response, path, max_response_bytes).await
    }

    pub async fn post_stream(
        &self,
        path: &str,
        body: serde_json::Value,
        timeout: Duration,
    ) -> ProviderResult<reqwest::Response> {
        let response = self
            .client
            .post(self.api(path)?)
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(transport_error)?;
        if response.status().is_success() {
            Ok(response)
        } else {
            Err(response_error(response, path).await)
        }
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
        let chunk = chunk.map_err(transport_error)?;
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
    if !response.status().is_success() {
        return Err(response_error(response, operation).await);
    }
    response
        .json()
        .await
        .map_err(|error| ProviderError::InvalidOutput(error.to_string()))
}

async fn response_error(response: reqwest::Response, operation: &str) -> ProviderError {
    if response.status().is_redirection() {
        return ProviderError::Unavailable("Ollama redirect rejected".into());
    }
    let status = response.status().as_u16();
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => return transport_error(error),
        };
        if body.len().saturating_add(chunk.len()) > 16 * 1024 {
            return ProviderError::InvalidOutput(
                "provider error response exceeds host limit".into(),
            );
        }
        body.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice::<serde_json::Value>(&body).ok();
    let detail = value
        .as_ref()
        .and_then(|value| value["error"].as_str())
        .or_else(|| std::str::from_utf8(&body).ok());
    response_failure(status, operation, detail)
}

pub(super) fn transport_error(error: reqwest::Error) -> ProviderError {
    if error.is_timeout() {
        ProviderError::Timeout
    } else {
        ProviderError::Unavailable("provider connection failed".into())
    }
}

// The body is inspected only for recognized categories, never returned or logged.
pub(super) fn response_failure(
    status: u16,
    operation: &str,
    detail: Option<&str>,
) -> ProviderError {
    let detail = detail.unwrap_or_default().to_ascii_lowercase();
    let model_operation = matches!(operation, "api/generate" | "api/chat" | "api/embed");
    if model_operation
        && (status == 404 || status == 0)
        && detail.contains("model")
        && (detail.contains("not found")
            || detail.contains("does not exist")
            || detail.contains("not available"))
    {
        return ProviderError::ModelUnavailable;
    }
    let context_overflow = model_operation
        && matches!(status, 0 | 400 | 413)
        && (detail.contains("context length")
            || detail.contains("context window")
            || detail.contains("input length exceeds")
            || detail.contains("input is too long"));
    ProviderError::Rejected {
        operation: format!("/{}", operation.trim_start_matches('/')),
        status,
        detail: None,
        context_overflow,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::{FailureCode, Recovery};

    #[test]
    fn response_errors_use_reviewed_categories_without_raw_bodies() {
        let cases = [
            (
                400,
                "input length exceeds the context length secret",
                FailureCode::ContextOverflow,
                Recovery::Stop,
            ),
            (
                404,
                "model 'secret' not found",
                FailureCode::ModelUnavailable,
                Recovery::Wait,
            ),
            (
                429,
                "secret",
                FailureCode::ProviderRateLimited,
                Recovery::Retry,
            ),
            (
                503,
                "secret",
                FailureCode::ProviderServerError,
                Recovery::Retry,
            ),
            (
                400,
                "unknown secret",
                FailureCode::ProviderRejected,
                Recovery::Stop,
            ),
        ];
        for (status, detail, code, recovery) in cases {
            let error = response_failure(status, "api/generate", Some(detail));
            assert_eq!(error.failure().code, code);
            assert_eq!(error.failure().recovery, recovery);
            assert!(!format!("{error:?}").contains("secret"));
            assert!(!error.to_string().contains("secret"));
        }
        assert!(
            !response_failure(400, "api/generate", Some("large clipboard")).is_context_overflow()
        );
        assert!(
            response_failure(400, "api/embed", Some("context length exceeded"))
                .is_context_overflow()
        );
    }

    #[tokio::test]
    async fn transport_timeout_and_broken_connection_have_distinct_reasons() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (_connection, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_millis(200)).await;
        });
        let error = Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}"))
            .timeout(Duration::from_millis(50))
            .send()
            .await
            .unwrap_err();
        assert_eq!(
            transport_error(error).failure().code,
            FailureCode::ProviderTimeout
        );
        server.abort();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (connection, _) = listener.accept().await.unwrap();
            drop(connection);
        });
        let error = Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}"))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .unwrap_err();
        server.await.unwrap();
        assert_eq!(
            transport_error(error).failure().code,
            FailureCode::ConnectionUnavailable
        );
    }
}
