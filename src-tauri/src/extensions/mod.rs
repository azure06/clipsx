//! M5 community extension packages. Packages are untrusted component-model
//! WebAssembly and receive no ambient host capabilities.

mod broker;
mod manifest;
mod packages;
mod runtime;
mod service;

#[allow(unused_imports)]
pub use manifest::{
    ActionDisposition, ActionEffect, ActionHandler, ActionPlacement, ContributionKind,
    ContributionMatcher, ExecutionClass, ExtensionManifest, ExtensionSetting, ManifestContribution,
    RenderSurface, UiSurface, ViewPurpose,
};
#[allow(unused_imports)]
pub use packages::{
    ExtensionPackage, ExtensionPackageStore, InstallSource, RegistryIndex, RegistryPackage,
};
#[allow(unused_imports)]
pub use runtime::{
    ExtensionActionResult, ExtensionActionState, ExtensionCompactModel, ExtensionContent,
    ExtensionFacet, ExtensionLeadingVisual, ExtensionOutputRepresentation, ExtensionRenderModel,
    ExtensionRepresentation, ExtensionRuntime, RuntimeErrorCode,
};
pub use service::{
    ActionInvocation, ActionOutcome, ContextActionDescriptor, CredentialStatus, CustomViewSession,
    ExtensionService,
};

use serde::{Deserialize, Serialize};

pub const API_VERSION: &str = "2.0.0";
pub const OFFICIAL_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/azure06/clipsx-registry/main/index.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}
