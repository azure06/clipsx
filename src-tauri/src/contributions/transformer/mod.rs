//! Transformer metadata. Execution and results are owned by extension jobs.

use serde::Serialize;
use serde_json::Value;

pub(crate) const MAX_OUTPUT_BYTES: usize = 14 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformerDescriptor {
    pub id: String,
    pub package_id: String,
    pub version: String,
    pub label: String,
    pub icon: Option<String>,
    pub icon_svg: Option<String>,
    pub icon_svg_dark: Option<String>,
    pub icon_scale: f32,
    pub parameter_schema: Value,
    pub input_limit_bytes: usize,
    pub timeout_ms: u64,
    pub execution: String,
    pub consent_required: bool,
    pub http_origins: Vec<String>,
    pub providers: Vec<String>,
    pub setups: Vec<crate::extensions::TransformerSetup>,
    pub default_view: crate::extensions::ResultView,
    pub result_controls: Vec<crate::extensions::ResultControl>,
    pub provider_available: bool,
}
