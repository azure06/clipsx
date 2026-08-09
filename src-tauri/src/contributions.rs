//! Contribution host. Built-ins use the same narrow contracts intended for future WASM adapters.
use crate::{
    contracts::RenderModel,
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
    pub priority: i32,
    pub trusted_html: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipViewDescriptor {
    pub id: String,
    pub renderer_id: String,
    pub label: String,
    pub source_id: String,
    pub mime_type: Option<String>,
    pub facet_id: Option<String>,
    pub is_original: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipViewSet {
    pub clip_id: String,
    pub facets: Vec<FacetDescriptor>,
    pub views: Vec<ClipViewDescriptor>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RendererPreferences {
    pub by_mime_type: BTreeMap<String, String>,
    pub by_facet_id: BTreeMap<String, String>,
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
    priority: i32,
    trusted_html: bool,
) -> RendererDescriptor {
    RendererDescriptor {
        id: id.into(),
        version: "1".into(),
        display_name: name.into(),
        priority,
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
        Ok(RenderModel::Html {
            sanitized_html: sanitize_html(r.text_value.as_deref().context("HTML unavailable")?),
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
            artifact_id: r.binary_file_id.clone().context("image unavailable")?,
        })
    }
}
impl RendererContribution for OfficeRenderer {
    fn descriptor(&self) -> RendererDescriptor {
        renderer_descriptor("builtin.office", "Office/native", 95, false)
    }
    fn render(&self, r: &RepresentationDetail, _: Option<&FacetDescriptor>) -> Result<RenderModel> {
        Ok(RenderModel::KeyValue {
            entries: vec![
                ("format".into(), r.format_key.clone()),
                (
                    "native type".into(),
                    r.native_type.clone().unwrap_or_default(),
                ),
                ("bytes".into(), r.byte_length.to_string()),
            ],
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
    fn render(&self, _: &RepresentationDetail, f: Option<&FacetDescriptor>) -> Result<RenderModel> {
        let payload = &f.context("facet unavailable")?.payload;
        let entries = match payload {
            Value::Object(map) => map
                .iter()
                .map(|(k, v)| (k.clone(), v.to_string()))
                .collect(),
            value => vec![("value".into(), value.to_string())],
        };
        Ok(RenderModel::KeyValue { entries })
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
                KEY_VALUE_RENDERER.render(representation, facet)
            }
        }
    };
}
key_value_renderer!(UrlRenderer, "builtin.url", "URL", 85);
key_value_renderer!(JwtRenderer, "builtin.jwt", "JWT", 85);
key_value_renderer!(NumberRenderer, "builtin.number", "Number", 75);
key_value_renderer!(DateRenderer, "builtin.date", "Date/time", 75);
static ORIGINAL_RENDERER: OriginalRenderer = OriginalRenderer;
static TEXT_RENDERER: TextRenderer = TextRenderer;
static HTML_RENDERER: HtmlRenderer = HtmlRenderer;
static MARKDOWN_RENDERER: MarkdownRenderer = MarkdownRenderer;
static IMAGE_RENDERER: ImageRenderer = ImageRenderer;
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
        "Date/time"
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
        "Delimited table"
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

static JSON: JsonDetector = JsonDetector;
static URL: UrlDetector = UrlDetector;
static JWT: JwtDetector = JwtDetector;
static NUMBER: NumberDetector = NumberDetector;
static DATE: DateDetector = DateDetector;
static MARKDOWN: MarkdownDetector = MarkdownDetector;
static TABLE: TableDetector = TableDetector;
fn detectors() -> Vec<&'static dyn DetectorContribution> {
    vec![&JSON, &URL, &JWT, &NUMBER, &DATE, &MARKDOWN, &TABLE]
}

pub async fn initialize(repo: &HistoryRepository) -> Result<()> {
    for detector in detectors() {
        sqlx::query("INSERT INTO content_facet_definitions(id,owner_id,version,display_name) VALUES(?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET version=excluded.version,display_name=excluded.display_name").bind(detector.id()).bind("builtin").bind(detector.version()).bind(detector.name()).execute(&repo.pool).await?;
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
pub async fn views(repo: &HistoryRepository, clip_id: &str) -> Result<ClipViewSet> {
    let detail = repo.detail(clip_id).await?;
    let facets = facets(repo, clip_id).await?;
    let mut views = Vec::new();
    for rep in &detail.representations {
        views.push(ClipViewDescriptor {
            id: format!("original:{}", rep.id),
            renderer_id: "builtin.original".into(),
            label: "Original".into(),
            source_id: rep.id.clone(),
            mime_type: rep.canonical_mime_type.clone(),
            facet_id: None,
            is_original: true,
        });
        if rep.canonical_mime_type.as_deref() == Some("text/html") {
            views.push(ClipViewDescriptor {
                id: format!("html:{}", rep.id),
                renderer_id: "builtin.html".into(),
                label: "HTML".into(),
                source_id: rep.id.clone(),
                mime_type: rep.canonical_mime_type.clone(),
                facet_id: None,
                is_original: false,
            });
        }
        if rep.canonical_mime_type.as_deref() == Some("text/plain") {
            views.push(ClipViewDescriptor {
                id: format!("text:{}", rep.id),
                renderer_id: "builtin.text".into(),
                label: "Text".into(),
                source_id: rep.id.clone(),
                mime_type: rep.canonical_mime_type.clone(),
                facet_id: None,
                is_original: false,
            });
        }
        if rep
            .canonical_mime_type
            .as_deref()
            .is_some_and(|mime| mime.starts_with("image/"))
            && rep.binary_file_id.is_some()
        {
            views.push(ClipViewDescriptor {
                id: format!("image:{}", rep.id),
                renderer_id: "builtin.image".into(),
                label: "Image".into(),
                source_id: rep.id.clone(),
                mime_type: rep.canonical_mime_type.clone(),
                facet_id: None,
                is_original: false,
            });
        }
        if rep.native_type.as_deref().is_some_and(|native| {
            let n = native.to_ascii_lowercase();
            n.contains("office")
                || n.contains("microsoft")
                || n.contains("powerpoint")
                || n.contains("excel")
                || n.contains("word")
        }) {
            views.push(ClipViewDescriptor {
                id: format!("office:{}", rep.id),
                renderer_id: "builtin.office".into(),
                label: "Office/native".into(),
                source_id: rep.id.clone(),
                mime_type: rep.canonical_mime_type.clone(),
                facet_id: None,
                is_original: false,
            });
        }
    }
    for facet in &facets {
        let renderer = match facet.id.as_str() {
            "core.data.json" => "builtin.json",
            "core.data.table" => "builtin.table",
            "core.text.markdown" => "builtin.markdown",
            "core.link.url" => "builtin.url",
            "core.token.jwt" => "builtin.jwt",
            "core.value.number" => "builtin.number",
            "core.time.date" => "builtin.date",
            _ => "builtin.key_value",
        };
        views.push(ClipViewDescriptor {
            id: format!("{}:{}", renderer, facet.source_representation_id),
            renderer_id: renderer.into(),
            label: facet.display_name.clone(),
            source_id: facet.source_representation_id.clone(),
            mime_type: None,
            facet_id: Some(facet.id.clone()),
            is_original: false,
        });
    }
    let renderer_preferences = preferences(repo).await?;
    views.sort_by_key(|view| {
        let facet_preference = facets
            .iter()
            .find(|facet| view.facet_id.as_deref() == Some(facet.id.as_str()))
            .and_then(|facet| renderer_preferences.by_facet_id.get(&facet.id));
        let mime_preference = view
            .mime_type
            .as_ref()
            .and_then(|mime| renderer_preferences.by_mime_type.get(mime));
        if facet_preference
            .or(mime_preference)
            .is_some_and(|id| id == &view.renderer_id)
        {
            0
        } else if view.is_original {
            2
        } else {
            1
        }
    });
    Ok(ClipViewSet {
        clip_id: clip_id.into(),
        facets,
        views,
    })
}
pub async fn render(
    repo: &HistoryRepository,
    clip_id: &str,
    renderer_id: &str,
    source_id: &str,
) -> Result<RenderModel> {
    let detail = repo.detail(clip_id).await?;
    let rep = detail
        .representations
        .iter()
        .find(|r| r.id == source_id)
        .context("representation not found")?;
    let available_facets = facets(repo, clip_id).await?;
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
        "builtin.key_value" => available_facets
            .iter()
            .find(|f| f.source_representation_id == source_id),
        _ => None,
    };
    if let Some(renderer) = renderer_registry()
        .into_iter()
        .find(|renderer| renderer.descriptor().id == renderer_id)
    {
        return Ok(renderer
            .render(rep, facet)
            .unwrap_or_else(|error| RenderModel::Error {
                message: format!("renderer failed: {error}"),
            }));
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
        None => RenderModel::Text {
            text: format!("{} ({} bytes)", rep.format_key, rep.byte_length),
        },
    }
}
/// Deliberately small allowlist: no links, remote resources, forms, scripts, styles, or attributes.
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
    sqlx::query("INSERT INTO config_profile_values(key,value_json,updated_at) VALUES('renderer.preferences',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").bind(serde_json::to_string(prefs)?).bind(now_ms()).execute(&repo.pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(text: &str) -> TextSource {
        TextSource {
            id: "x".into(),
            mime: Some("text/plain".into()),
            format: "windows:text/plain".into(),
            text: text.into(),
        }
    }
    #[test]
    fn sanitizes_active_html() {
        let safe = sanitize_html(
            "<p onclick=x>Hi <img src=x><script>x</script><strong>there</strong></p>",
        );
        assert_eq!(safe, "<p>Hi x<strong>there</strong></p>");
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
}
