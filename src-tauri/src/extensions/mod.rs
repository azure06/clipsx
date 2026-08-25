//! M5 community extension packages. Packages are untrusted component-model
//! WebAssembly and receive no ambient host capabilities.

mod broker;
mod manifest;
mod packages;
mod runtime;
mod service;

pub use broker::{BrokerHttpRequest, BrokerHttpResponse};

#[allow(unused_imports)]
pub use manifest::{
    ActionDisposition, ActionEffect, ActionHandler, ActionPlacement, ContributionKind,
    ContributionMatcher, ExecutionClass, ExtensionManifest, ExtensionSetting, ManifestContribution,
    RenderSurface, UiSurface, ViewPurpose,
};
#[allow(unused_imports)]
pub use packages::{
    permission_fingerprint, verify_registry_signatures, ExtensionPackage, ExtensionPackageStore,
    InstallSource, RegistryIconAsset, RegistryIconAssets, RegistryIndex, RegistryPackage,
    RegistryPublisher, RegistryRevocation,
};
#[allow(unused_imports)]
pub use runtime::{
    ExtensionActionResult, ExtensionActionState, ExtensionCompactModel, ExtensionContent,
    ExtensionFacet, ExtensionLeadingVisual, ExtensionOutputRepresentation, ExtensionRenderModel,
    ExtensionRepresentation, ExtensionRuntime, RuntimeErrorCode,
};
pub use service::{
    ActionInvocation, ActionOutcome, BridgeOutcome, BridgeRequest, ContextActionDescriptor,
    CredentialStatus, CustomViewSession, ExtensionService,
};

use serde::{Deserialize, Serialize};

pub const API_VERSION: &str = "2.0.0";
pub const OFFICIAL_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/azure06/clipsx-registry/main/index.json";
pub const OFFICIAL_REGISTRY_SIGNATURES_URL: &str =
    "https://raw.githubusercontent.com/azure06/clipsx-registry/main/index.signatures.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    Ready,
    Quarantined,
    Incompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSummary {
    pub package_id: String,
    pub version: String,
    pub display_name: String,
    pub description: String,
    pub icon_svg: Option<String>,
    pub icon_svg_dark: Option<String>,
    pub source: InstallSource,
    pub enabled: bool,
    pub status: RuntimeStatus,
    pub http_origins: Vec<String>,
    pub credential_labels: Vec<String>,
    pub unavailable_contributions: Vec<String>,
    pub checksum: Option<String>,
    pub external_navigation_origins: Vec<String>,
    pub providers: Vec<String>,
    pub settings: Vec<ExtensionSetting>,
    pub permission_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCatalog {
    pub packages: Vec<ExtensionCatalogEntry>,
    pub registry: RegistryStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCatalogEntry {
    pub package: RegistryPackage,
    pub installed: Option<ExtensionSummary>,
    pub update: Option<RegistryPackage>,
    pub auto_update_eligible: bool,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryStatus {
    pub schema_version: Option<u32>,
    pub cached: bool,
    pub last_successful_check_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPackageDetail {
    pub installed: Option<ExtensionSummary>,
    pub package: Option<RegistryPackage>,
    pub actions: Vec<ContextActionDescriptor>,
    pub settings: serde_json::Value,
    pub credentials: Vec<CredentialStatus>,
    pub update: Option<RegistryPackage>,
    pub auto_update_mode: String,
    pub auto_update_eligible: bool,
    pub grants_revoked_on_update: bool,
    pub diagnostics: Vec<String>,
    pub revoked: bool,
}
