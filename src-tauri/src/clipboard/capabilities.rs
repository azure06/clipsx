use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::{collections::BTreeSet, sync::OnceLock};

pub const POLICY_JSON: &str = include_str!("../../../docs/platform-format-matrix.json");
pub const POLICY_SCHEMA_JSON: &str =
    include_str!("../../../docs/platform-format-matrix.schema.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityMatrix {
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub version: u32,
    pub capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capability {
    pub id: String,
    pub platform: String,
    pub family: String,
    pub selectors: Vec<Selector>,
    pub settings_gate: Option<String>,
    pub capture: CapturePolicy,
    pub reader: Option<ReaderCodec>,
    pub representation: Option<RepresentationPolicy>,
    pub write_back: WriteBackPolicy,
    pub unreadable: UnreadablePolicy,
    pub bundle: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Selector {
    Standard {
        id: u32,
        name: String,
    },
    Exact {
        name: String,
    },
    Prefix {
        prefix: String,
        suffix: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapturePolicy {
    Always,
    Conditional,
    DiagnosticOnly,
    Redundant,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnreadablePolicy {
    Skip,
    RejectSnapshot,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReaderCodec {
    WindowsUnicodeText,
    WindowsHtml,
    WindowsRtf,
    WindowsHdrop,
    WindowsPng,
    WindowsDibNormalizedPng,
    WindowsHglobalBytes,
    WindowsOfficeHglobal,
    MacosData,
    MacosDataAllowEmpty,
    MacosFileUrls,
    X11Bytes,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepresentationPolicy {
    pub storage_kind: String,
    pub mime_type: Option<String>,
    pub byte_contract: String,
    pub renderer: String,
    pub priority: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteBackPolicy {
    pub policy: WritePolicy,
    pub writer: Option<WriterCodec>,
    pub priority: i64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WritePolicy {
    Unsupported,
    Supported,
    Exact,
    Normalized,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WriterCodec {
    WindowsUnicodeText,
    WindowsHtml,
    WindowsRtf,
    WindowsHdrop,
    WindowsPng,
    WindowsRegisteredBytes,
    MacosData,
    MacosFileUrls,
    X11Bytes,
}

impl Selector {
    fn matches(&self, numeric_id: Option<u32>, name: &str) -> bool {
        match self {
            Self::Standard { id, name: expected } => numeric_id == Some(*id) || name == expected,
            Self::Exact { name: expected } => name == expected,
            Self::Prefix { prefix, suffix } => {
                name.starts_with(prefix)
                    && suffix.as_ref().is_none_or(|suffix| name.ends_with(suffix))
            }
        }
    }

    fn exact_key(&self, platform: &str) -> Option<String> {
        match self {
            Self::Standard { id, .. } => Some(format!("{platform}:standard:{id}")),
            Self::Exact { name } => Some(format!("{platform}:exact:{name}")),
            Self::Prefix { .. } => None,
        }
    }
}

impl CapabilityMatrix {
    pub fn parse(value: &str) -> Result<Self> {
        let matrix: Self =
            serde_json::from_str(value).context("capability matrix is not valid JSON")?;
        matrix.validate()?;
        Ok(matrix)
    }

    pub fn validate(&self) -> Result<()> {
        if self.version != 2 {
            bail!("unsupported capability matrix version {}", self.version);
        }
        if self.schema.as_deref() != Some("./platform-format-matrix.schema.json") {
            bail!("capability matrix must reference the bundled JSON Schema");
        }
        if self.capabilities.is_empty() {
            bail!("capability matrix is empty");
        }
        let mut ids = BTreeSet::new();
        let mut exact_selectors = BTreeSet::new();
        for capability in &self.capabilities {
            if !ids.insert(&capability.id) {
                bail!("duplicate capability ID {}", capability.id);
            }
            if !matches!(
                capability.platform.as_str(),
                "windows" | "macos" | "linux_x11"
            ) {
                bail!("invalid platform for {}", capability.id);
            }
            if capability.selectors.is_empty() {
                bail!("capability {} has no selectors", capability.id);
            }
            for selector in &capability.selectors {
                if let Selector::Prefix { prefix, .. } = selector {
                    if prefix.len() < 3 {
                        bail!("capability {} has an unsafe broad prefix", capability.id);
                    }
                }
                if let Some(key) = selector.exact_key(&capability.platform) {
                    if !exact_selectors.insert(key) {
                        bail!(
                            "capability {} conflicts with another exact selector",
                            capability.id
                        );
                    }
                }
            }
            let captures = matches!(
                capability.capture,
                CapturePolicy::Always | CapturePolicy::Conditional
            );
            if captures != capability.reader.is_some()
                || captures != capability.representation.is_some()
            {
                bail!(
                    "capability {} has an inconsistent capture codec",
                    capability.id
                );
            }
            let writes = capability.write_back.policy != WritePolicy::Unsupported;
            if writes != capability.write_back.writer.is_some() {
                bail!("capability {} has an inconsistent writer", capability.id);
            }
            if let Some(representation) = &capability.representation {
                if !matches!(
                    representation.storage_kind.as_str(),
                    "text" | "binary_asset" | "file_list"
                ) {
                    bail!("capability {} has an invalid storage kind", capability.id);
                }
                if representation.byte_contract.is_empty() || representation.renderer.is_empty() {
                    bail!(
                        "capability {} has an incomplete representation contract",
                        capability.id
                    );
                }
            }
            if capability
                .bundle
                .as_ref()
                .is_some_and(|bundle| bundle.len() < 3)
            {
                bail!("capability {} has an invalid bundle ID", capability.id);
            }
        }
        Ok(())
    }

    pub fn resolve(
        &self,
        platform: &str,
        numeric_id: Option<u32>,
        name: &str,
    ) -> Option<&Capability> {
        self.capabilities
            .iter()
            .filter(|capability| capability.platform == platform)
            .filter(|capability| {
                capability
                    .selectors
                    .iter()
                    .any(|selector| selector.matches(numeric_id, name))
            })
            .min_by_key(|capability| {
                let exact = capability.selectors.iter().any(|selector| {
                    matches!(selector, Selector::Standard { .. } | Selector::Exact { .. })
                        && selector.matches(numeric_id, name)
                });
                (
                    !exact,
                    capability
                        .representation
                        .as_ref()
                        .map_or(i64::MAX, |value| value.priority),
                )
            })
    }

    pub fn by_id(&self, id: &str) -> Option<&Capability> {
        self.capabilities
            .iter()
            .find(|capability| capability.id == id)
    }
}

static MATRIX: OnceLock<CapabilityMatrix> = OnceLock::new();

pub fn matrix() -> &'static CapabilityMatrix {
    MATRIX.get_or_init(|| {
        CapabilityMatrix::parse(POLICY_JSON)
            .expect("embedded clipboard capability matrix must be valid")
    })
}

pub fn validate_embedded() -> Result<()> {
    let schema: serde_json::Value = serde_json::from_str(POLICY_SCHEMA_JSON)
        .context("capability matrix JSON Schema is invalid")?;
    if schema["properties"]["version"]["const"] != 2 {
        bail!("capability matrix JSON Schema has the wrong version");
    }
    CapabilityMatrix::parse(POLICY_JSON).map(|_| ())
}

pub fn resolve(platform: &str, numeric_id: Option<u32>, name: &str) -> Option<&'static Capability> {
    matrix().resolve(platform, numeric_id, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_matrix_is_valid_and_covers_every_platform() {
        let schema: serde_json::Value = serde_json::from_str(POLICY_SCHEMA_JSON).unwrap();
        assert_eq!(schema["properties"]["version"]["const"], 2);
        let matrix = CapabilityMatrix::parse(POLICY_JSON).unwrap();
        for platform in ["windows", "macos", "linux_x11"] {
            assert!(matrix
                .capabilities
                .iter()
                .any(|entry| entry.platform == platform));
        }
    }

    #[test]
    fn exact_selectors_win_over_broad_office_prefixes() {
        let capability = matrix()
            .resolve("macos", None, "com.microsoft.image-svg-xml")
            .unwrap();
        assert_eq!(capability.id, "macos.image.svg");
    }

    #[test]
    fn unknown_formats_do_not_resolve() {
        assert!(matrix()
            .resolve("windows", None, "Mystery Private Bytes")
            .is_none());
    }

    #[test]
    fn powerpoint_package_is_captured_but_internal_metadata_is_not() {
        let package = matrix()
            .resolve("windows", None, "PowerPoint 14.0 Slides Package")
            .unwrap();
        assert_eq!(package.id, "windows.office.powerpoint.package");
        assert_eq!(package.capture, CapturePolicy::Conditional);

        for name in [
            "PowerPoint 12.0 Internal Slides",
            "PowerPoint 12.0 Internal Theme",
            "PowerPoint 12.0 Internal Color Scheme",
        ] {
            let metadata = matrix().resolve("windows", None, name).unwrap();
            assert_eq!(metadata.id, "windows.office.powerpoint.internal");
            assert_eq!(metadata.capture, CapturePolicy::DiagnosticOnly);
        }
    }
}
