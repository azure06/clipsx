//! Generic transform-result cache and preview boundary. Content converters are
//! supplied by optional extension packages.
use crate::{
    contracts::{ImageSource, OcrPresentation, RenderModel},
    history::{new_id, sha256, CapturedPayload, CapturedRepresentation, HistoryRepository},
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_OUTPUT_BYTES: usize = 10_485_760;
const MAX_RESULTS: usize = 64;
const MAX_CACHE_BYTES: usize = 67_108_864;
const RESULT_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformerDescriptor {
    pub id: String,
    pub version: String,
    pub label: String,
    pub parameter_schema: Value,
    pub input_limit_bytes: usize,
    pub timeout_ms: u64,
    pub execution: String,
    pub consent_required: bool,
    pub http_origins: Vec<String>,
    pub providers: Vec<String>,
    pub expose_in_menu: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOutputDescriptor {
    pub canonical_mime_type: Option<String>,
    pub byte_length: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformPreview {
    pub result_id: String,
    pub expires_at: i64,
    pub transformer_id: String,
    pub transformer_version: String,
    pub source_id: String,
    pub outputs: Vec<TransformOutputDescriptor>,
    pub model: RenderModel,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransformPreferences {
    pub favorite_transformer_ids: Vec<String>,
}

pub fn descriptors() -> Vec<TransformerDescriptor> {
    Vec::new()
}

pub fn descriptors_for(
    _input: &CapturedRepresentation,
    _presentation_kind: Option<&str>,
) -> Vec<TransformerDescriptor> {
    Vec::new()
}

#[derive(Clone)]
struct CachedResult {
    preview: TransformPreview,
    source_clip_id: String,
    parameter_sha256: String,
    outputs: Vec<CapturedRepresentation>,
    created: Instant,
}
#[derive(Default)]
struct Cache {
    values: HashMap<String, CachedResult>,
    lru: VecDeque<String>,
    bytes: usize,
}
pub struct TransformService {
    cache: Mutex<Cache>,
}
impl Default for TransformService {
    fn default() -> Self {
        Self {
            cache: Mutex::new(Cache::default()),
        }
    }
}
impl TransformService {
    pub fn cache_external(
        &self,
        source_clip_id: String,
        transformer_id: String,
        transformer_version: String,
        source_id: String,
        parameters: Value,
        outputs: Vec<CapturedRepresentation>,
    ) -> Result<TransformPreview> {
        let total: usize = outputs.iter().map(payload_bytes).sum();
        if outputs.is_empty() || total > MAX_OUTPUT_BYTES {
            bail!("transform output exceeds 10 MiB")
        }
        let result_id = new_id();
        let preview = TransformPreview {
            result_id: result_id.clone(),
            expires_at: crate::history::now_ms() + RESULT_TTL.as_millis() as i64,
            transformer_id,
            transformer_version,
            source_id,
            outputs: outputs
                .iter()
                .map(|item| TransformOutputDescriptor {
                    canonical_mime_type: item.canonical_mime_type.clone(),
                    byte_length: payload_bytes(item),
                })
                .collect(),
            model: preview_model(&outputs, &result_id),
        };
        let cached = CachedResult {
            preview: preview.clone(),
            source_clip_id,
            parameter_sha256: sha256(&serde_json::to_vec(&parameters)?),
            outputs,
            created: Instant::now(),
        };
        let mut cache = self.cache.lock().expect("transform cache poisoned");
        cache.prune();
        cache.bytes += total;
        cache.lru.push_back(result_id.clone());
        cache.values.insert(result_id, cached);
        cache.prune();
        Ok(preview)
    }
    pub async fn list_source(
        &self,
        repo: &HistoryRepository,
        clip_id: &str,
        source_id: &str,
        presentation_kind: &str,
    ) -> Result<Vec<TransformerDescriptor>> {
        let (source, _) = repo.source_representation(clip_id, source_id).await?;
        Ok(descriptors_for(&source, Some(presentation_kind)))
    }
    pub async fn preview(
        &self,
        _repo: &HistoryRepository,
        _clip_id: &str,
        _transformer_id: &str,
        _source_id: &str,
        _parameters: Value,
    ) -> Result<TransformPreview> {
        bail!("built-in content transformers have moved to extension packages")
    }
    pub fn transformed(&self, result_id: &str) -> Result<Vec<CapturedRepresentation>> {
        Ok(self.get(result_id)?.outputs)
    }
    pub fn image_output(&self, result_id: &str, output_index: usize) -> Result<(Vec<u8>, String)> {
        let result = self.get(result_id)?;
        let output = result
            .outputs
            .get(output_index)
            .context("transform output not found")?;
        let mime = output
            .canonical_mime_type
            .as_deref()
            .filter(|mime| previewable_raster_mime(mime))
            .context("transform output is not a previewable raster image")?;
        let CapturedPayload::Binary(bytes) = &output.payload else {
            bail!("transform output is not binary")
        };
        Ok((bytes.clone(), mime.into()))
    }
    pub fn saved_metadata(&self, result_id: &str) -> Result<(TransformPreview, String, String)> {
        let value = self.get(result_id)?;
        Ok((value.preview, value.source_clip_id, value.parameter_sha256))
    }
    fn get(&self, result_id: &str) -> Result<CachedResult> {
        let mut cache = self.cache.lock().expect("transform cache poisoned");
        cache.prune();
        let value = cache
            .values
            .get(result_id)
            .cloned()
            .context("transform result expired; generate a new preview")?;
        cache.lru.retain(|id| id != result_id);
        cache.lru.push_back(result_id.into());
        Ok(value)
    }
}
impl Cache {
    fn prune(&mut self) {
        let now = Instant::now();
        let expired: Vec<_> = self
            .values
            .iter()
            .filter(|(_, value)| now.duration_since(value.created) > RESULT_TTL)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            self.remove(&id);
        }
        while self.values.len() > MAX_RESULTS || self.bytes > MAX_CACHE_BYTES {
            let Some(id) = self.lru.pop_front() else {
                break;
            };
            self.remove(&id);
        }
    }
    fn remove(&mut self, id: &str) {
        if let Some(value) = self.values.remove(id) {
            self.bytes = self
                .bytes
                .saturating_sub(value.outputs.iter().map(payload_bytes).sum());
        }
        self.lru.retain(|value| value != id);
    }
}

pub async fn preferences(repo: &HistoryRepository) -> Result<TransformPreferences> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='transform_preferences'",
    )
    .fetch_optional(&repo.pool)
    .await?;
    Ok(value
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default())
}
pub async fn update_preferences(
    repo: &HistoryRepository,
    preferences: &TransformPreferences,
) -> Result<()> {
    let now = crate::history::now_ms();
    sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('transform_preferences',?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(serde_json::to_string(preferences)?).bind(now).bind(now).execute(&repo.pool).await?;
    Ok(())
}

fn payload_bytes(value: &CapturedRepresentation) -> usize {
    match &value.payload {
        CapturedPayload::Text(value) => value.len(),
        CapturedPayload::Binary(value) => value.len(),
        CapturedPayload::Files(values) => values.iter().map(String::len).sum(),
    }
}
fn preview_model(outputs: &[CapturedRepresentation], result_id: &str) -> RenderModel {
    match outputs.first().map(|item| &item.payload) {
        Some(CapturedPayload::Text(text)) => {
            text_preview_model(outputs[0].canonical_mime_type.as_deref(), text)
        }
        Some(CapturedPayload::Binary(_))
            if outputs[0]
                .canonical_mime_type
                .as_deref()
                .is_some_and(previewable_raster_mime) =>
        {
            RenderModel::Image {
                source: ImageSource::TransformResult {
                    result_id: result_id.into(),
                    output_index: 0,
                },
                ocr: OcrPresentation::Disabled,
            }
        }
        Some(CapturedPayload::Binary(bytes)) => RenderModel::Text {
            text: format!(
                "Binary {} output ({} bytes)",
                outputs[0].canonical_mime_type.as_deref().unwrap_or("asset"),
                bytes.len()
            ),
        },
        Some(CapturedPayload::Files(files)) => RenderModel::Text {
            text: files.join("\n"),
        },
        None => RenderModel::Error {
            message: "transform produced no output".into(),
        },
    }
}

fn text_preview_model(mime: Option<&str>, text: &str) -> RenderModel {
    match mime {
        Some("application/json") => serde_json::from_str(text)
            .map(|value| RenderModel::Tree { value })
            .unwrap_or_else(|_| RenderModel::Code {
                language: Some("json".into()),
                text: text.into(),
            }),
        Some("text/markdown") => RenderModel::Markdown {
            markdown: text.into(),
        },
        Some("text/csv") => table_preview_model(text, b','),
        Some("text/tab-separated-values") => table_preview_model(text, b'\t'),
        Some("text/typescript") => RenderModel::Code {
            language: Some("typescript".into()),
            text: text.into(),
        },
        Some("application/yaml" | "application/x-yaml") => RenderModel::Code {
            language: Some("yaml".into()),
            text: text.into(),
        },
        Some("application/toml") => RenderModel::Code {
            language: Some("toml".into()),
            text: text.into(),
        },
        _ => RenderModel::Text { text: text.into() },
    }
}

fn table_preview_model(text: &str, delimiter: u8) -> RenderModel {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(delimiter)
        .flexible(false)
        .from_reader(text.as_bytes());
    let rows = reader.records().collect::<std::result::Result<Vec<_>, _>>();
    match rows {
        Ok(rows) if !rows.is_empty() => RenderModel::Table {
            columns: rows[0].iter().map(str::to_owned).collect(),
            rows: rows[1..]
                .iter()
                .map(|row| row.iter().map(str::to_owned).collect())
                .collect(),
        },
        _ => RenderModel::Code {
            language: Some(if delimiter == b'\t' { "tsv" } else { "csv" }.into()),
            text: text.into(),
        },
    }
}

fn previewable_raster_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png"
            | "image/jpeg"
            | "image/webp"
            | "image/gif"
            | "image/avif"
            | "image/bmp"
            | "image/x-icon"
    )
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_catalog_has_no_content_transformers() {
        assert!(descriptors().is_empty());
    }

    #[test]
    fn extension_text_results_use_native_host_preview_models() {
        assert!(matches!(
            text_preview_model(Some("application/json"), "{\"ok\":true}"),
            RenderModel::Tree { .. }
        ));
        assert!(matches!(
            text_preview_model(Some("text/csv"), "name,value\r\nAda,1"),
            RenderModel::Table { columns, rows }
                if columns == ["name", "value"] && rows == [vec!["Ada", "1"]]
        ));
        assert!(matches!(
            text_preview_model(Some("text/markdown"), "| a |\n| --- |"),
            RenderModel::Markdown { .. }
        ));
        assert!(matches!(
            text_preview_model(Some("text/typescript"), "export type Root = string;"),
            RenderModel::Code { language: Some(language), .. } if language == "typescript"
        ));
    }

    #[test]
    fn raster_transform_results_use_the_expiring_image_source() {
        let service = TransformService::default();
        let bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        let preview = service
            .cache_external(
                "clip".into(),
                "extension/decode".into(),
                "1.0.0".into(),
                "source".into(),
                serde_json::json!({}),
                vec![CapturedRepresentation {
                    format_key: "mime:image/png".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: None,
                    platform: "test".into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Binary(bytes.clone()),
                }],
            )
            .unwrap();
        assert!(matches!(
            &preview.model,
            RenderModel::Image {
                source: ImageSource::TransformResult {
                    result_id,
                    output_index: 0
                },
                ..
            } if result_id == &preview.result_id
        ));
        assert_eq!(
            service.image_output(&preview.result_id, 0).unwrap(),
            (bytes, "image/png".into())
        );
    }
}
