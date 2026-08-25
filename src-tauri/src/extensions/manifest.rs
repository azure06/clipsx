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
    OpenDialog,
    ComposeEmail,
    DialPhone,
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
    Dialog,
    ComposeEmail {
        facet_value_pointer: String,
    },
    DialPhone {
        facet_value_pointer: String,
    },
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
    /// Theme-specific package SVGs. `light` is used on a light host surface and
    /// `dark` is used on a dark host surface. This is necessary because package
    /// icons are image resources and therefore cannot inherit host `currentColor`.
    #[serde(default)]
    pub icon_assets: Option<ThemedIconAssets>,
    /// A bounded visual adjustment for assets that include prescribed clear
    /// space in their viewBox. The host scales the complete image; it never
    /// crops or rewrites the SVG.
    #[serde(default = "default_icon_scale")]
    pub icon_scale: f32,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemedIconAssets {
    pub light: String,
    pub dark: String,
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
    pub http_origin: String,
    pub placement: String,
    #[serde(default)]
    pub header_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionSetting {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default = "empty_object")]
    pub default: Value,
}

fn default_version() -> String {
    "1.0.0".into()
}
fn default_icon_scale() -> f32 {
    1.0
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
    /// Theme-specific package identity icons used after installation. Catalog
    /// icons are separate, registry-owned, checksum-pinned raster assets.
    #[serde(default)]
    pub icon_assets: Option<ThemedIconAssets>,
    #[serde(default)]
    pub permissions: ExtensionPermissions,
    #[serde(default)]
    pub settings: Vec<ExtensionSetting>,
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
        if let Some(icons) = &self.icon_assets {
            valid_icon_asset(&icons.light, "iconAssets.light")?;
            valid_icon_asset(&icons.dark, "iconAssets.dark")?;
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
            validate_parameter_schema(&contribution.parameter_schema)?;
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
                if contribution.handler.is_some() {
                    bail!("renderer contributions cannot declare action handlers");
                }
                if contribution
                    .effects
                    .iter()
                    .any(|effect| *effect != ActionEffect::Copy)
                    || (!contribution.effects.is_empty()
                        && (!contribution.ui_surfaces.contains(&UiSurface::Detail)
                            || contribution.ui_entry.is_none()))
                {
                    bail!("custom detail renderers may declare only the copy effect");
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
                if matches!(contribution.handler, Some(ActionHandler::Dialog))
                    && (!contribution.effects.contains(&ActionEffect::OpenDialog)
                        || !contribution.ui_surfaces.contains(&UiSurface::Dialog))
                {
                    bail!("dialog actions require open_dialog and a dialog UI surface");
                }
                match &contribution.handler {
                    Some(ActionHandler::ComposeEmail {
                        facet_value_pointer,
                    }) => {
                        validate_typed_host_handler(
                            contribution,
                            facet_value_pointer,
                            ActionEffect::ComposeEmail,
                            "compose_email",
                        )?;
                    }
                    Some(ActionHandler::DialPhone {
                        facet_value_pointer,
                    }) => {
                        validate_typed_host_handler(
                            contribution,
                            facet_value_pointer,
                            ActionEffect::DialPhone,
                            "dial_phone",
                        )?;
                    }
                    _ => {}
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
            && self.permissions.providers.is_empty()
        {
            bail!("capability-backed contributions require an HTTP or provider permission declaration");
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
        if contribution.icon_asset.is_some() && contribution.icon_assets.is_some() {
            bail!("use either iconAsset or iconAssets, not both");
        }
        if let Some(icon_asset) = &contribution.icon_asset {
            valid_icon_asset(icon_asset, "iconAsset")?;
        }
        if let Some(icon_assets) = &contribution.icon_assets {
            valid_icon_asset(&icon_assets.light, "iconAssets.light")?;
            valid_icon_asset(&icon_assets.dark, "iconAssets.dark")?;
        }
        if !contribution.icon_scale.is_finite() || !(0.75..=2.0).contains(&contribution.icon_scale)
        {
            bail!("iconScale must be between 0.75 and 2");
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
                    "authorization_bearer" | "header"
                )
                || !origins.contains(&credential.http_origin.to_ascii_lowercase())
                || (credential.placement == "authorization_bearer"
                    && credential.header_name.is_some())
                || (credential.placement == "header"
                    && !credential
                        .header_name
                        .as_deref()
                        .is_some_and(valid_credential_header))
                || !credentials.insert(&credential.id)
            {
                bail!("credential permission is invalid");
            }
        }
        if self.settings.len() > 32 {
            bail!("extension settings declaration exceeds its limits");
        }
        let mut settings = BTreeSet::new();
        for setting in &self.settings {
            valid_id(&setting.id, "setting")?;
            let valid_default = match setting.kind.as_str() {
                "boolean" => setting.default.is_boolean(),
                "string" => setting
                    .default
                    .as_str()
                    .is_some_and(|value| value.len() <= 4096),
                "number" => setting.default.is_number(),
                _ => false,
            };
            if setting.label.trim().is_empty()
                || setting.label.len() > 120
                || !valid_default
                || !settings.insert(&setting.id)
            {
                bail!("extension setting declaration is invalid");
            }
        }
        Ok(())
    }

    pub fn qualified_contribution_id(&self, local_id: &str) -> String {
        format!("{}/{}", self.package_id, local_id)
    }
}

fn validate_typed_host_handler(
    contribution: &ManifestContribution,
    pointer: &str,
    required_effect: ActionEffect,
    name: &str,
) -> Result<()> {
    if contribution.effects != [required_effect]
        || contribution.execution != ExecutionClass::Local
        || pointer.is_empty()
        || pointer.len() > 256
        || !pointer.starts_with('/')
        || pointer
            .split('/')
            .skip(1)
            .any(|segment| segment.is_empty() || invalid_json_pointer_escape(segment))
    {
        bail!("{name} requires one matching effect, local execution, and a bounded facet JSON pointer");
    }
    Ok(())
}

fn invalid_json_pointer_escape(segment: &str) -> bool {
    let mut chars = segment.chars();
    while let Some(character) = chars.next() {
        if character == '~' && !matches!(chars.next(), Some('0' | '1')) {
            return true;
        }
    }
    false
}

fn valid_icon_asset(value: &str, label: &str) -> Result<()> {
    if !value.starts_with("icons/")
        || !value.ends_with(".svg")
        || value.contains('\\')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        bail!("package {label} must reference an SVG directly below icons/");
    }
    Ok(())
}

pub fn validate_parameter_schema(schema: &Value) -> Result<()> {
    let object = schema
        .as_object()
        .context("extension parameter schema must be an object")?;
    if object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("object")
        != "object"
    {
        bail!("extension parameter schema root type must be object");
    }
    let properties = object
        .get("properties")
        .map(|value| {
            value
                .as_object()
                .context("parameter schema properties must be an object")
        })
        .transpose()?
        .cloned()
        .unwrap_or_default();
    if properties.len() > 32 {
        bail!("extension parameter schema has too many properties");
    }
    for (name, property) in &properties {
        valid_id(name, "parameter")?;
        let property = property
            .as_object()
            .context("parameter property schema must be an object")?;
        let kind = property
            .get("type")
            .and_then(Value::as_str)
            .context("parameter property type is required")?;
        if !matches!(kind, "string" | "number" | "integer" | "boolean") {
            bail!("unsupported parameter property type");
        }
        if property.get("enum").is_some_and(|value| {
            value
                .as_array()
                .is_none_or(|values| values.is_empty() || values.len() > 64)
        }) {
            bail!("parameter enum must contain between 1 and 64 values");
        }
    }
    if let Some(required) = object.get("required") {
        let required = required
            .as_array()
            .context("parameter schema required must be an array")?;
        if required.iter().any(|name| {
            name.as_str()
                .is_none_or(|name| !properties.contains_key(name))
        }) {
            bail!("parameter schema requires an undeclared property");
        }
    }
    Ok(())
}

pub fn validate_parameters(schema: &Value, parameters: &Value) -> Result<()> {
    let schema = schema.as_object().context("parameter schema is invalid")?;
    let values = parameters
        .as_object()
        .context("extension parameters must be an object")?;
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if schema.get("additionalProperties") == Some(&Value::Bool(false))
        && values.keys().any(|name| !properties.contains_key(name))
    {
        bail!("extension parameters contain an undeclared property");
    }
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for name in required.iter().filter_map(Value::as_str) {
            if !values.contains_key(name) {
                bail!("required extension parameter is missing: {name}");
            }
        }
    }
    for (name, value) in values {
        let Some(property) = properties.get(name).and_then(Value::as_object) else {
            continue;
        };
        let valid_type = match property.get("type").and_then(Value::as_str) {
            Some("string") => value.is_string(),
            Some("number") => value.is_number(),
            Some("integer") => value.as_i64().is_some() || value.as_u64().is_some(),
            Some("boolean") => value.is_boolean(),
            _ => false,
        };
        if !valid_type {
            bail!("extension parameter has the wrong type: {name}");
        }
        if let Some(allowed) = property.get("enum").and_then(Value::as_array) {
            if !allowed.contains(value) {
                bail!("extension parameter is outside its declared enum: {name}");
            }
        }
        if let Some(text) = value.as_str() {
            let length = text.chars().count() as u64;
            if property
                .get("minLength")
                .and_then(Value::as_u64)
                .is_some_and(|min| length < min)
                || property
                    .get("maxLength")
                    .and_then(Value::as_u64)
                    .is_some_and(|max| length > max)
            {
                bail!("extension parameter length is outside its declared bounds: {name}");
            }
        }
        if let Some(number) = value.as_f64() {
            if property
                .get("minimum")
                .and_then(Value::as_f64)
                .is_some_and(|min| number < min)
                || property
                    .get("maximum")
                    .and_then(Value::as_f64)
                    .is_some_and(|max| number > max)
            {
                bail!("extension parameter is outside its declared bounds: {name}");
            }
        }
    }
    Ok(())
}

fn valid_credential_header(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
        && !matches!(
            value.to_ascii_lowercase().as_str(),
            "host" | "cookie" | "content-length" | "content-type" | "accept" | "origin" | "referer"
        )
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
            icon_assets: None,
            permissions: ExtensionPermissions::default(),
            settings: vec![],
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
            icon_assets: None,
            icon_scale: 1.0,
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
    fn themed_icon_assets_must_be_a_complete_safe_pair() {
        let mut value = contribution(ContributionKind::Detector);
        value.icon = None;
        value.icon_assets = Some(ThemedIconAssets {
            light: "icons/example-dark.svg".into(),
            dark: "icons/example-light.svg".into(),
        });
        assert!(manifest(value.clone()).validate().is_ok());

        value.icon_assets.as_mut().unwrap().dark = "icons/../other.svg".into();
        assert!(manifest(value).validate().is_err());
    }

    #[test]
    fn icon_scale_is_bounded() {
        let mut value = contribution(ContributionKind::Detector);
        value.icon_scale = 2.1;
        assert!(manifest(value).validate().is_err());
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
    fn credentials_are_bound_to_declared_origins_and_safe_headers() {
        let mut value = manifest(contribution(ContributionKind::Transformer));
        value.permissions.http.push(HttpPermission {
            origin: "https://api.example.com".into(),
            path_patterns: vec!["/v1/*".into()],
            methods: vec!["POST".into()],
            max_request_bytes: 1024,
            max_response_bytes: 2048,
            timeout_ms: 1_000,
        });
        value.permissions.credentials.push(CredentialPermission {
            id: "api-key".into(),
            label: "API key".into(),
            http_origin: "https://api.example.com".into(),
            placement: "header".into(),
            header_name: Some("x-api-key".into()),
        });
        assert!(value.validate().is_ok(), "{:?}", value.validate());
        value.permissions.credentials[0].header_name = Some("cookie".into());
        assert!(value.validate().is_err());
        value.permissions.credentials[0].header_name = Some("x-api-key".into());
        value.permissions.credentials[0].http_origin = "https://evil.example".into();
        assert!(value.validate().is_err());
    }

    #[test]
    fn generation_contract_does_not_require_direct_http_access() {
        let mut action = contribution(ContributionKind::Action);
        action.execution = ExecutionClass::CapabilityBacked;
        action.handler = Some(ActionHandler::Dialog);
        action.effects = vec![ActionEffect::OpenDialog];
        action.ui_surfaces = vec![UiSurface::Dialog];
        action.ui_entry = Some("ui/index.html".into());
        let mut value = manifest(action);
        value.permissions.providers.push("generation.text".into());
        assert!(value.validate().is_ok());
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

    #[test]
    fn settings_are_typed_and_have_matching_defaults() {
        let mut value = manifest(contribution(ContributionKind::Transformer));
        value.settings.push(ExtensionSetting {
            id: "tone".into(),
            label: "Tone".into(),
            kind: "string".into(),
            default: Value::String("concise".into()),
        });
        assert!(value.validate().is_ok());
        value.settings[0].default = Value::Bool(true);
        assert!(value.validate().is_err());
    }

    #[test]
    fn dialog_actions_require_the_host_open_dialog_contract() {
        let mut action = contribution(ContributionKind::Action);
        action.handler = Some(ActionHandler::Dialog);
        action.effects = vec![ActionEffect::OpenDialog];
        action.ui_surfaces = vec![UiSurface::Dialog];
        action.ui_entry = Some("ui/index.html".into());
        assert!(manifest(action.clone()).validate().is_ok());
        action.ui_surfaces.clear();
        assert!(manifest(action).validate().is_err());
    }

    #[test]
    fn typed_native_handlers_are_local_exact_and_pointer_bound() {
        let mut action = contribution(ContributionKind::Action);
        action.handler = Some(ActionHandler::ComposeEmail {
            facet_value_pointer: "/address".into(),
        });
        action.effects = vec![ActionEffect::ComposeEmail];
        assert!(manifest(action.clone()).validate().is_ok());

        action.effects = vec![ActionEffect::OpenHttpsUrl];
        assert!(manifest(action.clone()).validate().is_err());
        action.effects = vec![ActionEffect::ComposeEmail];
        action.handler = Some(ActionHandler::DialPhone {
            facet_value_pointer: "number".into(),
        });
        assert!(manifest(action).validate().is_err());
    }

    #[test]
    fn parameter_schema_and_runtime_values_use_the_same_bounded_subset() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "instruction": { "type": "string", "minLength": 1, "maxLength": 20 },
                "count": { "type": "integer", "minimum": 1, "maximum": 5 },
                "output": { "type": "string", "enum": ["preview", "copy"] }
            },
            "required": ["instruction"],
            "additionalProperties": false
        });
        assert!(validate_parameter_schema(&schema).is_ok());
        assert!(validate_parameters(
            &schema,
            &serde_json::json!({"instruction":"explain", "count":3, "output":"copy"})
        )
        .is_ok());
        assert!(validate_parameters(&schema, &serde_json::json!({"count": 3})).is_err());
        assert!(validate_parameters(
            &schema,
            &serde_json::json!({"instruction":"explain", "count":9})
        )
        .is_err());
        assert!(validate_parameters(
            &schema,
            &serde_json::json!({"instruction":"explain", "unknown":true})
        )
        .is_err());
    }

    #[test]
    fn parameter_schema_rejects_nested_or_unbounded_shapes() {
        assert!(validate_parameter_schema(&serde_json::json!({
            "type":"object", "properties":{"nested":{"type":"object"}}
        }))
        .is_err());
        let properties = (0..33)
            .map(|index| (format!("p{index}"), serde_json::json!({"type":"string"})))
            .collect::<serde_json::Map<_, _>>();
        assert!(validate_parameter_schema(&serde_json::json!({
            "type":"object", "properties": properties
        }))
        .is_err());
    }
}
