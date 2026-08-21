use std::collections::BTreeSet;

use anyhow::{bail, Context, Result};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use super::API_VERSION;

const MAX_MANIFEST_BYTES: usize = 256 * 1024;
const MAX_SELECTOR_VALUES: usize = 32;
const MAX_HTTP_RESPONSE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContributionKind {
    Detector,
    Renderer,
    Transformer,
    Action,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionPlacement {
    PreviewToolbar,
    ActionMenu,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UiSurface {
    Detail,
    Dialog,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewPurpose {
    Faithful,
    Structured,
    Semantic,
    Source,
    Diagnostic,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RenderSurface {
    Detail,
    Compact,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionClass {
    #[default]
    Local,
    CapabilityBacked,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionEffect {
    Preview,
    Copy,
    Paste,
    SaveAsClip,
    OpenHttpsUrl,
    Notification,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionDisposition {
    Preview,
    Copy,
    Paste,
    SaveAsClip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ActionHandler {
    Guest,
    TransformerPreset {
        transformer_id: String,
        #[serde(default = "empty_object")]
        parameters: Value,
        disposition: ActionDisposition,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ContributionMatcher {
    pub mime_types: Vec<String>,
    pub format_keys: Vec<String>,
    pub capability_ids: Vec<String>,
    pub format_families: Vec<String>,
    pub facet_ids: Vec<String>,
    pub storage_kinds: Vec<String>,
}

impl ContributionMatcher {
    pub fn is_empty(&self) -> bool {
        self.mime_types.is_empty()
            && self.format_keys.is_empty()
            && self.capability_ids.is_empty()
            && self.format_families.is_empty()
            && self.facet_ids.is_empty()
            && self.storage_kinds.is_empty()
    }

    fn validate(&self) -> Result<()> {
        for values in [
            &self.mime_types,
            &self.format_keys,
            &self.capability_ids,
            &self.format_families,
            &self.facet_ids,
            &self.storage_kinds,
        ] {
            if values.len() > MAX_SELECTOR_VALUES
                || values
                    .iter()
                    .any(|value| value.is_empty() || value.len() > 256)
            {
                bail!("extension matcher exceeds its limits");
            }
        }
        if self
            .storage_kinds
            .iter()
            .any(|value| !matches!(value.as_str(), "text" | "binary_asset" | "file_list"))
        {
            bail!("extension matcher contains an unsupported storage kind");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestContribution {
    pub id: String,
    pub kind: ContributionKind,
    pub display_name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub matchers: Vec<ContributionMatcher>,
    #[serde(default)]
    pub emits_facet_ids: Vec<String>,
    pub purpose: Option<ViewPurpose>,
    #[serde(default)]
    pub surfaces: Vec<RenderSurface>,
    #[serde(default)]
    pub execution: ExecutionClass,
    pub icon: Option<String>,
    /// A package-owned SVG under `icons/`. It is validated while the package is
    /// installed and is always rendered as an image, never injected as markup.
    pub icon_asset: Option<String>,
    #[serde(default)]
    pub placements: Vec<ActionPlacement>,
    #[serde(default)]
    pub ui_surfaces: Vec<UiSurface>,
    /// A package-relative entrypoint under `ui/` for a detail/dialog webview.
    pub ui_entry: Option<String>,
    #[serde(default)]
    pub effects: Vec<ActionEffect>,
    pub handler: Option<ActionHandler>,
    #[serde(default = "empty_object")]
    pub parameter_schema: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPermissions {
    pub http: Vec<HttpPermission>,
    pub external_navigation: Vec<ExternalNavigationPermission>,
    pub credentials: Vec<CredentialPermission>,
    #[serde(default)]
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalNavigationPermission {
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpPermission {
    pub origin: String,
    pub path_patterns: Vec<String>,
    #[serde(default)]
    pub methods: Vec<String>,
    pub max_request_bytes: u64,
    pub max_response_bytes: u64,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialPermission {
    pub id: String,
    pub label: String,
    pub placement: String,
}

fn default_version() -> String {
    "1.0.0".into()
}
fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    /// The old pre-release v2 draft did not carry this field. Requiring it is
    /// the deliberate clean break that prevents a second compatibility runtime.
    pub contract_revision: u32,
    pub package_id: String,
    pub version: String,
    pub api_version: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub permissions: ExtensionPermissions,
    #[serde(default)]
    pub contributions: Vec<ManifestContribution>,
}

impl ExtensionManifest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            bail!("extension manifest exceeds 256 KiB");
        }
        let source = std::str::from_utf8(bytes)?;
        let value: toml::Value =
            toml::from_str(source).context("extension manifest is not valid TOML")?;
        if value.get("schemaVersion").and_then(toml::Value::as_integer) == Some(1) {
            bail!("Extension API v1 packages are incompatible; rebuild this package for API v2");
        }
        if value.get("contractRevision").is_none() {
            bail!("obsolete Extension API v2 draft package; rebuild with contractRevision = 2");
        }
        let manifest: Self = toml::from_str(source)
            .context("extension manifest is not valid Extension API v2 TOML")?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version == 1 {
            bail!("Extension API v1 packages are incompatible; rebuild this package for API v2");
        }
        if self.schema_version != 2 {
            bail!("unsupported extension manifest schema; expected schemaVersion = 2");
        }
        if self.contract_revision != 2 {
            bail!("unsupported Extension API v2 contract revision; expected contractRevision = 2");
        }
        valid_id(&self.package_id, "package")?;
        Version::parse(&self.version).context("extension version is not semantic version")?;
        let requirement = VersionReq::parse(&self.api_version)
            .context("extension API version requirement is invalid")?;
        let host = Version::parse(API_VERSION)?;
        if !requirement.matches(&host) {
            bail!("extension requires an incompatible ClipsX Extension API");
        }
        if self.display_name.trim().is_empty() || self.display_name.len() > 120 {
            bail!("extension display name must be between 1 and 120 characters");
        }
        if self.description.len() > 2_000 || self.license.len() > 200 {
            bail!("extension metadata exceeds its size limit");
        }
        if self.contributions.is_empty() || self.contributions.len() > 32 {
            bail!("extension must declare between one and 32 contributions");
        }
        self.validate_permissions()?;

        let mut ids = BTreeSet::new();
        for contribution in &self.contributions {
            valid_id(&contribution.id, "contribution")?;
            if !ids.insert(&contribution.id) {
                bail!("extension contribution IDs must be unique");
            }
            Version::parse(&contribution.version)
                .context("extension contribution version is not semantic version")?;
            if contribution.display_name.trim().is_empty()
                || contribution.display_name.len() > 120
                || contribution.matchers.len() > 16
                || contribution.emits_facet_ids.len() > 32
            {
                bail!("extension contribution declaration exceeds its limits");
            }
            for matcher in &contribution.matchers {
                matcher.validate()?;
            }
            if !contribution.parameter_schema.is_object()
                || contribution.parameter_schema.to_string().len() > 64 * 1024
            {
                bail!("extension parameter schema must be a bounded JSON object");
            }
            self.validate_contribution(contribution)?;
        }
        Ok(())
    }

    fn validate_contribution(&self, contribution: &ManifestContribution) -> Result<()> {
        let has_matcher = contribution
            .matchers
            .iter()
            .any(|matcher| !matcher.is_empty());
        if matches!(
            contribution.kind,
            ContributionKind::Renderer | ContributionKind::Action
        ) && !has_matcher
        {
            bail!("renderer and action contributions require a non-empty matcher");
        }
        match contribution.kind {
            ContributionKind::Renderer => {
                if contribution.purpose.is_none() || contribution.surfaces.is_empty() {
                    bail!("renderer contributions require purpose and at least one surface");
                }
                if contribution.handler.is_some() || !contribution.effects.is_empty() {
                    bail!("renderer contributions cannot declare action handlers or effects");
                }
            }
            ContributionKind::Action => {
                if contribution.handler.is_none() || contribution.effects.is_empty() {
                    bail!("action contributions require a handler and at least one effect");
                }
                if contribution.purpose.is_some() || !contribution.surfaces.is_empty() {
                    bail!("action contributions cannot declare renderer purpose or surfaces");
                }
                if contribution.placements.is_empty() {
                    bail!("action contributions require at least one placement");
                }
                if let Some(ActionHandler::TransformerPreset { transformer_id, .. }) =
                    &contribution.handler
                {
                    valid_id(transformer_id, "transformer reference")?;
                    let valid = self.contributions.iter().any(|candidate| {
                        candidate.id == *transformer_id
                            && candidate.kind == ContributionKind::Transformer
                    });
                    if !valid {
                        bail!("action references an unknown local transformer");
                    }
                }
            }
            ContributionKind::Detector | ContributionKind::Transformer => {
                if contribution.purpose.is_some()
                    || !contribution.surfaces.is_empty()
                    || contribution.handler.is_some()
                    || !contribution.effects.is_empty()
                {
                    bail!("detector and transformer contributions contain unrelated fields");
                }
                if contribution.kind == ContributionKind::Detector
                    && contribution.emits_facet_ids.is_empty()
                {
                    bail!("detector contributions must declare emitted facet IDs");
                }
                if !contribution.placements.is_empty()
                    || !contribution.ui_surfaces.is_empty()
                    || contribution.ui_entry.is_some()
                {
                    bail!("detector and transformer contributions cannot declare UI surfaces or action placement");
                }
            }
        }
        if contribution.kind != ContributionKind::Action && !contribution.placements.is_empty() {
            bail!("only action contributions may declare action placement");
        }
        if contribution.ui_surfaces.is_empty() != contribution.ui_entry.is_none() {
            bail!("custom UI requires both uiEntry and at least one UI surface");
        }
        if let Some(entry) = &contribution.ui_entry {
            valid_ui_path(entry)?;
        }
        if contribution.kind != ContributionKind::Detector
            && !contribution.emits_facet_ids.is_empty()
        {
            bail!("only detector contributions may declare emitted facet IDs");
        }
        if contribution.execution == ExecutionClass::CapabilityBacked
            && self.permissions.http.is_empty()
        {
            bail!("capability-backed contributions require an HTTP permission declaration");
        }
        if contribution.execution == ExecutionClass::CapabilityBacked
            && matches!(
                contribution.kind,
                ContributionKind::Detector | ContributionKind::Renderer
            )
        {
            bail!("detectors and renderers must remain local and offline");
        }
        if let Some(icon) = &contribution.icon {
            valid_host_icon(icon)?;
        }
        if let Some(icon_asset) = &contribution.icon_asset {
            if !icon_asset.starts_with("icons/") || !icon_asset.ends_with(".svg") {
                bail!("package iconAsset must reference an SVG below icons/");
            }
        }
        Ok(())
    }

    fn validate_permissions(&self) -> Result<()> {
        if self.permissions.http.len() > 16
            || self.permissions.credentials.len() > 16
            || self.permissions.external_navigation.len() > 16
            || self.permissions.providers.len() > 8
        {
            bail!("extension permission declaration exceeds its limits");
        }
        let mut navigation_origins = BTreeSet::new();
        for permission in &self.permissions.external_navigation {
            let parsed =
                Url::parse(&permission.origin).context("external navigation origin is invalid")?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || parsed.username() != ""
                || parsed.password().is_some()
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || !navigation_origins.insert(permission.origin.to_ascii_lowercase())
            {
                bail!("external navigation permissions require unique exact HTTPS origins");
            }
        }
        if self
            .permissions
            .providers
            .iter()
            .any(|provider| provider != "generation.text")
        {
            bail!("extension requests an unsupported provider capability");
        }
        let allowed_methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
        let mut origins = BTreeSet::new();
        for permission in &self.permissions.http {
            let parsed =
                Url::parse(&permission.origin).context("HTTP permission origin is invalid")?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || parsed.username() != ""
                || parsed.password().is_some()
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || permission.methods.is_empty()
                || permission.methods.len() > 8
                || permission
                    .methods
                    .iter()
                    .any(|method| !allowed_methods.contains(&method.as_str()))
                || permission.max_response_bytes == 0
                || permission.max_response_bytes > MAX_HTTP_RESPONSE_BYTES
                || permission.max_request_bytes == 0
                || permission.max_request_bytes > 10 * 1024 * 1024
                || !(100..=30_000).contains(&permission.timeout_ms)
                || permission.path_patterns.is_empty()
                || permission.path_patterns.len() > 32
                || permission.path_patterns.iter().any(|pattern| {
                    !pattern.starts_with('/')
                        || pattern.contains("..")
                        || pattern.contains('?')
                        || pattern.contains('#')
                        || pattern.matches('*').count() > 1
                        || (pattern.contains('*') && !pattern.ends_with('*'))
                })
                || !origins.insert(permission.origin.to_ascii_lowercase())
            {
                bail!("HTTP permissions require unique exact HTTPS origins, approved methods, and bounded responses");
            }
        }
        let mut credentials = BTreeSet::new();
        for credential in &self.permissions.credentials {
            valid_id(&credential.id, "credential")?;
            if credential.label.trim().is_empty()
                || credential.label.len() > 120
                || credential.placement.len() > 120
                || !matches!(
                    credential.placement.as_str(),
                    "authorization_bearer" | "header" | "query"
                )
                || !credentials.insert(&credential.id)
            {
                bail!("credential permission is invalid");
            }
        }
        Ok(())
    }

    pub fn qualified_contribution_id(&self, local_id: &str) -> String {
        format!("{}/{}", self.package_id, local_id)
    }
}

fn valid_ui_path(value: &str) -> Result<()> {
    if !value.starts_with("ui/")
        || value.contains('\\')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || value.len() > 240
    {
        bail!("custom UI entry must be a bounded package-relative path below ui/");
    }
    Ok(())
}

pub fn valid_host_icon(value: &str) -> Result<()> {
    if !matches!(
        value,
        "braces"
            | "code"
            | "database"
            | "file"
            | "globe"
            | "hash"
            | "key"
            | "link"
            | "palette"
            | "table"
            | "terminal"
            | "text"
    ) {
        bail!("extension icon is not in the ClipsX host icon catalog");
    }
    Ok(())
}

fn valid_id(value: &str, label: &str) -> Result<()> {
    if value.len() < 3
        || value.len() > 120
        || value.starts_with("builtin.")
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
        })
    {
        bail!("{label} ID must use lowercase ASCII letters, digits, '.', '-', or '_'");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(contribution: ManifestContribution) -> ExtensionManifest {
        ExtensionManifest {
            schema_version: 2,
            contract_revision: 2,
            package_id: "example.colors".into(),
            version: "1.0.0".into(),
            api_version: "^2.0".into(),
            display_name: "Colors".into(),
            description: String::new(),
            license: String::new(),
            permissions: ExtensionPermissions::default(),
            contributions: vec![contribution],
        }
    }

    fn contribution(kind: ContributionKind) -> ManifestContribution {
        ManifestContribution {
            id: "color".into(),
            kind,
            display_name: "Color".into(),
            version: "1.0.0".into(),
            matchers: vec![ContributionMatcher {
                mime_types: vec!["text/plain".into()],
                ..Default::default()
            }],
            emits_facet_ids: if kind == ContributionKind::Detector {
                vec!["color".into()]
            } else {
                vec![]
            },
            purpose: None,
            surfaces: vec![],
            execution: ExecutionClass::Local,
            icon: Some("palette".into()),
            icon_asset: None,
            placements: if kind == ContributionKind::Action {
                vec![ActionPlacement::ActionMenu]
            } else {
                vec![]
            },
            ui_surfaces: vec![],
            ui_entry: None,
            effects: vec![],
            handler: None,
            parameter_schema: empty_object(),
        }
    }

    #[test]
    fn v1_is_rejected_with_upgrade_message() {
        let error = ExtensionManifest::parse(b"schemaVersion = 1").unwrap_err();
        assert!(error.to_string().contains("API v1"));
    }

    #[test]
    fn obsolete_v2_draft_is_rejected_with_migration_message() {
        let error = ExtensionManifest::parse(
            b"schemaVersion = 2\npackageId = \"example.old\"\nversion = \"1.0.0\"\napiVersion = \"^2.0\"\ndisplayName = \"Old\"",
        )
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("obsolete Extension API v2 draft"));
    }

    #[test]
    fn renderer_requires_matcher_purpose_and_surface() {
        let mut value = contribution(ContributionKind::Renderer);
        value.purpose = Some(ViewPurpose::Semantic);
        value.surfaces = vec![RenderSurface::Detail, RenderSurface::Compact];
        assert!(manifest(value).validate().is_ok());

        let mut wildcard = contribution(ContributionKind::Renderer);
        wildcard.purpose = Some(ViewPurpose::Semantic);
        wildcard.surfaces = vec![RenderSurface::Detail];
        wildcard.matchers = vec![ContributionMatcher::default()];
        assert!(manifest(wildcard).validate().is_err());
    }

    #[test]
    fn permissions_require_exact_https_origins() {
        let mut value = manifest(contribution(ContributionKind::Transformer));
        value.contributions[0].execution = ExecutionClass::CapabilityBacked;
        value.permissions.http.push(HttpPermission {
            origin: "https://translation.googleapis.com".into(),
            path_patterns: vec!["/language/translate/*".into()],
            methods: vec!["POST".into()],
            max_request_bytes: 1_048_576,
            max_response_bytes: 1_048_576,
            timeout_ms: 10_000,
        });
        assert!(value.validate().is_ok());
        value.permissions.http[0].origin = "http://localhost:8080".into();
        assert!(value.validate().is_err());
    }

    #[test]
    fn external_navigation_is_separate_and_https_only() {
        let mut value = manifest(contribution(ContributionKind::Transformer));
        value
            .permissions
            .external_navigation
            .push(ExternalNavigationPermission {
                origin: "https://chatgpt.com".into(),
            });
        assert!(value.validate().is_ok());
        value.permissions.external_navigation[0].origin = "http://localhost:11434".into();
        assert!(value.validate().is_err());
    }
}
