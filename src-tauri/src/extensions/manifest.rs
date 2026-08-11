use anyhow::{bail, Context, Result};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::API_VERSION;

const MAX_MANIFEST_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContributionKind {
    Detector,
    Renderer,
    Transformer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestContribution {
    pub id: String,
    pub kind: ContributionKind,
    pub display_name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub mime_types: Vec<String>,
    #[serde(default)]
    pub format_keys: Vec<String>,
    #[serde(default)]
    pub facet_ids: Vec<String>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default = "empty_object")]
    pub parameter_schema: Value,
}

fn default_version() -> String {
    "1.0.0".into()
}
fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub package_id: String,
    pub version: String,
    pub api_version: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub contributions: Vec<ManifestContribution>,
}

impl ExtensionManifest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            bail!("extension manifest exceeds 256 KiB");
        }
        let manifest: Self = toml::from_str(std::str::from_utf8(bytes)?)
            .context("extension manifest is not valid TOML")?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            bail!("unsupported extension manifest schema");
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
        let mut ids = std::collections::BTreeSet::new();
        for contribution in &self.contributions {
            valid_id(&contribution.id, "contribution")?;
            if !ids.insert(&contribution.id) {
                bail!("extension contribution IDs must be unique");
            }
            Version::parse(&contribution.version)
                .context("extension contribution version is not semantic version")?;
            if contribution.display_name.trim().is_empty()
                || contribution.display_name.len() > 120
                || contribution.mime_types.len() > 32
                || contribution.format_keys.len() > 32
                || contribution.facet_ids.len() > 32
            {
                bail!("extension contribution declaration exceeds its limits");
            }
            if !contribution.parameter_schema.is_object()
                || contribution.parameter_schema.to_string().len() > 64 * 1024
            {
                bail!("extension parameter schema must be a bounded JSON object");
            }
        }
        Ok(())
    }

    pub fn qualified_contribution_id(&self, local_id: &str) -> String {
        format!("{}/{}", self.package_id, local_id)
    }
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

    #[test]
    fn manifest_rejects_builtin_namespace() {
        let manifest = ExtensionManifest {
            schema_version: 1,
            package_id: "builtin.evil".into(),
            version: "1.0.0".into(),
            api_version: "^1.0".into(),
            display_name: "Nope".into(),
            description: String::new(),
            license: String::new(),
            contributions: vec![ManifestContribution {
                id: "demo".into(),
                kind: ContributionKind::Detector,
                display_name: "Demo".into(),
                version: "1.0.0".into(),
                mime_types: vec![],
                format_keys: vec![],
                facet_ids: vec![],
                priority: 0,
                parameter_schema: empty_object(),
            }],
        };
        assert!(manifest.validate().is_err());
    }
}
