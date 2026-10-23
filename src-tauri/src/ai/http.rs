//! Restricted host HTTP shared by model discovery, generation, embeddings, and web research.
use super::{
    configuration::validate_connection,
    contracts::{AiConnection, AiProviderKind},
};
use crate::providers::error::{ProviderError, ProviderResult};
use futures::StreamExt;
use serde_json::Value;
use std::time::Duration;

pub(crate) async fn request_json(
    connection: &AiConnection,
    url: &url::Url,
    credential: &str,
    body: Option<&Value>,
) -> ProviderResult<Value> {
    let base = validate_connection(connection)
        .map_err(|_| ProviderError::InvalidConfiguration("invalid endpoint".into()))?;
    if !allowed_destination(connection, &base, url) {
        return Err(ProviderError::InvalidConfiguration(
            "invalid destination".into(),
        ));
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| ProviderError::Unavailable("network unavailable".into()))?;
    let mut request = if let Some(body) = body {
        client.post(url.clone()).json(body)
    } else {
        client.get(url.clone())
    };
    request = match connection.provider {
        AiProviderKind::Anthropic => request
            .header("x-api-key", credential)
            .header("anthropic-version", "2023-06-01"),
        AiProviderKind::Gemini => request.header("x-goog-api-key", credential),
        _ => request.bearer_auth(credential),
    };
    if let Some(organization) = &connection.options.organization {
        request = request.header("OpenAI-Organization", organization);
    }
    if let Some(project) = &connection.options.project {
        request = request.header("OpenAI-Project", project);
    }
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            ProviderError::Timeout
        } else {
            ProviderError::Unavailable("provider connection failed".into())
        }
    })?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk
                .map_err(|_| ProviderError::Unavailable("provider response interrupted".into()))?;
            if body.len().saturating_add(chunk.len()) > 16 * 1024 {
                break;
            }
            body.extend_from_slice(&chunk);
        }
        return Err(ProviderError::Rejected {
            operation: "provider request".into(),
            status,
            detail: (connection.provider == AiProviderKind::Gemini)
                .then(|| gemini_rejection_reason(&body))
                .flatten()
                .map(str::to_owned),
            context_overflow: matches!(status, 400 | 413 | 422) && context_overflow(&body),
        });
    }
    let mut stream = response.bytes_stream();
    let mut bytes = vec![];
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|_| ProviderError::Unavailable("provider response interrupted".into()))?;
        if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
            return Err(ProviderError::InvalidOutput(
                "provider response exceeds its limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| ProviderError::InvalidOutput("invalid provider response".into()))
}

/// Inspect only bounded, recognized rejection categories. Never expose provider text.
pub(crate) fn context_overflow(body: &[u8]) -> bool {
    if body.len() > 16 * 1024 {
        return false;
    }
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return false;
    };
    let error = value.get("error").unwrap_or(&value);
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if matches!(
        code,
        "context_length_exceeded"
            | "context_window_exceeded"
            | "prompt_too_long"
            | "input_too_long"
    ) {
        return true;
    }
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    message.contains("maximum context length")
        || message.contains("prompt is too long")
        || message.contains("input token count exceeds")
        || message.contains("exceeds the maximum number of tokens allowed")
        || message.contains("exceeds the context window")
        || message.contains("input length exceeds the context length")
        || message.contains("input exceeds the maximum number of tokens")
}

// Only known provider codes cross into connection-test diagnostics. Provider messages
// may contain credential or request text and must never be returned to the renderer.
fn gemini_rejection_reason(body: &[u8]) -> Option<&'static str> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let error = &value["error"];
    let reasons = error["details"].as_array();
    for reason in reasons.into_iter().flatten() {
        match reason["reason"].as_str().unwrap_or_default() {
            "API_KEY_INVALID" => return Some("api_key_invalid"),
            "SERVICE_DISABLED" => return Some("service_disabled"),
            "API_KEY_SERVICE_BLOCKED" => return Some("api_key_service_blocked"),
            "QUOTA_EXCEEDED" => return Some("quota_exceeded"),
            _ => {}
        }
    }
    match error["status"].as_str()? {
        "RESOURCE_EXHAUSTED" => Some("resource_exhausted"),
        "PERMISSION_DENIED" => Some("permission_denied"),
        "FAILED_PRECONDITION" => Some("failed_precondition"),
        "UNAUTHENTICATED" => Some("unauthenticated"),
        "INVALID_ARGUMENT" => Some("invalid_argument"),
        "NOT_FOUND" => Some("not_found"),
        _ => None,
    }
}

pub(crate) fn allowed_destination(
    connection: &AiConnection,
    base: &url::Url,
    url: &url::Url,
) -> bool {
    let openrouter_all_models = connection.provider == AiProviderKind::Openrouter
        && url.path() == format!("{}models", base.path())
        && url.query() == Some("output_modalities=all");
    let decisions_path = base
        .path()
        .trim_end_matches('/')
        .strip_suffix("/v1")
        .map(|prefix| format!("{prefix}/alpha/decisions"));
    let openrouter_decision = connection.provider == AiProviderKind::Openrouter
        && decisions_path.as_deref() == Some(url.path())
        && url.query().is_none();
    url.origin() == base.origin()
        && (url.path().starts_with(base.path()) || openrouter_decision)
        && (url.query().is_none() || openrouter_all_models)
        && url.fragment().is_none()
}

#[cfg(test)]
mod rejection_tests {
    use super::gemini_rejection_reason;

    #[test]
    fn embedding_overflow_is_recognized_without_treating_other_errors_as_overflow() {
        for body in [
            br#"{"error":{"code":"context_length_exceeded","message":"private text"}}"#.as_slice(),
            br#"{"error":{"message":"Input token count exceeds the maximum allowed"}}"#.as_slice(),
            br#"{"error":{"status":"INVALID_ARGUMENT","message":"The input token count (9000) exceeds the maximum number of tokens allowed (8192)."}}"#.as_slice(),
            br#"{"error":"input length exceeds the context length"}"#.as_slice(),
        ] {
            assert!(super::context_overflow(body));
        }
        for body in [
            br#"{"error":{"code":"invalid_api_key","message":"bad credentials"}}"#.as_slice(),
            br#"{"error":{"message":"quota exceeded"}}"#.as_slice(),
            b"not json".as_slice(),
        ] {
            assert!(!super::context_overflow(body));
        }
        assert!(!super::context_overflow(&vec![b'x'; 16385]));
    }

    #[test]
    fn decision_route_is_exact_and_never_changes_the_credential_origin() {
        use super::*;
        let connection = AiConnection {
            id: "00000000-0000-4000-8000-000000000001".into(),
            name: "Fixture".into(),
            provider: AiProviderKind::Openrouter,
            base_url: "https://provider.example/api/v1/".into(),
            enabled: true,
            options: crate::ai::contracts::AiConnectionOptions {
                organization: None,
                project: None,
            },
        };
        let base = url::Url::parse(&connection.base_url).unwrap();
        assert!(allowed_destination(
            &connection,
            &base,
            &url::Url::parse("https://provider.example/api/alpha/decisions").unwrap()
        ));
        for path in [
            "https://other.example/api/alpha/decisions",
            "https://provider.example/api/alpha/other",
            "https://provider.example/api/alpha/decisions?key=private",
        ] {
            assert!(!allowed_destination(
                &connection,
                &base,
                &url::Url::parse(path).unwrap()
            ));
        }
    }

    #[test]
    fn gemini_reasons_are_allowlisted_without_returning_provider_messages() {
        let body = br#"{"error":{"status":"RESOURCE_EXHAUSTED","message":"private-key and prompt","details":[{"reason":"QUOTA_EXCEEDED"}]}}"#;
        assert_eq!(gemini_rejection_reason(body), Some("quota_exceeded"));
        assert_eq!(
            gemini_rejection_reason(
                br#"{"error":{"status":"PERMISSION_DENIED","message":"private-key"}}"#
            ),
            Some("permission_denied")
        );
        assert_eq!(
            gemini_rejection_reason(br#"{"error":{"status":"SECRET","message":"private-key"}}"#),
            None
        );
    }
}
