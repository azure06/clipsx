//! Transformer contributions. Results are deliberately ephemeral;
//! M5 can adapt WASM packages to this same pure input/output boundary.
use crate::{
    contracts::{ImageSource, OcrPresentation, RenderModel},
    history::{new_id, sha256, CapturedPayload, CapturedRepresentation, HistoryRepository},
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_INPUT_BYTES: usize = 1_048_576;
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

pub trait TransformerContribution: Sync {
    fn descriptor(&self) -> TransformerDescriptor;
    fn accepts(&self, input: &CapturedRepresentation) -> bool;
    fn transform(
        &self,
        input: &CapturedRepresentation,
        parameters: &Value,
    ) -> Result<Vec<CapturedRepresentation>>;
}

struct BuiltinTransformer {
    id: &'static str,
    label: &'static str,
    schema: Value,
    accepts_binary: bool,
}
impl BuiltinTransformer {
    fn text(input: &CapturedRepresentation) -> Result<&str> {
        match &input.payload {
            CapturedPayload::Text(text) => Ok(text),
            _ => bail!("transformer requires text input"),
        }
    }

    fn accepts_for(&self, input: &CapturedRepresentation, presentation_kind: Option<&str>) -> bool {
        if !self.accepts(input) {
            return false;
        }
        let text = match &input.payload {
            CapturedPayload::Text(text) => text.trim(),
            _ => return false,
        };
        match self.id {
            "builtin.transform.json.to_typescript" | "builtin.transform.json.to_csv" => {
                presentation_kind == Some("json") && serde_json::from_str::<Value>(text).is_ok()
            }
            "builtin.transform.url.encode"
            | "builtin.transform.url.decode"
            | "builtin.transform.url.normalize"
            | "builtin.transform.url.query_to_json" => presentation_kind == Some("url"),
            "builtin.transform.csv.to_json" | "builtin.transform.csv.to_markdown" => {
                matches!(presentation_kind, Some("csv" | "table"))
            }
            _ => false,
        }
    }
}
impl TransformerContribution for BuiltinTransformer {
    fn descriptor(&self) -> TransformerDescriptor {
        TransformerDescriptor {
            id: self.id.into(),
            version: "1.0.0".into(),
            label: self.label.into(),
            parameter_schema: self.schema.clone(),
            input_limit_bytes: MAX_INPUT_BYTES,
            timeout_ms: 100,
            execution: "local".into(),
            consent_required: false,
            http_origins: vec![],
            providers: vec![],
            expose_in_menu: true,
        }
    }
    fn accepts(&self, input: &CapturedRepresentation) -> bool {
        self.accepts_binary || matches!(input.payload, CapturedPayload::Text(_))
    }
    fn transform(
        &self,
        input: &CapturedRepresentation,
        parameters: &Value,
    ) -> Result<Vec<CapturedRepresentation>> {
        match self.id {
            "builtin.transform.json.to_typescript" => {
                json_to_typescript(Self::text(input)?, parameters)
            }
            "builtin.transform.url.encode" => Ok(text_output(
                "text/plain",
                &urlencoding::encode(Self::text(input)?),
            )),
            "builtin.transform.url.decode" => Ok(text_output(
                "text/plain",
                &urlencoding::decode(Self::text(input)?).context("invalid URL encoding")?,
            )),
            "builtin.transform.url.normalize" => url_normalize(Self::text(input)?),
            "builtin.transform.url.query_to_json" => url_query_to_json(Self::text(input)?),
            "builtin.transform.csv.to_json" => csv_to_json(Self::text(input)?),
            "builtin.transform.csv.to_markdown" => csv_to_markdown(Self::text(input)?),
            "builtin.transform.json.to_csv" => json_to_csv(Self::text(input)?),
            _ => bail!("unknown transformer contribution"),
        }
    }
}

// `urlencoding` is not a dependency: percent helpers below keep the public
// contribution fully deterministic and avoid a browser/runtime dependency.
mod urlencoding {
    use anyhow::Result;
    pub fn encode(value: &str) -> String {
        value
            .bytes()
            .flat_map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    vec![b as char]
                }
                _ => format!("%{b:02X}").chars().collect(),
            })
            .collect()
    }
    pub fn decode(value: &str) -> Result<String> {
        let mut bytes = Vec::new();
        let mut chars = value.as_bytes().iter().copied();
        while let Some(c) = chars.next() {
            if c == b'%' {
                let a = chars
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("truncated percent escape"))?;
                let b = chars
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("truncated percent escape"))?;
                let pair = [a, b];
                let hex = std::str::from_utf8(&pair)?;
                bytes.push(
                    u8::from_str_radix(hex, 16)
                        .map_err(|_| anyhow::anyhow!("invalid percent escape"))?,
                );
            } else {
                bytes.push(c);
            }
        }
        String::from_utf8(bytes).map_err(Into::into)
    }
}

fn registry() -> Vec<BuiltinTransformer> {
    let no_parameters = json!({"type":"object","additionalProperties":false});
    vec![
        BuiltinTransformer {
            id: "builtin.transform.json.to_typescript",
            label: "JSON to TypeScript",
            schema: json!({"type":"object","properties":{"rootName":{"type":"string","default":"Root","maxLength":80}},"additionalProperties":false}),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.url.encode",
            label: "URL encode",
            schema: no_parameters.clone(),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.url.decode",
            label: "URL decode",
            schema: no_parameters.clone(),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.url.normalize",
            label: "Normalize URL",
            schema: no_parameters.clone(),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.url.query_to_json",
            label: "URL query to JSON",
            schema: no_parameters.clone(),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.csv.to_json",
            label: "CSV to JSON",
            schema: no_parameters.clone(),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.csv.to_markdown",
            label: "CSV to Markdown",
            schema: no_parameters.clone(),
            accepts_binary: false,
        },
        BuiltinTransformer {
            id: "builtin.transform.json.to_csv",
            label: "JSON to CSV",
            schema: no_parameters,
            accepts_binary: false,
        },
    ]
}

pub fn descriptors() -> Vec<TransformerDescriptor> {
    registry()
        .into_iter()
        .map(|transformer| transformer.descriptor())
        .collect()
}

pub fn descriptors_for(
    input: &CapturedRepresentation,
    presentation_kind: Option<&str>,
) -> Vec<TransformerDescriptor> {
    registry()
        .into_iter()
        .filter(|transformer| transformer.accepts_for(input, presentation_kind))
        .map(|transformer| transformer.descriptor())
        .collect()
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
        repo: &HistoryRepository,
        clip_id: &str,
        transformer_id: &str,
        source_id: &str,
        parameters: Value,
    ) -> Result<TransformPreview> {
        let (source, source_hash) = repo.source_representation(clip_id, source_id).await?;
        if payload_bytes(&source) > MAX_INPUT_BYTES {
            bail!("transform input exceeds 1 MiB")
        }
        let transformer = registry()
            .into_iter()
            .find(|candidate| candidate.id == transformer_id)
            .context("transformer not found")?;
        if !transformer.accepts(&source) {
            bail!("transformer does not accept this representation")
        }
        validate_parameters(transformer_id, &parameters)?;
        let started = Instant::now();
        let outputs = transformer.transform(&source, &parameters)?;
        if started.elapsed() > Duration::from_millis(100) {
            bail!("transformer exceeded 100 ms execution budget")
        }
        let total: usize = outputs.iter().map(payload_bytes).sum();
        if outputs.is_empty() || total > MAX_OUTPUT_BYTES {
            bail!("transform output exceeds 10 MiB")
        }
        let result_id = new_id();
        let preview = TransformPreview {
            result_id: result_id.clone(),
            expires_at: crate::history::now_ms() + RESULT_TTL.as_millis() as i64,
            transformer_id: transformer.id.into(),
            transformer_version: "1.0.0".into(),
            source_id: source_id.into(),
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
            source_clip_id: clip_id.into(),
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
        let _ = source_hash; // provenance is verified by the source id/hash at creation.
        Ok(preview)
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
fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux_x11"
    }
}
fn text_output(mime: &str, text: &str) -> Vec<CapturedRepresentation> {
    let mut output = vec![CapturedRepresentation {
        format_key: format!("{}:{}", platform(), mime),
        canonical_mime_type: Some(mime.into()),
        native_type: None,
        platform: platform().into(),
        capture_priority: 10,
        payload: CapturedPayload::Text(text.into()),
    }];
    if mime != "text/plain" {
        output.push(CapturedRepresentation {
            format_key: format!("{}:text/plain", platform()),
            canonical_mime_type: Some("text/plain".into()),
            native_type: None,
            platform: platform().into(),
            capture_priority: 100,
            payload: CapturedPayload::Text(text.into()),
        });
    }
    output
}
fn preview_model(outputs: &[CapturedRepresentation], result_id: &str) -> RenderModel {
    match outputs.first().map(|item| &item.payload) {
        Some(CapturedPayload::Text(text)) => RenderModel::Code {
            language: outputs[0].canonical_mime_type.clone(),
            text: text.clone(),
        },
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
fn validate_parameters(id: &str, parameters: &Value) -> Result<()> {
    let object = parameters
        .as_object()
        .context("transform parameters must be an object")?;
    if id == "builtin.transform.json.to_typescript" {
        if object.keys().any(|key| key != "rootName") {
            bail!("unknown transform parameter")
        }
        if let Some(name) = object.get("rootName") {
            let name = name.as_str().context("rootName must be text")?;
            if name.is_empty()
                || name.len() > 80
                || !name
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                bail!("rootName must be a TypeScript identifier")
            }
        }
    } else if !object.is_empty() {
        bail!("transformer does not accept parameters")
    }
    Ok(())
}
fn json_to_typescript(input: &str, parameters: &Value) -> Result<Vec<CapturedRepresentation>> {
    let value: Value = serde_json::from_str(input).context("invalid JSON")?;
    let root = parameters
        .get("rootName")
        .and_then(Value::as_str)
        .unwrap_or("Root");
    let output = format!("export type {root} = {};\n", typescript_type(&value, 0));
    Ok(text_output("text/typescript", &output))
}
fn typescript_type(value: &Value, depth: usize) -> String {
    if depth > 12 {
        return "unknown".into();
    }
    match value {
        Value::Null => "null".into(),
        Value::Bool(_) => "boolean".into(),
        Value::Number(_) => "number".into(),
        Value::String(_) => "string".into(),
        Value::Array(values) => {
            if values.is_empty() {
                "unknown[]".into()
            } else {
                let mut kinds: Vec<_> = values
                    .iter()
                    .map(|value| typescript_type(value, depth + 1))
                    .collect();
                kinds.sort();
                kinds.dedup();
                format!("({})[]", kinds.join(" | "))
            }
        }
        Value::Object(values) => {
            let fields = values
                .iter()
                .map(|(key, value)| {
                    format!(
                        "{}: {}",
                        typescript_key(key),
                        typescript_type(value, depth + 1)
                    )
                })
                .collect::<Vec<_>>();
            format!("{{ {} }}", fields.join("; "))
        }
    }
}
fn typescript_key(value: &str) -> String {
    if value
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == '_')
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        value.into()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| "key".into())
    }
}
fn url_normalize(input: &str) -> Result<Vec<CapturedRepresentation>> {
    let mut url = url::Url::parse(input.trim()).context("invalid URL")?;
    url.set_fragment(None);
    if (url.scheme() == "http" && url.port() == Some(80))
        || (url.scheme() == "https" && url.port() == Some(443))
    {
        let _ = url.set_port(None);
    }
    Ok(text_output("text/plain", url.as_str()))
}
fn url_query_to_json(input: &str) -> Result<Vec<CapturedRepresentation>> {
    let url = url::Url::parse(input.trim()).context("invalid URL")?;
    let mut map = serde_json::Map::new();
    for (key, value) in url.query_pairs() {
        match map.get_mut(key.as_ref()) {
            Some(Value::Array(values)) => values.push(Value::String(value.into_owned())),
            Some(previous) => {
                let old = previous.take();
                *previous = Value::Array(vec![old, Value::String(value.into_owned())]);
            }
            None => {
                map.insert(key.into_owned(), Value::String(value.into_owned()));
            }
        }
    }
    let output = serde_json::to_string_pretty(&Value::Object(map))?;
    Ok(text_output("application/json", &output))
}

fn csv_parse_row(row: &str, delimiter: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = row.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == delimiter {
            fields.push(std::mem::take(&mut field));
        } else {
            field.push(ch);
        }
    }
    fields.push(field);
    fields
}
fn csv_quote_field(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}
fn csv_to_json(input: &str) -> Result<Vec<CapturedRepresentation>> {
    let lines: Vec<&str> = input.lines().collect();
    if lines.is_empty() {
        bail!("CSV input is empty");
    }
    let first_line = lines[0];
    let delimiter = if first_line.matches('\t').count() > first_line.matches(',').count() {
        '\t'
    } else {
        ','
    };
    let headers = csv_parse_row(first_line, delimiter);
    let mut records = Vec::new();
    for line in &lines[1..] {
        if line.trim().is_empty() {
            continue;
        }
        let fields = csv_parse_row(line, delimiter);
        let mut obj = serde_json::Map::new();
        for (i, header) in headers.iter().enumerate() {
            obj.insert(
                header.clone(),
                Value::String(fields.get(i).cloned().unwrap_or_default()),
            );
        }
        records.push(Value::Object(obj));
    }
    Ok(text_output(
        "application/json",
        &serde_json::to_string_pretty(&Value::Array(records))?,
    ))
}
fn csv_to_markdown(input: &str) -> Result<Vec<CapturedRepresentation>> {
    let lines: Vec<&str> = input
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        bail!("CSV input is empty");
    }
    let delimiter = if lines[0].matches('\t').count() > lines[0].matches(',').count() {
        '\t'
    } else {
        ','
    };
    let rows: Vec<Vec<String>> = lines
        .iter()
        .map(|line| csv_parse_row(line, delimiter))
        .collect();
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let markdown_row = |row: &[String]| {
        format!(
            "| {} |",
            (0..width)
                .map(|index| row
                    .get(index)
                    .cloned()
                    .unwrap_or_default()
                    .replace('|', "\\|"))
                .collect::<Vec<_>>()
                .join(" | ")
        )
    };
    let mut output = vec![markdown_row(&rows[0])];
    output.push(format!("| {} |", vec!["---"; width].join(" | ")));
    output.extend(rows[1..].iter().map(|row| markdown_row(row)));
    Ok(text_output("text/markdown", &output.join("\n")))
}
fn json_to_csv(input: &str) -> Result<Vec<CapturedRepresentation>> {
    let value: Value = serde_json::from_str(input).context("invalid JSON")?;
    let array = value.as_array().context("JSON must be a top-level array")?;
    if array.is_empty() {
        return Ok(text_output("text/csv", ""));
    }
    let mut headers: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in array {
        if let Some(obj) = item.as_object() {
            for key in obj.keys() {
                if seen.insert(key.clone()) {
                    headers.push(key.clone());
                }
            }
        }
    }
    if headers.is_empty() {
        bail!("JSON array must contain objects");
    }
    let mut lines = Vec::new();
    lines.push(
        headers
            .iter()
            .map(|h| csv_quote_field(h))
            .collect::<Vec<_>>()
            .join(","),
    );
    for item in array {
        let obj = item.as_object();
        let row: Vec<String> = headers
            .iter()
            .map(|key| {
                let s = match obj.and_then(|o| o.get(key)) {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Null) | None => String::new(),
                    Some(v) => v.to_string(),
                };
                csv_quote_field(&s)
            })
            .collect();
        lines.push(row.join(","));
    }
    Ok(text_output("text/csv", &lines.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_input(value: &str, mime: &str) -> CapturedRepresentation {
        CapturedRepresentation {
            format_key: format!("test:{mime}"),
            canonical_mime_type: Some(mime.into()),
            native_type: None,
            platform: "test".into(),
            capture_priority: 1,
            payload: CapturedPayload::Text(value.into()),
        }
    }

    #[test]
    fn transformer_discovery_is_presentation_specific() {
        let json = text_input("{\"answer\":42}", "application/json");
        let ids = descriptors_for(&json, Some("json"))
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        assert!(ids.contains(&"builtin.transform.json.to_typescript".into()));
        assert!(!ids.contains(&"builtin.transform.csv.to_json".into()));
    }

    #[test]
    fn csv_to_markdown_preserves_table_shape_and_escapes_pipes() {
        let output = csv_to_markdown("name,note\nAda,one|two").unwrap();
        assert!(
            matches!(&output[0].payload, CapturedPayload::Text(value) if value == "| name | note |\n| --- | --- |\n| Ada | one\\|two |")
        );
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
                json!({}),
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
