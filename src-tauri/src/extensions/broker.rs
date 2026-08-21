use std::{collections::BTreeMap, net::IpAddr, time::Duration};

use anyhow::{bail, Context, Result};
use futures::StreamExt;
use reqwest::{redirect::Policy, Method};
use serde::{Deserialize, Serialize};
use tokio::net::lookup_host;
use url::Url;

use super::manifest::HttpPermission;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrokerHttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerHttpResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// Host-owned outbound boundary shared by future WASM and custom-UI adapters.
/// It has no ambient package state: callers must first resolve a checksum-bound
/// grant and invocation token, then pass only the matching permission here.
#[allow(dead_code)]
pub async fn https(
    permission: &HttpPermission,
    request: BrokerHttpRequest,
    injected_headers: BTreeMap<String, String>,
) -> Result<BrokerHttpResponse> {
    let url = Url::parse(&request.url).context("extension HTTPS URL is invalid")?;
    validate_request(permission, &request, &url)?;
    let host = url.host_str().context("extension HTTPS URL has no host")?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = lookup_host((host, port))
        .await
        .context("extension HTTPS destination could not be resolved")?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| blocked_ip(address.ip())) {
        bail!("extension HTTPS destination resolves to a blocked network");
    }

    let mut builder = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_millis(permission.timeout_ms));
    for address in &addresses {
        builder = builder.resolve(host, *address);
    }
    let client = builder.build()?;
    let method = Method::from_bytes(request.method.as_bytes())?;
    let mut outgoing = client.request(method, url);
    for (name, value) in request.headers {
        outgoing = outgoing.header(name, value);
    }
    for (name, value) in injected_headers {
        outgoing = outgoing.header(name, value);
    }
    let response = outgoing.body(request.body).send().await?;
    if response.status().is_redirection() {
        bail!("extension HTTPS redirects are disabled");
    }
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if body.len().saturating_add(chunk.len()) > permission.max_response_bytes as usize {
            bail!("extension HTTPS response exceeds its declared limit");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(BrokerHttpResponse {
        status,
        content_type,
        body,
    })
}

fn validate_request(
    permission: &HttpPermission,
    request: &BrokerHttpRequest,
    url: &Url,
) -> Result<()> {
    let declared = Url::parse(&permission.origin)?;
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
        || url.origin() != declared.origin()
        || !permission
            .methods
            .iter()
            .any(|method| method == &request.method)
        || request.body.len() > permission.max_request_bytes as usize
        || !permission.path_patterns.iter().any(|pattern| {
            pattern
                .strip_suffix('*')
                .map_or(url.path() == pattern, |prefix| {
                    url.path().starts_with(prefix)
                })
        })
    {
        bail!("extension HTTPS request is outside its declared permission");
    }
    for name in request.headers.keys() {
        let lower = name.to_ascii_lowercase();
        if !matches!(lower.as_str(), "accept" | "content-type") {
            bail!("extension HTTPS request contains an unsupported header");
        }
    }
    Ok(())
}

fn blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_multicast()
                || value.is_broadcast()
                || value.is_documentation()
                || value.is_unspecified()
                || value.octets()[0] == 0
        }
        IpAddr::V6(value) => {
            value.is_loopback()
                || value.is_multicast()
                || value.is_unspecified()
                || value.is_unique_local()
                || value.is_unicast_link_local()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permission() -> HttpPermission {
        HttpPermission {
            origin: "https://api.example.com".into(),
            path_patterns: vec!["/v1/*".into()],
            methods: vec!["POST".into()],
            max_request_bytes: 1024,
            max_response_bytes: 2048,
            timeout_ms: 1_000,
        }
    }

    #[test]
    fn request_must_match_origin_path_method_and_headers() {
        let request = BrokerHttpRequest {
            url: "https://api.example.com/v1/generate".into(),
            method: "POST".into(),
            headers: BTreeMap::from([("content-type".into(), "application/json".into())]),
            body: b"{}".to_vec(),
        };
        assert!(
            validate_request(&permission(), &request, &Url::parse(&request.url).unwrap()).is_ok()
        );
        let mut invalid = request.clone();
        invalid.url = "https://evil.example/v1/generate".into();
        assert!(
            validate_request(&permission(), &invalid, &Url::parse(&invalid.url).unwrap()).is_err()
        );
        invalid.url = "https://api.example.com/private".into();
        assert!(
            validate_request(&permission(), &invalid, &Url::parse(&invalid.url).unwrap()).is_err()
        );
    }

    #[test]
    fn private_and_metadata_networks_are_blocked() {
        for value in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fe80::1"] {
            assert!(blocked_ip(value.parse().unwrap()));
        }
        assert!(!blocked_ip("1.1.1.1".parse().unwrap()));
    }
}
