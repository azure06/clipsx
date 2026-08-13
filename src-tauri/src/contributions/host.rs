//! Contribution host for detectors and renderers.
use crate::{
    contracts::{FilePresentation, OcrPresentation, RenderModel},
    extensions::ExtensionService,
    history::{new_id, now_ms, HistoryRepository, RepresentationDetail},
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use std::{collections::BTreeMap, sync::LazyLock, time::Duration};
use tokio::sync::Semaphore;

const MAX_INPUT_BYTES: usize = 1_048_576;
const MAX_FACETS_PER_REPRESENTATION: usize = 32;
static DETECTION_LIMIT: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(2));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetDescriptor {
    pub id: String,
    pub display_name: String,
    pub source_representation_id: String,
    pub detector_id: String,
    pub detector_version: String,
    pub payload: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererDescriptor {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub purpose: String,
    pub surfaces: Vec<String>,
    pub trusted_html: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectorDescriptor {
    pub id: String,
    pub version: String,
    pub display_name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipViewDescriptor {
    pub id: String,
    pub renderer_id: String,
    pub label: String,
    pub source_id: String,
    pub mime_type: Option<String>,
    pub capability_id: String,
    pub facet_id: Option<String>,
    pub is_original: bool,
    pub presentation_kind: String,
    pub purpose: String,
    pub match_specificity: i32,
    pub placement: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipViewSet {
    pub clip_id: String,
    pub primary_view_id: String,
    pub presentation_kind: String,
    pub facets: Vec<FacetDescriptor>,
    pub views: Vec<ClipViewDescriptor>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RendererPreferences {
    pub by_mime_type: BTreeMap<String, String>,
    pub by_facet_id: BTreeMap<String, String>,
    pub by_capability_id: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct TextSource {
    id: String,
    mime: Option<String>,
    format: String,
    text: String,
}
#[derive(Debug, Clone)]
struct DetectedFacet {
    id: &'static str,
    #[allow(dead_code)]
    name: &'static str,
    payload: Value,
}

/// The host gives contributions only immutable, bounded text. They cannot touch storage.
trait DetectorContribution: Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str {
        "1"
    }
    fn name(&self) -> &'static str;
    fn accepts(&self, source: &TextSource) -> bool {
        source.mime.as_deref() == Some("text/plain")
            || source.mime.as_deref() == Some("application/json")
            || source.format.ends_with(":text/plain")
    }
    fn input_limit(&self) -> usize {
        MAX_INPUT_BYTES
    }
    fn timeout(&self) -> Duration {
        Duration::from_millis(50)
    }
    fn candidate(&self, source: &TextSource) -> bool;
    fn detect(&self, source: &TextSource) -> Vec<DetectedFacet>;
}
trait RendererContribution: Sync {
    fn descriptor(&self) -> RendererDescriptor;
    fn render(
        &self,
        representation: &RepresentationDetail,
        facet: Option<&FacetDescriptor>,
    ) -> Result<RenderModel>;
}
struct OriginalRenderer;
struct TextRenderer;
struct HtmlRenderer;
struct MarkdownRenderer;
struct ImageRenderer;
struct RichTextRenderer;
struct FilesRenderer;
struct DocumentRenderer;
struct OfficeRenderer;
struct JsonRenderer;
struct TableRenderer;
struct KeyValueRenderer;
struct UrlRenderer;
struct JwtRenderer;
struct NumberRenderer;
struct DateRenderer;
fn renderer_descriptor(
    id: &str,
    name: &str,
    _priority: i32,
    trusted_html: bool,
) -> RendererDescriptor {
    let purpose = match id {
        "builtin.original" => "source",
        "builtin.office" => "diagnostic",
        "builtin.json" | "builtin.table" => "structured",
        "builtin.key_value" | "builtin.url" | "builtin.jwt" | "builtin.number" | "builtin.date"
        | "builtin.markdown" => "semantic",
        _ => "faithful",
    };
    RendererDescriptor {
        id: id.into(),
        version: "1".into(),
        display_name: name.into(),
        purpose: purpose.into(),
        surfaces: vec!["detail".into()],
        trusted_html,
    }
}
impl RendererContribution for OriginalRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.original", "Original", 0, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(original(r))
    }
}
impl RendererContribution for TextRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.text", "Text", 50, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Text {
            text: r.text_value.clone().context("text unavailable")?,
        })
    }
}
impl RendererContribution for HtmlRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.html", "HTML", 100, true)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        // Clipboard HTML from apps like VSCode uses <div>/<span style="..."> for syntax
        // highlighting. Sanitisation strips those tags entirely, leaving unstyled plain text.
        // The iframe renders with sandbox="allow-same-origin" (no allow-scripts), so no JS
        // can execute — it is safe to pass the raw HTML here.
        Ok(RenderModel::Html {
            sanitized_html: r.text_value.clone().context("HTML unavailable")?,
        })
    }
}
impl RendererContribution for MarkdownRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.markdown", "Markdown", 75, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Markdown {
            markdown: r.text_value.clone().context("Markdown unavailable")?,
        })
    }
}
impl RendererContribution for ImageRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.image", "Image", 100, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Image {
            asset_id: r.binary_file_id.clone().context("image unavailable")?,
            ocr: OcrPresentation::Pending,
        })
    }
}
impl RendererContribution for RichTextRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.rich_text", "Rich text", 90, true)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        let source = r.text_value.as_deref().context("rich text unavailable")?;
        let (sanitized_html, plain_text) = render_rtf(source);
        Ok(RenderModel::RichText {
            sanitized_html,
            plain_text,
        })
    }
}
impl RendererContribution for FilesRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.files", "Files", 110, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Files {
            entries: r
                .file_references
                .iter()
                .map(|path| FilePresentation {
                    path: path.clone(),
                    name: path
                        .rsplit(['/', '\\'])
                        .next()
                        .filter(|value| !value.is_empty())
                        .unwrap_or(path)
                        .to_string(),
                })
                .collect(),
        })
    }
}
impl RendererContribution for DocumentRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.document", "Document", 100, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Document {
            asset_id: r.binary_file_id.clone().context("document unavailable")?,
            mime_type: r
                .canonical_mime_type
                .clone()
                .context("document MIME unavailable")?,
        })
    }
}
impl RendererContribution for OfficeRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.office", "Office/native", 95, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Office {
            format_key: r.format_key.clone(),
            native_type: r.native_type.clone(),
            byte_length: r.byte_length,
        })
    }
}
impl RendererContribution for JsonRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.json", "JSON", 90, false)
    }
    fn render(&self, _: &RepresentationDetail, f: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::Tree {
            value: f.context("JSON facet unavailable")?.payload["value"].clone(),
        })
    }
}
impl RendererContribution for TableRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.table", "Table", 80, false)
    }
    fn render(&self, _: &RepresentationDetail, f: Option<&FacetDescriptor>) -> Result<RenderModel> {
        let payload = &f.context("table facet unavailable")?.payload;
        Ok(RenderModel::Table {
            columns: serde_json::from_value(payload["columns"].clone())?,
            rows: serde_json::from_value(payload["rows"].clone())?,
        })
    }
}
impl RendererContribution for KeyValueRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.key_value", "Details", 70, false)
    }
    fn render(&self, r: &RepresentationDetail, f: Option<&FacetDescriptor>) -> Result<RenderModel> {
        let facet = f.context("facet unavailable")?;
        Ok(RenderModel::Semantic {
            facet_id: facet.id.clone(),
            text: r.text_value.clone().unwrap_or_default(),
            payload: facet.payload.clone(),
        })
    }
}
macro_rules! key_value_renderer {
    ($type:ty, $id:literal, $name:literal, $priority:literal) => {
        impl RendererContribution for $type {
            fn descriptor(&self) -> RendererDescriptor {
                renderer_descriptor($id, $name, $priority, false)
            }
            fn render(
                &self,
                representation: &RepresentationDetail,
                facet: Option<&FacetDescriptor>,
            ) -> Result<RenderModel> {
                let facet = facet.context("facet unavailable")?;
                Ok(RenderModel::Semantic {
                    facet_id: facet.id.clone(),
                    text: representation.text_value.clone().unwrap_or_default(),
                    payload: facet.payload.clone(),
                })
            }
        }
    };
}
key_value_renderer!(UrlRenderer, "builtin.url", "URL", 85);
key_value_renderer!(JwtRenderer, "builtin.jwt", "JWT", 85);
key_value_renderer!(NumberRenderer, "builtin.number", "Number", 75);
key_value_renderer!(DateRenderer, "builtin.date", "Date", 75);
static ORIGINAL_RENDERER: OriginalRenderer = OriginalRenderer;
static TEXT_RENDERER: TextRenderer = TextRenderer;
static HTML_RENDERER: HtmlRenderer = HtmlRenderer;
static MARKDOWN_RENDERER: MarkdownRenderer = MarkdownRenderer;
static IMAGE_RENDERER: ImageRenderer = ImageRenderer;
static RICH_TEXT_RENDERER: RichTextRenderer = RichTextRenderer;
static FILES_RENDERER: FilesRenderer = FilesRenderer;
static DOCUMENT_RENDERER: DocumentRenderer = DocumentRenderer;
static OFFICE_RENDERER: OfficeRenderer = OfficeRenderer;
static JSON_RENDERER: JsonRenderer = JsonRenderer;
static TABLE_RENDERER: TableRenderer = TableRenderer;
static KEY_VALUE_RENDERER: KeyValueRenderer = KeyValueRenderer;
static URL_RENDERER: UrlRenderer = UrlRenderer;
static JWT_RENDERER: JwtRenderer = JwtRenderer;
static NUMBER_RENDERER: NumberRenderer = NumberRenderer;
static DATE_RENDERER: DateRenderer = DateRenderer;
fn renderer_registry() -> Vec<&'static dyn RendererContribution> {
    vec![
        &ORIGINAL_RENDERER,
        &TEXT_RENDERER,
        &HTML_RENDERER,
        &MARKDOWN_RENDERER,
        &IMAGE_RENDERER,
        &RICH_TEXT_RENDERER,
        &FILES_RENDERER,
        &DOCUMENT_RENDERER,
        &OFFICE_RENDERER,
        &JSON_RENDERER,
        &TABLE_RENDERER,
        &KEY_VALUE_RENDERER,
        &URL_RENDERER,
        &JWT_RENDERER,
        &NUMBER_RENDERER,
        &DATE_RENDERER,
    ]
}

struct JsonDetector;
impl DetectorContribution for JsonDetector {
    fn id(&self) -> &'static str {
        "core.data.json"
    }
    fn name(&self) -> &'static str {
        "JSON"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let t = s.text.trim();
        t.starts_with('{') || t.starts_with('[')
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        serde_json::from_str::<Value>(&s.text)
            .ok()
            .map(|v| {
                vec![DetectedFacet {
                    id: self.id(),
                    name: self.name(),
                    payload: json!({"schemaVersion":1,"value":v}),
                }]
            })
            .unwrap_or_default()
    }
}
struct UrlDetector;
impl DetectorContribution for UrlDetector {
    fn id(&self) -> &'static str {
        "core.link.url"
    }
    fn name(&self) -> &'static str {
        "URL"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        s.text.trim().starts_with("http://") || s.text.trim().starts_with("https://")
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        url::Url::parse(s.text.trim()).ok().filter(|u|matches!(u.scheme(),"http"|"https")).map(|u|vec![DetectedFacet{id:self.id(),name:self.name(),payload:json!({"schemaVersion":1,"href":u.as_str(),"host":u.host_str(),"path":u.path()})}]).unwrap_or_default()
    }
}
struct JwtDetector;
impl DetectorContribution for JwtDetector {
    fn id(&self) -> &'static str {
        "core.token.jwt"
    }
    fn name(&self) -> &'static str {
        "JWT"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        s.text.trim().split('.').count() == 3
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let p: Vec<_> = s.text.trim().split('.').collect();
        if p.len() != 3 {
            return vec![];
        }
        let decode = |part: &str| {
            URL_SAFE_NO_PAD
                .decode(part)
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        };
        match (decode(p[0]), decode(p[1])) {
            (Some(header), Some(claims)) => vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"header":header,"claims":claims}),
            }],
            _ => vec![],
        }
    }
}
struct NumberDetector;
impl DetectorContribution for NumberDetector {
    fn id(&self) -> &'static str {
        "core.value.number"
    }
    fn name(&self) -> &'static str {
        "Number"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        s.text.trim().len() <= 64
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        s.text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .map(|n| {
                vec![DetectedFacet {
                    id: self.id(),
                    name: self.name(),
                    payload: json!({"schemaVersion":1,"value":n}),
                }]
            })
            .unwrap_or_default()
    }
}
struct DateDetector;
impl DetectorContribution for DateDetector {
    fn id(&self) -> &'static str {
        "core.time.date"
    }
    fn name(&self) -> &'static str {
        "Date"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let t = s.text.trim();
        (t.len() >= 10 && t.len() <= 35 && t.as_bytes().get(4) == Some(&b'-'))
            || (matches!(t.len(), 10 | 13) && t.chars().all(|c| c.is_ascii_digit()))
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let t = s.text.trim();
        let numeric = matches!(t.len(), 10 | 13) && t.chars().all(|c| c.is_ascii_digit());
        let valid = numeric || valid_iso_date(t);
        if valid {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"value":t,"interpretation":if numeric { if t.len()==13{"unix_milliseconds"}else{"unix_seconds"} } else {"iso_like"}}),
            }]
        } else {
            vec![]
        }
    }
}
fn valid_iso_date(value: &str) -> bool {
    if value.len() < 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
    {
        return false;
    }
    let year = value[0..4].parse::<u16>().ok();
    let month = value[5..7].parse::<u8>().ok();
    let day = value[8..10].parse::<u8>().ok();
    year.is_some_and(|year| year > 0)
        && month.is_some_and(|month| (1..=12).contains(&month))
        && day.is_some_and(|day| (1..=31).contains(&day))
}
struct MarkdownDetector;
impl DetectorContribution for MarkdownDetector {
    fn id(&self) -> &'static str {
        "core.text.markdown"
    }
    fn name(&self) -> &'static str {
        "Markdown"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        s.text.contains("\n#")
            || s.text.starts_with('#')
            || s.text.contains("**")
            || s.text.contains("```")
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        if self.candidate(s) {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1}),
            }]
        } else {
            vec![]
        }
    }
}
struct TableDetector;
impl DetectorContribution for TableDetector {
    fn id(&self) -> &'static str {
        "core.data.table"
    }
    fn name(&self) -> &'static str {
        "Table"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        s.text.lines().count() >= 2 && (s.text.contains('\t') || s.text.contains(','))
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let delimiter = if s.text.contains('\t') { '\t' } else { ',' };
        let rows: Vec<Vec<&str>> = s
            .text
            .lines()
            .map(|l| l.split(delimiter).collect())
            .collect();
        if rows.len() >= 2 && rows.iter().all(|r| r.len() == rows[0].len()) && rows[0].len() > 1 {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"delimiter":delimiter.to_string(),"columns":rows[0],"rows":rows[1..]}),
            }]
        } else {
            vec![]
        }
    }
}

struct EmailDetector;
impl DetectorContribution for EmailDetector {
    fn id(&self) -> &'static str {
        "core.contact.email"
    }
    fn name(&self) -> &'static str {
        "Email"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let value = s.text.trim();
        value.len() <= 320 && value.contains('@') && !value.contains(char::is_whitespace)
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        let Some((local, domain)) = value.rsplit_once('@') else {
            return vec![];
        };
        if local.is_empty()
            || domain.is_empty()
            || !domain.contains('.')
            || domain.starts_with('.')
            || domain.ends_with('.')
        {
            return vec![];
        }
        vec![DetectedFacet {
            id: self.id(),
            name: self.name(),
            payload: json!({"schemaVersion":1,"address":value,"domain":domain}),
        }]
    }
}

struct ColorDetector;
impl DetectorContribution for ColorDetector {
    fn id(&self) -> &'static str {
        "core.value.color"
    }
    fn name(&self) -> &'static str {
        "Color"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let value = s.text.trim();
        matches!(value.len(), 4 | 7 | 9) && value.starts_with('#')
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        if value.starts_with('#') && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"hex":value}),
            }]
        } else {
            vec![]
        }
    }
}

struct CodeDetector;
impl DetectorContribution for CodeDetector {
    fn id(&self) -> &'static str {
        "core.text.code"
    }
    fn name(&self) -> &'static str {
        "Code"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let value = s.text.trim();
        value.contains("function ")
            || value.contains("const ")
            || value.contains("let ")
            || value.contains("def ")
            || value.contains("class ")
            || value.contains("=>")
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        let language = if value.contains("def ") || value.contains("import ") {
            "python"
        } else if value.contains("function ") || value.contains("const ") || value.contains("=>") {
            "javascript"
        } else {
            "unknown"
        };
        vec![DetectedFacet {
            id: self.id(),
            name: self.name(),
            payload: json!({"schemaVersion":1,"language":language}),
        }]
    }
}

struct MathDetector;
impl DetectorContribution for MathDetector {
    fn id(&self) -> &'static str {
        "core.math.expression"
    }
    fn name(&self) -> &'static str {
        "Math"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let value = s.text.trim();
        !value.is_empty()
            && value.len() <= 256
            && value
                .chars()
                .any(|c| matches!(c, '+' | '-' | '*' | '/' | '=' | '^'))
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        if value.chars().all(|c| {
            c.is_ascii_digit()
                || c.is_ascii_whitespace()
                || matches!(c, '+' | '-' | '*' | '/' | '=' | '^' | '(' | ')' | '.')
        }) {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"expression":value}),
            }]
        } else {
            vec![]
        }
    }
}

struct PhoneDetector;
impl DetectorContribution for PhoneDetector {
    fn id(&self) -> &'static str {
        "core.contact.phone"
    }
    fn name(&self) -> &'static str {
        "Phone"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        s.text.trim().len() <= 32
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        let digits: String = value.chars().filter(char::is_ascii_digit).collect();
        if (7..=15).contains(&digits.len())
            && value
                .chars()
                .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '(' | ')' | ' ' | '.'))
        {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"display":value,"digits":digits}),
            }]
        } else {
            vec![]
        }
    }
}

struct PathDetector;
impl DetectorContribution for PathDetector {
    fn id(&self) -> &'static str {
        "core.file.path"
    }
    fn name(&self) -> &'static str {
        "Path"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let value = s.text.trim();
        value.starts_with('/')
            || value.starts_with("~/")
            || (value.len() > 3
                && value.as_bytes()[1] == b':'
                && matches!(value.as_bytes()[2], b'\\' | b'/'))
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        if self.candidate(s) && !value.contains('\n') {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":1,"path":value}),
            }]
        } else {
            vec![]
        }
    }
}

struct SecretDetector;
impl DetectorContribution for SecretDetector {
    fn id(&self) -> &'static str {
        "core.security.secret"
    }
    fn version(&self) -> &'static str {
        "2"
    }
    fn name(&self) -> &'static str {
        "Secret"
    }
    fn candidate(&self, s: &TextSource) -> bool {
        let value = s.text.trim();
        value.len() >= 20 && value.len() <= 4096
    }
    fn detect(&self, s: &TextSource) -> Vec<DetectedFacet> {
        let value = s.text.trim();
        if let Some((kind, warning)) = classify_secret(value) {
            vec![DetectedFacet {
                id: self.id(),
                name: self.name(),
                payload: json!({"schemaVersion":2,"kind":kind,"warning":warning,"length":value.len()}),
            }]
        } else {
            vec![]
        }
    }
}

fn classify_secret(value: &str) -> Option<(&'static str, &'static str)> {
    if value.starts_with("-----BEGIN ") && value.contains("PRIVATE KEY-----") {
        return Some(("private_key", "privateKey"));
    }
    if value.len() == 20
        && value.starts_with("AKIA")
        && value[4..]
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
    {
        return Some(("aws_access_key", "awsAccessKey"));
    }
    if value.starts_with("ghp_")
        && value.len() >= 36
        && value[4..].chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        return Some(("github_token", "githubToken"));
    }
    if ["sk_live_", "sk_test_", "rk_live_", "rk_test_"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
        && value.len() >= 20
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return Some(("stripe_key", "stripeKey"));
    }

    let lower = value.to_ascii_lowercase();
    let credential_assignment = value.split_once(['=', ':']).is_some_and(|(key, secret)| {
        ["api_key", "apikey", "secret", "token", "password", "bearer"]
            .iter()
            .any(|marker| key.trim().to_ascii_lowercase().contains(marker))
            && secret.trim().len() >= 16
            && !secret.trim().chars().any(char::is_whitespace)
    }) || lower
        .strip_prefix("bearer ")
        .is_some_and(|secret| secret.len() >= 16 && !secret.chars().any(char::is_whitespace));
    if credential_assignment {
        return Some(("credential_assignment", "credentialAssignment"));
    }

    let uuid_like = value.len() == 36
        && value.matches('-').count() == 4
        && value.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-');
    let structured = url::Url::parse(value).is_ok()
        || value.contains('@')
        || value.contains('/')
        || value.contains('\\')
        || value.matches('.').count() == 2
        || uuid_like;
    let opaque = (32..=512).contains(&value.len())
        && !structured
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '=' | '+'))
        && value.chars().any(|ch| ch.is_ascii_alphabetic())
        && value.chars().any(|ch| ch.is_ascii_digit())
        && value
            .chars()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            >= 12;
    opaque.then_some(("generic_token", "genericToken"))
}

static JSON: JsonDetector = JsonDetector;
static URL: UrlDetector = UrlDetector;
static JWT: JwtDetector = JwtDetector;
static NUMBER: NumberDetector = NumberDetector;
static DATE: DateDetector = DateDetector;
static MARKDOWN: MarkdownDetector = MarkdownDetector;
static TABLE: TableDetector = TableDetector;
static EMAIL: EmailDetector = EmailDetector;
static COLOR: ColorDetector = ColorDetector;
static CODE: CodeDetector = CodeDetector;
static MATH: MathDetector = MathDetector;
static PHONE: PhoneDetector = PhoneDetector;
static PATH: PathDetector = PathDetector;
static SECRET: SecretDetector = SecretDetector;
fn detectors() -> Vec<&'static dyn DetectorContribution> {
    vec![
        &JSON, &URL, &JWT, &NUMBER, &DATE, &MARKDOWN, &TABLE, &EMAIL, &COLOR, &CODE, &MATH, &PHONE,
        &PATH, &SECRET,
    ]
}

pub fn detector_descriptors() -> Vec<DetectorDescriptor> {
    detectors()
        .into_iter()
        .map(|detector| DetectorDescriptor {
            id: detector.id().into(),
            version: detector.version().into(),
            display_name: detector.name().into(),
        })
        .collect()
}

pub async fn initialize(repo: &HistoryRepository) -> Result<()> {
    for detector in detectors() {
        let now = now_ms();
        sqlx::query("INSERT INTO content_facet_definitions(id,owner_id,version,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET version=excluded.version,display_name=excluded.display_name,updated_at=excluded.updated_at").bind(detector.id()).bind("builtin").bind(detector.version()).bind(detector.name()).bind(now).bind(now).execute(&repo.pool).await?;
    }
    Ok(())
}
pub async fn redetect_outdated(repo: &HistoryRepository) -> Result<u64> {
    let mut ids = std::collections::BTreeSet::new();
    for detector in detectors() {
        let clips=sqlx::query_scalar::<_,String>("SELECT DISTINCT r.clip_id FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id JOIN clip_items c ON c.id=r.clip_id WHERE r.lifecycle_state='ready' AND c.lifecycle_state='ready' AND NOT EXISTS(SELECT 1 FROM content_detection_jobs j WHERE j.representation_id=r.id AND j.detector_id=? AND j.detector_version=? AND j.status IN ('completed','unsupported'))").bind(detector.id()).bind(detector.version()).fetch_all(&repo.pool).await?;
        ids.extend(clips);
    }
    let mut completed = 0;
    for id in ids {
        detect_clip(repo, &id).await?;
        completed += 1;
    }
    Ok(completed)
}
pub async fn detect_clip(repo: &HistoryRepository, clip_id: &str) -> Result<usize> {
    let _permit = DETECTION_LIMIT.acquire().await?;
    initialize(repo).await?;
    let sources = text_sources(repo, clip_id).await?;
    let mut count = 0;
    let mut failures = 0;
    for source in sources {
        for detector in detectors() {
            if !detector.accepts(&source) {
                persist_job_unsupported(
                    repo,
                    &source,
                    detector,
                    "representation selector mismatch",
                )
                .await?;
                continue;
            }
            if source.text.len() > detector.input_limit() {
                persist_job_unsupported(repo, &source, detector, "detector input limit exceeded")
                    .await?;
                continue;
            }
            if !detector.candidate(&source) {
                persist_facets(repo, &source, detector, Vec::new(), 0).await?;
                continue;
            }
            let mut facets = None;
            let mut attempts = 0;
            for attempt in 1..=3 {
                attempts = attempt;
                let detector_ref = detector;
                let source_clone = source.clone();
                match tokio::time::timeout(
                    detector.timeout(),
                    tokio::task::spawn_blocking(move || detector_ref.detect(&source_clone)),
                )
                .await
                {
                    Ok(Ok(value)) => {
                        facets = Some(value);
                        break;
                    }
                    Ok(Err(_)) | Err(_) => continue,
                }
            }
            let Some(facets) = facets else {
                persist_job_failure(repo, &source, detector, "detector timed out or failed")
                    .await?;
                failures += 1;
                continue;
            };
            if facets.len() > MAX_FACETS_PER_REPRESENTATION {
                persist_job_failure(repo, &source, detector, "detector facet limit exceeded")
                    .await?;
                failures += 1;
                continue;
            }
            persist_facets(repo, &source, detector, facets, attempts).await?;
            count += 1;
        }
    }
    if failures > 0 {
        bail!("{failures} detection jobs failed")
    }
    Ok(count)
}
async fn persist_job_unsupported(
    repo: &HistoryRepository,
    source: &TextSource,
    detector: &dyn DetectorContribution,
    message: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO content_detection_jobs(id,representation_id,detector_id,detector_version,status,attempt_count,last_error,requested_at,completed_at) VALUES(?,?,?,?, 'unsupported',0,?,?,?) ON CONFLICT(representation_id,detector_id) DO UPDATE SET detector_version=excluded.detector_version,status='unsupported',attempt_count=0,last_error=excluded.last_error,completed_at=excluded.completed_at").bind(new_id()).bind(&source.id).bind(detector.id()).bind(detector.version()).bind(message).bind(now_ms()).bind(now_ms()).execute(&repo.pool).await?;
    Ok(())
}
async fn persist_job_failure(
    repo: &HistoryRepository,
    source: &TextSource,
    detector: &dyn DetectorContribution,
    message: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO content_detection_jobs(id,representation_id,detector_id,detector_version,status,attempt_count,last_error,requested_at,completed_at) VALUES(?,?,?,?, 'failed',3,?,?,?) ON CONFLICT(representation_id,detector_id) DO UPDATE SET detector_version=excluded.detector_version,status='failed',attempt_count=3,last_error=excluded.last_error,completed_at=excluded.completed_at").bind(new_id()).bind(&source.id).bind(detector.id()).bind(detector.version()).bind(message).bind(now_ms()).bind(now_ms()).execute(&repo.pool).await?;
    Ok(())
}
async fn text_sources(repo: &HistoryRepository, clip_id: &str) -> Result<Vec<TextSource>> {
    let rows=sqlx::query("SELECT r.id,r.canonical_mime_type,r.format_key,t.text_value FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id JOIN clip_items c ON c.id=r.clip_id WHERE r.clip_id=? AND r.lifecycle_state='ready' AND c.lifecycle_state='ready'").bind(clip_id).fetch_all(&repo.pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| TextSource {
            id: r.get(0),
            mime: r.get(1),
            format: r.get(2),
            text: r.get(3),
        })
        .collect())
}
async fn persist_facets(
    repo: &HistoryRepository,
    source: &TextSource,
    detector: &dyn DetectorContribution,
    facets: Vec<DetectedFacet>,
    attempts: i64,
) -> Result<()> {
    for facet in &facets {
        validate_facet(facet, detector)?;
    }
    let mut tx = repo.pool.begin().await?;
    sqlx::query(
        "DELETE FROM content_clip_facets WHERE source_representation_id=? AND detector_id=?",
    )
    .bind(&source.id)
    .bind(detector.id())
    .execute(&mut *tx)
    .await?;
    for facet in facets {
        sqlx::query("INSERT INTO content_clip_facets(clip_id,facet_id,source_representation_id,detector_id,detector_version,payload_json,created_at) SELECT r.clip_id,?,?,?,?,?,? FROM clip_representations r WHERE r.id=?").bind(facet.id).bind(&source.id).bind(detector.id()).bind(detector.version()).bind(serde_json::to_string(&facet.payload)?).bind(now_ms()).bind(&source.id).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO content_detection_jobs(id,representation_id,detector_id,detector_version,status,attempt_count,requested_at,completed_at) VALUES(?,?,?,?, 'completed',?,?,?) ON CONFLICT(representation_id,detector_id) DO UPDATE SET detector_version=excluded.detector_version,status='completed',attempt_count=excluded.attempt_count,completed_at=excluded.completed_at,last_error=NULL").bind(new_id()).bind(&source.id).bind(detector.id()).bind(detector.version()).bind(attempts).bind(now_ms()).bind(now_ms()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
fn validate_facet(facet: &DetectedFacet, detector: &dyn DetectorContribution) -> Result<()> {
    if facet.id != detector.id()
        || facet.payload.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !facet.payload.is_object()
    {
        bail!("detector emitted an invalid facet payload")
    }
    Ok(())
}

pub async fn facets(repo: &HistoryRepository, clip_id: &str) -> Result<Vec<FacetDescriptor>> {
    let rows=sqlx::query("SELECT f.facet_id,d.display_name,f.source_representation_id,f.detector_id,f.detector_version,f.payload_json FROM content_clip_facets f JOIN content_facet_definitions d ON d.id=f.facet_id WHERE f.clip_id=? ORDER BY f.facet_id").bind(clip_id).fetch_all(&repo.pool).await?;
    rows.into_iter()
        .map(|r| {
            Ok(FacetDescriptor {
                id: r.get(0),
                display_name: r.get(1),
                source_representation_id: r.get(2),
                detector_id: r.get(3),
                detector_version: r.get(4),
                payload: serde_json::from_str(&r.get::<String, _>(5))?,
            })
        })
        .collect()
}
pub fn renderers() -> Vec<RendererDescriptor> {
    renderer_registry()
        .into_iter()
        .map(|renderer| renderer.descriptor())
        .collect()
}

fn image_view_label(mime: &str) -> &'static str {
    match mime {
        "image/png" => "PNG",
        "image/svg+xml" => "SVG",
        "image/jpeg" => "JPEG",
        "image/tiff" => "TIFF",
        _ => "Image",
    }
}

pub async fn views(
    repo: &HistoryRepository,
    extensions: &ExtensionService,
    clip_id: &str,
) -> Result<ClipViewSet> {
    let detail = repo.detail(clip_id).await?;
    let faithful_first = detail.representations.iter().any(|rep| {
        matches!(
            rep.format_family.as_str(),
            "image" | "files" | "document" | "office"
        )
    });
    let facets = facets(repo, clip_id).await?;
    let mut candidates: Vec<(ClipViewDescriptor, i64, i64)> = Vec::new();
    let mut add_view = |rep: &RepresentationDetail,
                        renderer_id: &str,
                        label: &str,
                        kind: &str,
                        facet_id: Option<String>,
                        _renderer_priority: i32,
                        is_original: bool| {
        let purpose = if renderer_id == "builtin.office" {
            "diagnostic"
        } else if renderer_id == "builtin.original" {
            if kind == "unsupported" {
                "diagnostic"
            } else {
                "source"
            }
        } else if matches!(kind, "json" | "table") {
            "structured"
        } else if facet_id.is_some() {
            "semantic"
        } else {
            "faithful"
        };
        let match_specificity = if facet_id.is_some() { 500 } else { 200 };
        let id = facet_id.as_ref().map_or_else(
            || format!("{}:{}", renderer_id, rep.id),
            |facet_id| format!("{}:{}:{}", renderer_id, rep.id, facet_id),
        );
        candidates.push((
            ClipViewDescriptor {
                id,
                renderer_id: renderer_id.into(),
                label: label.into(),
                source_id: rep.id.clone(),
                mime_type: rep.canonical_mime_type.clone(),
                capability_id: rep.capability_id.clone(),
                facet_id,
                is_original,
                presentation_kind: kind.into(),
                purpose: purpose.into(),
                match_specificity,
                placement: "alternate".into(),
            },
            rep.capture_priority,
            rep.ordinal,
        ));
    };
    for rep in &detail.representations {
        let mime = rep.canonical_mime_type.as_deref().unwrap_or_default();
        let office = rep.format_family == "office";
        if office {
            add_view(rep, "builtin.office", "Office", "office", None, 95, false);
        } else if rep.storage_kind == "file_list" {
            add_view(rep, "builtin.files", "Files", "files", None, 110, false);
        } else if mime == "text/html" {
            add_view(rep, "builtin.html", "HTML", "html", None, 100, false);
            add_view(rep, "builtin.original", "Source", "source", None, 20, true);
        } else if matches!(mime, "text/rtf" | "application/rtf") {
            add_view(
                rep,
                "builtin.rich_text",
                "Rich text",
                "rich_text",
                None,
                90,
                false,
            );
            add_view(rep, "builtin.original", "Source", "source", None, 20, true);
        } else if mime == "application/pdf" {
            add_view(
                rep,
                "builtin.document",
                "Document",
                "document",
                None,
                100,
                false,
            );
        } else if mime.starts_with("image/") && rep.binary_file_id.is_some() {
            add_view(
                rep,
                "builtin.image",
                image_view_label(mime),
                "image",
                None,
                100,
                false,
            );
        } else if mime == "text/plain" {
            add_view(rep, "builtin.text", "Text", "text", None, 50, false);
        } else {
            add_view(
                rep,
                "builtin.original",
                "Details",
                "unsupported",
                None,
                0,
                true,
            );
        }
    }
    for facet in &facets {
        let Some(rep) = detail
            .representations
            .iter()
            .find(|rep| rep.id == facet.source_representation_id)
        else {
            continue;
        };
        let (renderer, kind, priority) = match facet.id.as_str() {
            "core.security.secret" => ("builtin.key_value", "secret", 200),
            "core.token.jwt" => ("builtin.jwt", "jwt", 190),
            "core.link.url" => ("builtin.url", "url", 180),
            "core.contact.email" => ("builtin.key_value", "email", 170),
            "core.value.color" => ("builtin.key_value", "color", 160),
            "core.data.json" => ("builtin.json", "json", 150),
            "core.data.table" => ("builtin.table", "table", 140),
            "core.file.path" => ("builtin.key_value", "path", 130),
            "core.time.date" => (
                "builtin.date",
                if facet.payload["interpretation"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("unix_"))
                {
                    "timestamp"
                } else {
                    "date"
                },
                120,
            ),
            "core.contact.phone" => ("builtin.key_value", "phone", 100),
            "core.math.expression" => ("builtin.key_value", "math", 90),
            "core.text.markdown" => ("builtin.markdown", "markdown", 80),
            "core.text.code" => ("builtin.key_value", "code", 70),
            "core.value.number" => ("builtin.number", "number", 60),
            _ => ("builtin.key_value", "details", 40),
        };
        add_view(
            rep,
            renderer,
            &facet.display_name,
            kind,
            Some(facet.id.clone()),
            priority,
            false,
        );
    }
    for view in extensions
        .renderer_views(repo, clip_id, &detail, &facets)
        .await?
    {
        let rep = detail
            .representations
            .iter()
            .find(|rep| rep.id == view.source_id);
        candidates.push((
            view,
            rep.map_or(i64::MAX, |rep| rep.capture_priority),
            rep.map_or(i64::MAX, |rep| rep.ordinal),
        ));
    }
    let renderer_preferences = preferences(repo).await?;
    candidates.sort_by_key(|(view, capture_priority, ordinal)| {
        let facet_preference = facets
            .iter()
            .find(|facet| view.facet_id.as_deref() == Some(facet.id.as_str()))
            .and_then(|facet| renderer_preferences.by_facet_id.get(&facet.id));
        let mime_preference = view
            .mime_type
            .as_ref()
            .and_then(|mime| renderer_preferences.by_mime_type.get(mime));
        let capability_preference = renderer_preferences
            .by_capability_id
            .get(&view.capability_id);
        let preferred = facet_preference
            .or(capability_preference)
            .or(mime_preference)
            .is_some_and(|id| id == &view.renderer_id);
        let purpose_rank = match (faithful_first, view.purpose.as_str()) {
            (true, "faithful") | (false, "structured") => 0,
            (true, "structured") | (false, "semantic") => 1,
            (true, "semantic") | (false, "faithful") => 2,
            (_, "source") => 3,
            _ => 4,
        };
        (
            !preferred,
            purpose_rank,
            -view.match_specificity,
            *capture_priority,
            *ordinal,
            view.id.clone(),
        )
    });
    let primary_view_id = candidates
        .first()
        .map(|(view, _, _)| view.id.clone())
        .context("clip has no renderable representation")?;
    let presentation_kind = candidates[0].0.presentation_kind.clone();
    let views = candidates
        .into_iter()
        .map(|(mut view, _, _)| {
            if view.id == primary_view_id {
                view.placement = "primary".into();
            }
            view
        })
        .collect();
    Ok(ClipViewSet {
        clip_id: clip_id.into(),
        primary_view_id,
        presentation_kind,
        facets,
        views,
    })
}
pub async fn render(
    repo: &HistoryRepository,
    extensions: &ExtensionService,
    clip_id: &str,
    renderer_id: &str,
    source_id: &str,
    requested_facet_id: Option<&str>,
) -> Result<RenderModel> {
    let detail = repo.detail(clip_id).await?;
    let rep = detail
        .representations
        .iter()
        .find(|r| r.id == source_id)
        .context("representation not found")?;
    let available_facets = facets(repo, clip_id).await?;
    if !renderer_id.starts_with("builtin.") {
        let (source, _) = repo.source_representation(clip_id, source_id).await?;
        let facet = available_facets
            .iter()
            .find(|facet| {
                facet.source_representation_id == source_id
                    && requested_facet_id.is_none_or(|id| id == facet.id)
            })
            .cloned();
        return match extensions.render(repo, renderer_id, source, facet).await {
            Ok(Some(model)) => Ok(model),
            Ok(None) => Ok(RenderModel::Error {
                message: "unknown renderer".into(),
            }),
            Err(error) => {
                eprintln!(
                    "[RENDER] extension renderer {renderer_id} failed: {error}; using Original"
                );
                Ok(original(rep))
            }
        };
    }
    let facet = match renderer_id {
        "builtin.json" => available_facets
            .iter()
            .find(|f| f.id == "core.data.json" && f.source_representation_id == source_id),
        "builtin.table" => available_facets
            .iter()
            .find(|f| f.id == "core.data.table" && f.source_representation_id == source_id),
        "builtin.markdown" => available_facets
            .iter()
            .find(|f| f.id == "core.text.markdown" && f.source_representation_id == source_id),
        "builtin.url" => available_facets
            .iter()
            .find(|f| f.id == "core.link.url" && f.source_representation_id == source_id),
        "builtin.jwt" => available_facets
            .iter()
            .find(|f| f.id == "core.token.jwt" && f.source_representation_id == source_id),
        "builtin.number" => available_facets
            .iter()
            .find(|f| f.id == "core.value.number" && f.source_representation_id == source_id),
        "builtin.date" => available_facets
            .iter()
            .find(|f| f.id == "core.time.date" && f.source_representation_id == source_id),
        "builtin.key_value" => available_facets.iter().find(|f| {
            f.source_representation_id == source_id
                && requested_facet_id.is_none_or(|id| id == f.id)
        }),
        _ => None,
    };
    if let Some(renderer) = renderer_registry()
        .into_iter()
        .find(|renderer| renderer.descriptor().id == renderer_id)
    {
        return match renderer.render(rep, facet) {
            Ok(mut model) => {
                if let RenderModel::Image { ocr, .. } = &mut model {
                    *ocr = crate::artifacts::ocr_presentation(repo, source_id).await?;
                }
                Ok(model)
            }
            Err(error) => {
                // Rendering is derived UI state. A failed rich renderer must
                // never block access to canonical original content.
                eprintln!("[RENDER] renderer {renderer_id} failed: {error}; using Original");
                Ok(original(rep))
            }
        };
    }
    Ok(RenderModel::Error {
        message: "unknown renderer".into(),
    })
}
fn original(rep: &RepresentationDetail) -> RenderModel {
    match &rep.text_value {
        Some(text) => RenderModel::Code {
            language: rep.canonical_mime_type.clone(),
            text: text.clone(),
        },
        None => RenderModel::Unsupported {
            format_key: rep.format_key.clone(),
            mime_type: rep.canonical_mime_type.clone(),
            native_type: rep.native_type.clone(),
            byte_length: rep.byte_length,
        },
    }
}
/// Deliberately small allowlist: no links, remote resources, forms, scripts, styles, or attributes.
#[allow(dead_code)] // Kept as the host-owned sanitization boundary and covered by regression tests.
pub fn sanitize_html(input: &str) -> String {
    let mut out = String::new();
    let mut rest = input;
    while let Some(start) = rest.find('<') {
        out.push_str(&html_escape(&rest[..start]));
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else {
            out.push_str("&lt;");
            out.push_str(&html_escape(after));
            break;
        };
        let tag = after[..end].trim();
        let name = tag
            .trim_start_matches('/')
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "p" | "br"
                | "strong"
                | "b"
                | "em"
                | "i"
                | "code"
                | "pre"
                | "ul"
                | "ol"
                | "li"
                | "h1"
                | "h2"
                | "h3"
                | "blockquote"
                | "table"
                | "thead"
                | "tbody"
                | "tr"
                | "th"
                | "td"
        ) {
            out.push('<');
            if tag.starts_with('/') {
                out.push('/')
            }
            out.push_str(&name);
            out.push('>');
        }
        rest = &after[end + 1..];
    }
    if !rest.is_empty() {
        out.push_str(&html_escape(rest));
    }
    out
}

const MAX_RTF_PRESENTATION_BYTES: usize = 1024 * 1024;

fn render_rtf(source: &str) -> (Option<String>, String) {
    let lower = source.to_ascii_lowercase();
    if source.len() > MAX_RTF_PRESENTATION_BYTES
        || ["\\bin", "\\object", "\\objdata", "\\field", "\\pict"]
            .iter()
            .any(|control| lower.contains(control))
    {
        return (None, source.to_string());
    }
    let parsed = std::panic::catch_unwind(|| rtf_parser::RtfDocument::try_from(source));
    let Ok(Ok(document)) = parsed else {
        return (None, source.to_string());
    };
    let plain_text = document.get_text();
    let mut html = String::from("<p>");
    for block in document.body {
        let mut value = html_escape(&block.text).replace('\n', "<br>");
        let painter = block.painter;
        for (active, tag) in [
            (painter.bold, "strong"),
            (painter.italic, "em"),
            (painter.underline, "u"),
            (painter.strike, "s"),
            (painter.superscript, "sup"),
            (painter.subscript, "sub"),
        ] {
            if active {
                value = format!("<{tag}>{value}</{tag}>");
            }
        }
        html.push_str(&value);
    }
    html.push_str("</p>");
    (Some(html), plain_text)
}
fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
pub async fn preferences(repo: &HistoryRepository) -> Result<RendererPreferences> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='renderer.preferences'",
    )
    .fetch_optional(&repo.pool)
    .await?;
    Ok(value
        .map(|x| serde_json::from_str(&x))
        .transpose()?
        .unwrap_or_default())
}
pub async fn update_preferences(
    repo: &HistoryRepository,
    prefs: &RendererPreferences,
) -> Result<()> {
    let now = now_ms();
    sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES('renderer.preferences',?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(serde_json::to_string(prefs)?).bind(now).bind(now).execute(&repo.pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_tabs_name_the_captured_format() {
        assert_eq!(image_view_label("image/png"), "PNG");
        assert_eq!(image_view_label("image/svg+xml"), "SVG");
        assert_eq!(image_view_label("image/unknown"), "Image");
    }
    use crate::history::{
        CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
    };

    fn source(text: &str) -> TextSource {
        TextSource {
            id: "x".into(),
            mime: Some("text/plain".into()),
            format: "windows:text/plain".into(),
            text: text.into(),
        }
    }

    #[test]
    fn secret_detector_names_precise_credentials() {
        for (value, kind) in [
            ("AKIAIOSFODNN7EXAMPLE", "aws_access_key"),
            ("ghp_0123456789abcdefghijklmnopqrstuvwxyz", "github_token"),
            ("sk_test_0123456789abcdefghijklmnop", "stripe_key"),
            (
                "-----BEGIN PRIVATE KEY-----\nvalue\n-----END PRIVATE KEY-----",
                "private_key",
            ),
        ] {
            let facets = SECRET.detect(&source(value));
            assert_eq!(facets[0].payload["kind"], kind);
            assert_eq!(facets[0].payload["schemaVersion"], 2);
        }
    }

    #[test]
    fn secret_detector_keeps_generic_detection_conservative() {
        assert!(SECRET
            .detect(&source("api_key=Abcdefghijklmnop123456"))
            .first()
            .is_some_and(|facet| facet.payload["kind"] == "credential_assignment"));
        assert!(SECRET
            .detect(&source("aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY"))
            .first()
            .is_some_and(|facet| facet.payload["kind"] == "generic_token"));
        for value in [
            "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.signature",
            "https://example.com/a/long/path/that/is/not/a/secret",
            "550e8400-e29b-41d4-a716-446655440000",
            "this is ordinary prose that happens to be longer than thirty two characters",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
        ] {
            assert!(SECRET.detect(&source(value)).is_empty(), "{value}");
        }
    }
    #[test]
    fn sanitizes_active_html() {
        let safe = sanitize_html(
            "<form action=https://example.com><p onclick=x style=color:red>Hi <img src=https://example.com/x><script>x</script><style>y</style><strong>there</strong></p></form>",
        );
        assert_eq!(safe, "<p>Hi xy<strong>there</strong></p>");
        assert!(!safe.contains("http"));
        assert!(!safe.contains("onclick"));
        assert!(!safe.contains("style="));
    }
    #[test]
    fn rtf_rendering_is_bounded_and_emits_only_safe_formatting() {
        let (html, text) = render_rtf(r#"{\rtf1\ansi Hello {\b bold} {\i italic}.}"#);
        let html = html.expect("valid RTF should render");
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
        assert!(!html.contains("style="));
        assert!(!html.contains("href="));
        assert!(text.contains("Hello"));

        let (unicode_html, unicode_text) = render_rtf(r#"{\rtf1\ansi Unicode 雪}"#);
        assert!(unicode_html.unwrap().contains('雪'));
        assert!(unicode_text.contains('雪'));

        assert!(render_rtf(r#"{\rtf1\bin12 unsafe}"#).0.is_none());
        assert!(render_rtf(r#"{\rtf1{\object\objdata unsafe}}"#).0.is_none());
        assert!(
            render_rtf(r#"{\rtf1{\field{\*\fldinst HYPERLINK "javascript:alert(1)"}}}"#)
                .0
                .is_none()
        );
        assert!(render_rtf(r#"{\rtf1{\pict\pngblip unsafe}}"#).0.is_none());
        assert!(render_rtf(&"x".repeat(MAX_RTF_PRESENTATION_BYTES + 1))
            .0
            .is_none());
        assert!(render_rtf("not rtf").0.is_none());
    }

    #[test]
    fn files_renderer_keeps_order_without_fabricating_metadata() {
        let detail = RepresentationDetail {
            id: "rep".into(),
            format_key: "windows:CF_HDROP".into(),
            canonical_mime_type: None,
            native_type: Some("CF_HDROP".into()),
            storage_kind: "file_list".into(),
            ordinal: 0,
            capture_priority: 1,
            byte_length: 0,
            text_value: None,
            file_references: vec!["C:\\missing\\first.txt".into(), "/tmp/second.txt".into()],
            binary_file_id: None,
            sha256: None,
            capability_id: "windows.files.hdrop".into(),
            format_family: "files".into(),
        };
        let RenderModel::Files { entries } = FILES_RENDERER.render(&detail, None).unwrap() else {
            panic!("expected files model")
        };
        assert_eq!(entries[0].name, "first.txt");
        assert_eq!(entries[1].name, "second.txt");
    }
    #[test]
    fn candidate_routing_keeps_scalar_json_out_of_json_detector() {
        let source = TextSource {
            id: "x".into(),
            mime: None,
            format: "text/plain".into(),
            text: "42".into(),
        };
        assert_eq!(NUMBER.detect(&source).len(), 1);
        assert!(!JSON.candidate(&source));
    }
    #[test]
    fn unix_timestamp_is_both_number_and_date() {
        let source = source("1700000000");
        assert_eq!(NUMBER.detect(&source).len(), 1);
        assert_eq!(DATE.detect(&source).len(), 1);
    }
    #[test]
    fn core_seven_detectors_emit_versioned_payloads() {
        let cases: [(&dyn DetectorContribution, &str); 7] = [
            (&JSON, r#"{"ok":true}"#),
            (&URL, "https://example.com/path"),
            (&JWT, "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."),
            (&NUMBER, "12.5"),
            (&DATE, "2026-08-09T10:00:00Z"),
            (&MARKDOWN, "# Heading"),
            (&TABLE, "name,value\na,1"),
        ];
        for (detector, input) in cases {
            let facets = detector.detect(&source(input));
            assert_eq!(facets.len(), 1, "{} did not detect", detector.id());
            validate_facet(&facets[0], detector).unwrap();
        }
    }
    #[test]
    fn malformed_candidates_do_not_emit_facets() {
        assert!(JSON.detect(&source("{broken")).is_empty());
        assert!(URL.detect(&source("https://")).is_empty());
        assert!(JWT.detect(&source("a.b.c")).is_empty());
        assert!(NUMBER.detect(&source("NaN")).is_empty());
        assert!(DATE.detect(&source("2026-99-99")).is_empty());
        assert!(TABLE.detect(&source("a,b\nonly-one")).is_empty());
    }

    async fn resolver_fixture(
        representations: Vec<CapturedRepresentation>,
    ) -> (
        tempfile::TempDir,
        HistoryRepository,
        ExtensionService,
        String,
    ) {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        initialize(&repo).await.unwrap();
        let extensions = ExtensionService::new(&roots).unwrap();
        let (clip_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations,
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        detect_clip(&repo, &clip_id).await.unwrap();
        (temp, repo, extensions, clip_id)
    }

    #[tokio::test]
    async fn resolver_prefers_higher_capture_priority_html_over_plain_source() {
        let (_temp, repo, extensions, clip_id) = resolver_fixture(vec![
            CapturedRepresentation {
                format_key: "windows:HTML Format".into(),
                canonical_mime_type: Some("text/html".into()),
                native_type: Some("HTML Format".into()),
                platform: "windows".into(),
                capture_priority: 10,
                payload: CapturedPayload::Text("<strong>Example</strong>".into()),
            },
            CapturedRepresentation {
                format_key: "windows:CF_UNICODETEXT".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("CF_UNICODETEXT".into()),
                platform: "windows".into(),
                capture_priority: 20,
                payload: CapturedPayload::Text("Example".into()),
            },
        ])
        .await;

        let result = views(&repo, &extensions, &clip_id).await.unwrap();
        assert_eq!(result.presentation_kind, "html");
        assert_eq!(
            result
                .views
                .iter()
                .find(|view| view.id == result.primary_view_id)
                .unwrap()
                .placement,
            "primary"
        );
    }

    #[tokio::test]
    async fn resolver_prefers_structured_json_over_html_wrapper() {
        let (_temp, repo, extensions, clip_id) = resolver_fixture(vec![
            CapturedRepresentation {
                format_key: "windows:HTML Format".into(),
                canonical_mime_type: Some("text/html".into()),
                native_type: Some("HTML Format".into()),
                platform: "windows".into(),
                capture_priority: 10,
                payload: CapturedPayload::Text("<pre>{\"ok\":true}</pre>".into()),
            },
            CapturedRepresentation {
                format_key: "windows:CF_UNICODETEXT".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("CF_UNICODETEXT".into()),
                platform: "windows".into(),
                capture_priority: 20,
                payload: CapturedPayload::Text("{\"ok\":true}".into()),
            },
        ])
        .await;
        let result = views(&repo, &extensions, &clip_id).await.unwrap();
        let primary = result
            .views
            .iter()
            .find(|view| view.id == result.primary_view_id)
            .unwrap();
        assert_eq!(primary.renderer_id, "builtin.json");
        assert_eq!(primary.purpose, "structured");
    }

    #[tokio::test]
    async fn resolver_prefers_formatted_alternate_over_opaque_office_native() {
        let (_temp, repo, extensions, clip_id) = resolver_fixture(vec![
            CapturedRepresentation {
                format_key: "windows:Biff12".into(),
                canonical_mime_type: None,
                native_type: Some("Biff12".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Binary(vec![1, 2, 3]),
            },
            CapturedRepresentation {
                format_key: "windows:HTML Format".into(),
                canonical_mime_type: Some("text/html".into()),
                native_type: Some("HTML Format".into()),
                platform: "windows".into(),
                capture_priority: 20,
                payload: CapturedPayload::Text("<table><tr><td>Useful</td></tr></table>".into()),
            },
        ])
        .await;
        let result = views(&repo, &extensions, &clip_id).await.unwrap();
        let primary = result
            .views
            .iter()
            .find(|view| view.id == result.primary_view_id)
            .unwrap();
        assert_eq!(primary.renderer_id, "builtin.html");
        assert!(result
            .views
            .iter()
            .any(|view| view.renderer_id == "builtin.office"));
    }

    #[tokio::test]
    async fn resolver_renders_ordered_file_list_paths() {
        let paths = vec![
            r"C:\Users\Example\Desktop\first.png".to_string(),
            r"C:\Users\Example\Desktop\second.txt".to_string(),
        ];
        let (_temp, repo, extensions, clip_id) = resolver_fixture(vec![CapturedRepresentation {
            format_key: "windows:CF_HDROP".into(),
            canonical_mime_type: Some("application/x-file-list".into()),
            native_type: Some("CF_HDROP".into()),
            platform: "windows".into(),
            capture_priority: 1,
            payload: CapturedPayload::Files(paths.clone()),
        }])
        .await;

        let view_set = views(&repo, &extensions, &clip_id).await.unwrap();
        assert_eq!(view_set.presentation_kind, "files");
        let primary = view_set
            .views
            .iter()
            .find(|view| view.id == view_set.primary_view_id)
            .unwrap();
        assert_eq!(primary.renderer_id, "builtin.files");

        let model = render(
            &repo,
            &extensions,
            &clip_id,
            &primary.renderer_id,
            &primary.source_id,
            None,
        )
        .await
        .unwrap();
        let RenderModel::Files { entries } = model else {
            panic!("file-list view must render a files model");
        };
        assert_eq!(
            entries
                .iter()
                .map(|entry| (entry.path.as_str(), entry.name.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (paths[0].as_str(), "first.png"),
                (paths[1].as_str(), "second.txt"),
            ]
        );
        assert!(matches!(
            &repo.source_representation(&clip_id, &primary.source_id).await.unwrap().0.payload,
            CapturedPayload::Files(files) if files == &paths
        ));
    }

    #[tokio::test]
    async fn resolver_honors_user_preference_before_office_utility_order() {
        let (_temp, repo, extensions, clip_id) = resolver_fixture(vec![
            CapturedRepresentation {
                format_key: "windows:Biff12".into(),
                canonical_mime_type: None,
                native_type: Some("Biff12".into()),
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Binary(vec![1, 2, 3]),
            },
            CapturedRepresentation {
                format_key: "windows:HTML Format".into(),
                canonical_mime_type: Some("text/html".into()),
                native_type: Some("HTML Format".into()),
                platform: "windows".into(),
                capture_priority: 10,
                payload: CapturedPayload::Text("<p>Formatted</p>".into()),
            },
            CapturedRepresentation {
                format_key: "windows:CF_UNICODETEXT".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("CF_UNICODETEXT".into()),
                platform: "windows".into(),
                capture_priority: 20,
                payload: CapturedPayload::Text("Preferred text".into()),
            },
        ])
        .await;
        let mut preferences = RendererPreferences::default();
        preferences
            .by_mime_type
            .insert("text/plain".into(), "builtin.text".into());
        update_preferences(&repo, &preferences).await.unwrap();

        let result = views(&repo, &extensions, &clip_id).await.unwrap();
        let primary = result
            .views
            .iter()
            .find(|view| view.id == result.primary_view_id)
            .unwrap();
        assert_eq!(primary.renderer_id, "builtin.text");
    }

    #[tokio::test]
    async fn resolver_keeps_number_and_timestamp_as_additive_views() {
        let (_temp, repo, extensions, clip_id) = resolver_fixture(vec![CapturedRepresentation {
            format_key: "windows:CF_UNICODETEXT".into(),
            canonical_mime_type: Some("text/plain".into()),
            native_type: Some("CF_UNICODETEXT".into()),
            platform: "windows".into(),
            capture_priority: 10,
            payload: CapturedPayload::Text("1700000000".into()),
        }])
        .await;

        let result = views(&repo, &extensions, &clip_id).await.unwrap();
        assert_eq!(result.presentation_kind, "timestamp");
        assert!(result
            .views
            .iter()
            .any(|view| view.facet_id.as_deref() == Some("core.value.number")));
        assert!(result
            .views
            .iter()
            .any(|view| view.facet_id.as_deref() == Some("core.time.date")));
    }
}
