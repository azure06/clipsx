//! Bounded native text embedding adapters. No renderer or implicit provider fallback.
use super::{
    contracts::{
        text_embedding::{TextEmbeddingProvider, TextEmbeddingSpace},
        ProviderDescriptor,
    },
    error::{ProviderError, ProviderResult},
};
use crate::recall::{
    configuration::validate_connection,
    contracts::{AiConnection, AiProviderKind, EmbeddingPresetOptions},
};
use async_trait::async_trait;
use futures::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;

pub struct HostedEmbeddingProvider {
    connection: AiConnection,
    base: url::Url,
    model: String,
    credential: String,
    options: EmbeddingPresetOptions,
}
impl HostedEmbeddingProvider {
    pub fn new(
        connection: AiConnection,
        model: String,
        credential: String,
        options: EmbeddingPresetOptions,
    ) -> ProviderResult<Self> {
        if !matches!(
            connection.provider,
            AiProviderKind::Openai | AiProviderKind::Openrouter | AiProviderKind::Gemini
        ) {
            return Err(ProviderError::Unavailable(
                "unsupported embedding provider".into(),
            ));
        }
        let base = validate_connection(&connection).map_err(|_| {
            ProviderError::InvalidConfiguration("invalid embedding endpoint".into())
        })?;
        if model.contains('/') && connection.provider == AiProviderKind::Gemini
            || model.contains(['?', '#'])
        {
            return Err(ProviderError::InvalidConfiguration(
                "invalid model ID".into(),
            ));
        }
        Ok(Self {
            connection,
            base,
            model,
            credential,
            options,
        })
    }
    async fn embed(&self, inputs: &[String], query: bool) -> ProviderResult<Vec<Vec<f32>>> {
        let mut vectors = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(16) {
            if batch.iter().any(|v| v.is_empty() || v.len() > 2048) {
                return Err(ProviderError::InvalidConfiguration(
                    "embedding input exceeds its limit".into(),
                ));
            }
            let (path, body) = self.request_body(batch, query);
            let result = request_json(
                &self.connection,
                &self
                    .base
                    .join(&path)
                    .map_err(|_| ProviderError::InvalidConfiguration("invalid endpoint".into()))?,
                &self.credential,
                Some(&body),
            )
            .await?;
            vectors.extend(parse_vectors(
                &result,
                batch.len(),
                self.connection.provider == AiProviderKind::Gemini,
                self.options.dimensions.map(|v| v as usize),
            )?);
        }
        Ok(vectors)
    }
    fn request_body(&self, batch: &[String], query: bool) -> (String, Value) {
        let (path, mut body) = if self.connection.provider == AiProviderKind::Gemini {
            let model = format!("models/{}", self.model);
            let requests = batch
                .iter()
                .map(|text| {
                    let text = if self.options.task_policy == "gemini_prefix_v2" {
                        if query {
                            format!("task: search result | query: {text}")
                        } else {
                            format!("title: none | text: {text}")
                        }
                    } else {
                        text.clone()
                    };
                    let mut request = json!({"model":model,"content":{"parts":[{"text":text}]}});
                    if self.options.task_policy == "gemini_retrieval_v1" {
                        request["taskType"] = json!(if query {
                            "RETRIEVAL_QUERY"
                        } else {
                            "RETRIEVAL_DOCUMENT"
                        });
                    }
                    if let Some(dim) = self.options.dimensions {
                        request["outputDimensionality"] = json!(dim);
                    }
                    request
                })
                .collect::<Vec<_>>();
            (
                format!("{model}:batchEmbedContents"),
                json!({"requests":requests}),
            )
        } else {
            let mut body = json!({"model":self.model,"input":batch,"encoding_format":"float"});
            if self.connection.provider == AiProviderKind::Openrouter
                && self.options.task_policy == "retrieval"
            {
                body["input_type"] = json!(if query {
                    "search_query"
                } else {
                    "search_document"
                });
            }
            ("embeddings".into(), body)
        };
        if self.connection.provider != AiProviderKind::Gemini {
            if let Some(dim) = self.options.dimensions {
                body["dimensions"] = json!(dim);
            }
        }
        (path, body)
    }
    fn space(&self, dimensions: usize) -> TextEmbeddingSpace {
        let provider = match self.connection.provider {
            AiProviderKind::Openai => "openai",
            AiProviderKind::Openrouter => "openrouter",
            _ => "gemini",
        };
        let identity = crate::history::sha256(
            serde_json::to_string(&(
                self.base.as_str(),
                &self.model,
                &self.options.task_policy,
                self.options.dimensions,
                "text-utf8-2048-v1",
                "l2-v1",
            ))
            .unwrap()
            .as_bytes(),
        );
        TextEmbeddingSpace {
            provider: ProviderDescriptor {
                provider_id: format!("builtin.embedding.{provider}"),
                provider_version: "1".into(),
                model_id: self.model.clone(),
                model_revision: identity,
            },
            dimensions,
            normalization: "l2".into(),
            distance_metric: "cosine".into(),
        }
    }
}
#[async_trait]
impl TextEmbeddingProvider for HostedEmbeddingProvider {
    fn descriptor_for_dimensions(&self, dimensions: usize) -> Option<TextEmbeddingSpace> {
        Some(self.space(dimensions))
    }
    async fn describe(&self) -> ProviderResult<TextEmbeddingSpace> {
        let query = self
            .embed(&["clipsx embedding capability probe".into()], true)
            .await?;
        let document = self
            .embed(&["clipsx embedding capability probe".into()], false)
            .await?;
        if query[0].len() != document[0].len() {
            return Err(ProviderError::InvalidOutput(
                "query and document dimensions differ".into(),
            ));
        }
        Ok(self.space(query[0].len()))
    }
    async fn embed_documents(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        self.embed(inputs, false).await
    }
    async fn embed_queries(&self, inputs: &[String]) -> ProviderResult<Vec<Vec<f32>>> {
        self.embed(inputs, true).await
    }
}
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
        return Err(ProviderError::Rejected {
            operation: "provider request".into(),
            status: response.status().as_u16(),
            detail: None,
            context_overflow: false,
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
fn allowed_destination(connection: &AiConnection, base: &url::Url, url: &url::Url) -> bool {
    let openrouter_all_models = connection.provider == AiProviderKind::Openrouter
        && url.path() == format!("{}models", base.path())
        && url.query() == Some("output_modalities=all");
    url.origin() == base.origin()
        && url.path().starts_with(base.path())
        && (url.query().is_none() || openrouter_all_models)
        && url.fragment().is_none()
}
fn parse_vectors(
    value: &Value,
    expected: usize,
    gemini: bool,
    dimensions: Option<usize>,
) -> ProviderResult<Vec<Vec<f32>>> {
    let invalid = || ProviderError::InvalidOutput("invalid embedding response".into());
    let rows = value[if gemini { "embeddings" } else { "data" }]
        .as_array()
        .ok_or_else(invalid)?;
    if rows.len() != expected {
        return Err(invalid());
    }
    let mut ordered = vec![None; expected];
    for (position, row) in rows.iter().enumerate() {
        let index = if gemini {
            position
        } else {
            row["index"].as_u64().ok_or_else(invalid)? as usize
        };
        if index >= expected || ordered[index].is_some() {
            return Err(invalid());
        }
        let values = row[if gemini { "values" } else { "embedding" }]
            .as_array()
            .ok_or_else(invalid)?;
        if values.is_empty()
            || values.len() > 65536
            || dimensions.is_some_and(|v| v != values.len())
        {
            return Err(invalid());
        }
        let mut vector = values
            .iter()
            .map(|v| {
                v.as_f64()
                    .map(|v| v as f32)
                    .filter(|v| v.is_finite())
                    .ok_or_else(invalid)
            })
            .collect::<ProviderResult<Vec<_>>>()?;
        let norm = vector
            .iter()
            .map(|v| f64::from(*v).powi(2))
            .sum::<f64>()
            .sqrt();
        if !norm.is_finite() || norm <= f64::EPSILON {
            return Err(invalid());
        }
        for value in &mut vector {
            *value = (f64::from(*value) / norm) as f32;
        }
        ordered[index] = Some(vector);
    }
    ordered.into_iter().map(|v| v.ok_or_else(invalid)).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_openrouter_catalog_accepts_the_all_modalities_query() {
        let router = provider(AiProviderKind::Openrouter, "symmetric");
        let catalog = router.base.join("models?output_modalities=all").unwrap();
        assert!(allowed_destination(
            &router.connection,
            &router.base,
            &catalog
        ));
        for destination in [
            router
                .base
                .join("models?output_modalities=decisions")
                .unwrap(),
            router
                .base
                .join("embeddings?output_modalities=all")
                .unwrap(),
            "https://other.example/v1/models?output_modalities=all"
                .parse()
                .unwrap(),
        ] {
            assert!(!allowed_destination(
                &router.connection,
                &router.base,
                &destination
            ));
        }
        let openai = provider(AiProviderKind::Openai, "symmetric");
        assert!(!allowed_destination(
            &openai.connection,
            &openai.base,
            &openai.base.join("models?output_modalities=all").unwrap()
        ));
    }
    fn provider(kind: AiProviderKind, policy: &str) -> HostedEmbeddingProvider {
        HostedEmbeddingProvider::new(
            AiConnection {
                id: crate::history::new_id(),
                name: "Fixture".into(),
                provider: kind,
                base_url: "https://provider.example/v1".into(),
                enabled: true,
                options: crate::recall::contracts::AiConnectionOptions {
                    organization: None,
                    project: None,
                },
            },
            "fixture-model".into(),
            "private-fixture".into(),
            EmbeddingPresetOptions {
                dimensions: Some(2),
                task_policy: policy.into(),
                hosted_indexing_enabled: true,
            },
        )
        .unwrap()
    }
    #[test]
    fn embedding_protocol_fixtures_bind_tasks_dimensions_and_identity_without_credentials() {
        let openai = provider(AiProviderKind::Openai, "symmetric");
        assert_eq!(
            openai.request_body(&["text".into()], true),
            (
                "embeddings".into(),
                json!({"model":"fixture-model","input":["text"],"encoding_format":"float","dimensions":2})
            )
        );
        let router = provider(AiProviderKind::Openrouter, "retrieval");
        assert_eq!(
            router.request_body(&["text".into()], true).1["input_type"],
            "search_query"
        );
        assert_eq!(
            router.request_body(&["text".into()], false).1["input_type"],
            "search_document"
        );
        let google = provider(AiProviderKind::Gemini, "gemini_retrieval_v1");
        let (path, query) = google.request_body(&["text".into()], true);
        assert_eq!(path, "models/fixture-model:batchEmbedContents");
        assert_eq!(query["requests"][0]["taskType"], "RETRIEVAL_QUERY");
        assert_eq!(query["requests"][0]["outputDimensionality"], 2);
        assert_eq!(
            google.request_body(&["text".into()], false).1["requests"][0]["taskType"],
            "RETRIEVAL_DOCUMENT"
        );
        let prefixes = provider(AiProviderKind::Gemini, "gemini_prefix_v2");
        assert_eq!(
            prefixes.request_body(&["text".into()], true).1["requests"][0]["content"]["parts"][0]
                ["text"],
            "task: search result | query: text"
        );
        assert_eq!(
            prefixes.request_body(&["text".into()], false).1["requests"][0]["content"]["parts"][0]
                ["text"],
            "title: none | text: text"
        );
        assert_ne!(google.space(2), prefixes.space(2));
        let mut rotated = provider(AiProviderKind::Openai, "symmetric");
        rotated.credential = "rotated-fixture".into();
        assert_eq!(openai.space(2), rotated.space(2));
        assert!(!serde_json::to_string(&openai.space(2))
            .unwrap()
            .contains("private-fixture"));
    }
    #[test]
    fn validates_orders_and_normalizes_vectors_without_truncation() {
        let vectors = parse_vectors(
            &json!({"data":[{"index":1,"embedding":[0,2]},{"index":0,"embedding":[3,0]}]}),
            2,
            false,
            Some(2),
        )
        .unwrap();
        assert_eq!(vectors, vec![vec![1., 0.], vec![0., 1.]]);
        assert!(parse_vectors(
            &json!({"data":[{"index":0,"embedding":[0,0]}]}),
            1,
            false,
            None
        )
        .is_err());
        assert!(parse_vectors(
            &json!({"data":[{"index":0,"embedding":[1,0]}]}),
            2,
            false,
            None
        )
        .is_err());
        assert!(
            parse_vectors(&json!({"embeddings":[{"values":[2,0]}]}), 1, true, Some(3)).is_err()
        );
    }
}
