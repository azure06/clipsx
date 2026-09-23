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
pub(crate) const MAX_EXTENSION_INPUT_BYTES: usize = 10 * 1024 * 1024;

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResultLifetime {
    #[default]
    Temporary,
    SourceClip,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivationEvent {
    ClipCreated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationSelector {
    pub platform: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionActivation {
    pub id: String,
    pub event: ActivationEvent,
    pub transformer_id: String,
    #[serde(default)]
    pub matchers: Vec<ContributionMatcher>,
    #[serde(default)]
    pub applications: Vec<ApplicationSelector>,
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
    /// Maximum representation bytes the host may copy into this contribution.
    /// Packages that intentionally process larger local assets opt in here.
    #[serde(default = "default_extension_input_bytes")]
    pub input_limit_bytes: usize,
    /// Transformer contributions default to appearing in the host's generic
    /// Transform menu. Set to `false` when the transformer exists only to
    /// back one or more `TransformerPreset` actions that already cover its
    /// full parameter space, so the operation isn't offered twice.
    #[serde(default = "default_true")]
    pub expose_in_menu: bool,
    #[serde(default)]
    pub result_lifetime: ResultLifetime,
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
    pub selected_input: bool,
    pub background_clip_created: bool,
    pub source_application: bool,
    pub package_state: bool,
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
    /// Only explicit portable boolean/number settings may enter configuration sync.
    #[serde(default)]
    pub portable: bool,
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default = "empty_object")]
    pub default: Value,
    #[serde(default)]
    pub schema: Option<Value>,
    #[serde(default)]
    pub scope: SettingScope,
    #[serde(default)]
    pub ui_hint: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SettingScope {
    #[default]
    Device,
    Portable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionStateKey {
    pub id: String,
    pub schema: Value,
}

fn default_version() -> String {
    "1.0.0".into()
}
fn default_icon_scale() -> f32 {
    1.0
}
fn default_true() -> bool {
    true
}
fn default_extension_input_bytes() -> usize {
    1024 * 1024
}
fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    /// Required for the current extension contract.
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
    pub state: Vec<ExtensionStateKey>,
    #[serde(default)]
    pub activations: Vec<ExtensionActivation>,
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
        if value.get("schemaVersion").and_then(toml::Value::as_integer) != Some(3) {
            bail!("unsupported extension schema; build this package for Extension API v3");
        }
        if value.get("contractRevision").is_none() {
            bail!("obsolete extension package; rebuild with Extension API v3 contractRevision = 1");
        }
        let manifest: Self = toml::from_str(source)
            .context("extension manifest is not valid Extension API v3 TOML")?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version == 1 {
            bail!("Extension API v1 packages are incompatible; rebuild this package for API v3");
        }
        if self.schema_version != 3 {
            bail!("unsupported extension manifest schema; expected schemaVersion = 3");
        }
        if self.contract_revision != 1 {
            bail!("unsupported Extension API v3 contract revision; expected contractRevision = 1");
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
        self.validate_activations()?;
        Ok(())
    }

    fn validate_activations(&self) -> Result<()> {
        if self.activations.len() > 32 {
            bail!("extension activation declaration exceeds its limits");
        }
        let mut ids = BTreeSet::new();
        for activation in &self.activations {
            valid_id(&activation.id, "activation")?;
            if !ids.insert(&activation.id)
                || activation.matchers.is_empty()
                || activation.matchers.len() > 16
            {
                bail!("extension activations require unique IDs and bounded matchers");
            }
            for matcher in &activation.matchers {
                matcher.validate()?;
            }
            let transformer = self
                .contributions
                .iter()
                .find(|item| {
                    item.id == activation.transformer_id
                        && item.kind == ContributionKind::Transformer
                })
                .context("activation references an unknown transformer")?;
            if transformer.result_lifetime != ResultLifetime::SourceClip {
                bail!("automatic activations require a source_clip transformer");
            }
            if !self.permissions.background_clip_created || !self.permissions.selected_input {
                bail!("automatic activations require selected_input and background_clip_created permissions");
            }
            if activation.applications.len() > 32 {
                bail!("activation application filter exceeds its limit");
            }
            for application in &activation.applications {
                if !matches!(
                    application.platform.as_str(),
                    "windows" | "macos" | "linux_x11"
                ) || application.id.is_empty()
                    || application.id.len() > 256
                    || application.id.chars().any(char::is_control)
                {
                    bail!("activation application selector is invalid");
                }
            }
        }
        if self.state.len() > 64 {
            bail!("extension state declaration exceeds 64 keys");
        }
        let mut state_ids = BTreeSet::new();
        for declaration in &self.state {
            valid_id(&declaration.id, "state")?;
            if !state_ids.insert(&declaration.id) {
                bail!("extension state keys must be unique");
            }
            validate_schema_node(&declaration.schema, 0)?;
        }
        if !self.state.is_empty() && !self.permissions.package_state {
            bail!("declared package state requires package_state permission");
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
        if contribution.kind != ContributionKind::Transformer && !contribution.expose_in_menu {
            bail!("only transformer contributions may set exposeInMenu to false");
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
        if contribution.input_limit_bytes == 0
            || contribution.input_limit_bytes > MAX_EXTENSION_INPUT_BYTES
        {
            bail!("inputLimitBytes must be between 1 byte and 10 MiB");
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
            if let Some(schema) = &setting.schema {
                validate_schema_node(schema, 0)?;
                if schema
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("object")
                    != setting.kind
                {
                    bail!("extension setting schema type does not match kind");
                }
            }
            let valid_default = validate_setting_value(setting, &setting.default).is_ok();
            if setting.label.trim().is_empty()
                || setting.label.len() > 120
                || ((setting.portable || setting.scope == SettingScope::Portable)
                    && !matches!(setting.kind.as_str(), "boolean" | "number"))
                || setting.ui_hint.as_ref().is_some_and(|hint| {
                    !matches!(
                        hint.as_str(),
                        "checkbox"
                            | "number"
                            | "select"
                            | "textarea"
                            | "language_picker"
                            | "application_picker"
                    )
                })
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
    if schema
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("object")
        != "object"
    {
        bail!("extension parameter schema root type must be object");
    }
    validate_schema_node(schema, 0)
}

pub fn validate_parameters(schema: &Value, parameters: &Value) -> Result<()> {
    if serde_json::to_vec(parameters)?.len() > 64 * 1024 {
        bail!("extension parameters exceed 64 KiB");
    }
    validate_schema_value(schema, parameters)
}

pub fn normalized_parameters(schema: &Value, parameters: &Value) -> Result<Value> {
    validate_parameter_schema(schema)?;
    let mut normalized = parameters.clone();
    apply_schema_defaults(schema, &mut normalized);
    validate_parameters(schema, &normalized)?;
    Ok(normalized)
}

pub fn validate_setting_value(setting: &ExtensionSetting, value: &Value) -> Result<()> {
    if serde_json::to_vec(value)?.len() > 16 * 1024 {
        bail!("extension setting exceeds 16 KiB");
    }
    if let Some(schema) = &setting.schema {
        return validate_schema_value(schema, value);
    }
    let valid = match setting.kind.as_str() {
        "boolean" => value.is_boolean(),
        "string" => value.as_str().is_some_and(|text| text.len() <= 4096),
        "number" => value.as_f64().is_some_and(f64::is_finite),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        _ => false,
    };
    if !valid {
        bail!("extension setting value does not match its declaration");
    }
    Ok(())
}

pub fn validate_state_value(schema: &Value, value: &Value) -> Result<()> {
    validate_schema_value(schema, value)
}

fn apply_schema_defaults(schema: &Value, value: &mut Value) {
    if let (Some(properties), Some(values)) = (
        schema.get("properties").and_then(Value::as_object),
        value.as_object_mut(),
    ) {
        for (key, property) in properties {
            if !values.contains_key(key) {
                if let Some(default) = property.get("default") {
                    values.insert(key.clone(), default.clone());
                }
            }
            if let Some(value) = values.get_mut(key) {
                apply_schema_defaults(property, value);
            }
        }
    }
    if let (Some(items), Some(values)) = (schema.get("items"), value.as_array_mut()) {
        for value in values {
            apply_schema_defaults(items, value);
        }
    }
}

fn validate_schema_node(schema: &Value, depth: usize) -> Result<()> {
    if depth > 4 {
        bail!("extension schema nesting exceeds four levels");
    }
    let object = schema
        .as_object()
        .context("extension schema must be an object")?;
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "type"
                | "properties"
                | "required"
                | "additionalProperties"
                | "items"
                | "maxItems"
                | "minItems"
                | "enum"
                | "minLength"
                | "maxLength"
                | "minimum"
                | "maximum"
                | "default"
                | "title"
                | "description"
        ) {
            bail!("unsupported extension schema keyword");
        }
    }
    match object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("object")
    {
        "object" => {
            if object.get("additionalProperties") == Some(&Value::Bool(true)) {
                bail!("extension schema cannot allow undeclared properties");
            }
            let properties = object
                .get("properties")
                .map(|value| {
                    value
                        .as_object()
                        .context("schema properties must be an object")
                })
                .transpose()?
                .cloned()
                .unwrap_or_default();
            if properties.len() > 32 {
                bail!("extension schema object exceeds 32 properties");
            }
            for (key, value) in &properties {
                valid_id(key, "parameter")?;
                validate_schema_node(value, depth + 1)?;
            }
            if let Some(required) = object.get("required") {
                let required = required
                    .as_array()
                    .context("schema required must be an array")?;
                if required.len() > 32
                    || required
                        .iter()
                        .any(|key| key.as_str().is_none_or(|key| !properties.contains_key(key)))
                {
                    bail!("schema requires an undeclared property");
                }
            }
        }
        "array" => {
            let max = object
                .get("maxItems")
                .and_then(Value::as_u64)
                .context("array schema requires maxItems")?;
            if max > 64 {
                bail!("array schema exceeds 64 items");
            }
            validate_schema_node(
                object.get("items").context("array schema requires items")?,
                depth + 1,
            )?;
        }
        "string" => {
            let max = object.get("maxLength").and_then(Value::as_u64);
            if max.is_none() && object.get("enum").is_none() {
                bail!("string schema requires maxLength or enum");
            }
            if max.is_some_and(|max| max > 16 * 1024) {
                bail!("string schema exceeds 16 KiB");
            }
        }
        "integer" | "number" => {
            if (object.get("minimum").and_then(Value::as_f64).is_none()
                || object.get("maximum").and_then(Value::as_f64).is_none())
                && object.get("enum").is_none()
            {
                bail!("number schema requires bounds or enum");
            }
        }
        "boolean" => {}
        _ => bail!("unsupported extension schema type"),
    }
    if let Some(values) = object.get("enum") {
        let values = values.as_array().context("schema enum must be an array")?;
        if values.is_empty() || values.len() > 64 {
            bail!("schema enum exceeds its bounds");
        }
        for value in values {
            validate_schema_value_without_enum(schema, value)?;
        }
    }
    if let Some(default) = object.get("default") {
        validate_schema_value(schema, default)?;
    }
    Ok(())
}

fn validate_schema_value(schema: &Value, value: &Value) -> Result<()> {
    validate_schema_value_without_enum(schema, value)?;
    if schema
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|values| !values.contains(value))
    {
        bail!("value is outside its declared enum");
    }
    Ok(())
}

fn validate_schema_value_without_enum(schema: &Value, value: &Value) -> Result<()> {
    match schema
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("object")
    {
        "object" => {
            let values = value
                .as_object()
                .context("extension value must be an object")?;
            let properties = schema.get("properties").and_then(Value::as_object);
            if values.len() > 32 {
                bail!("extension object exceeds 32 properties");
            }
            for (key, value) in values {
                let property = properties
                    .and_then(|properties| properties.get(key))
                    .context("extension value contains an undeclared property")?;
                validate_schema_value(property, value)?;
            }
            if let Some(required) = schema.get("required").and_then(Value::as_array) {
                if required
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|key| !values.contains_key(key))
                {
                    bail!("required extension parameter is missing");
                }
            }
        }
        "array" => {
            let values = value
                .as_array()
                .context("extension value must be an array")?;
            let max = schema
                .get("maxItems")
                .and_then(Value::as_u64)
                .context("array maxItems is missing")?;
            if values.len() as u64 > max || values.len() > 64 {
                bail!("extension array exceeds its limit");
            }
            let items = schema
                .get("items")
                .context("array items schema is missing")?;
            for value in values {
                validate_schema_value(items, value)?;
            }
        }
        "string" => {
            let text = value.as_str().context("extension value must be a string")?;
            let length = text.chars().count() as u64;
            if length
                > schema
                    .get("maxLength")
                    .and_then(Value::as_u64)
                    .unwrap_or(16 * 1024)
                || length < schema.get("minLength").and_then(Value::as_u64).unwrap_or(0)
            {
                bail!("extension string exceeds its bounds");
            }
        }
        "number" | "integer" => {
            let number = value.as_f64().context("extension value must be a number")?;
            if schema.get("type").and_then(Value::as_str) == Some("integer")
                && !(value.as_i64().is_some() || value.as_u64().is_some())
            {
                bail!("extension value must be an integer");
            }
            if !number.is_finite()
                || schema
                    .get("minimum")
                    .and_then(Value::as_f64)
                    .is_some_and(|min| number < min)
                || schema
                    .get("maximum")
                    .and_then(Value::as_f64)
                    .is_some_and(|max| number > max)
            {
                bail!("extension number exceeds its bounds");
            }
        }
        "boolean" => {
            if !value.is_boolean() {
                bail!("extension value must be a boolean");
            }
        }
        _ => bail!("unsupported extension schema type"),
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
            | "binary"
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
            schema_version: 3,
            contract_revision: 1,
            package_id: "example.colors".into(),
            version: "1.0.0".into(),
            api_version: "^3.0".into(),
            display_name: "Colors".into(),
            description: String::new(),
            license: String::new(),
            icon_assets: None,
            permissions: ExtensionPermissions::default(),
            settings: vec![],
            state: vec![],
            activations: vec![],
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
            input_limit_bytes: 1024 * 1024,
            expose_in_menu: true,
            result_lifetime: ResultLifetime::Temporary,
        }
    }

    #[test]
    fn obsolete_schema_is_rejected_with_upgrade_message() {
        let error = ExtensionManifest::parse(b"schemaVersion = 1").unwrap_err();
        assert!(error.to_string().contains("Extension API v3"));
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
    fn contribution_input_limit_is_opt_in_and_bounded() {
        let mut value = contribution(ContributionKind::Detector);
        assert_eq!(value.input_limit_bytes, 1024 * 1024);
        value.input_limit_bytes = MAX_EXTENSION_INPUT_BYTES;
        assert!(manifest(value.clone()).validate().is_ok());
        value.input_limit_bytes += 1;
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
            portable: false,
            id: "tone".into(),
            label: "Tone".into(),
            kind: "string".into(),
            default: Value::String("concise".into()),
            schema: None,
            scope: SettingScope::Device,
            ui_hint: None,
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
    fn parameter_schema_accepts_bounded_nested_shapes_and_rejects_unbounded_ones() {
        assert!(validate_parameter_schema(&serde_json::json!({
            "type":"object", "properties":{"nested":{"type":"object"}}
        }))
        .is_ok());
        let properties = (0..33)
            .map(|index| (format!("p{index}"), serde_json::json!({"type":"string"})))
            .collect::<serde_json::Map<_, _>>();
        assert!(validate_parameter_schema(&serde_json::json!({
            "type":"object", "properties": properties
        }))
        .is_err());
    }
}
