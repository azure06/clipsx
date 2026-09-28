//! Pure catalog contract shared by Discover and the package CLI.
use super::manifest::ExtensionManifest;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
const MAX_REGISTRY_BYTES: usize = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPackage {
    pub package_id: String,
    pub version: String,
    pub api_version: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    pub release_url: String,
    pub sha256: String,
    #[serde(default)]
    pub contributions: Vec<String>,
    #[serde(default)]
    pub http_origins: Vec<String>,
    #[serde(default)]
    pub external_navigation_origins: Vec<String>,
    #[serde(default)]
    pub credential_labels: Vec<String>,
    #[serde(default)]
    pub providers: Vec<String>,
    #[serde(default)]
    pub publisher: Option<RegistryPublisher>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub archive_size_bytes: Option<u64>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub homepage_url: Option<String>,
    #[serde(default)]
    pub repository_url: Option<String>,
    #[serde(default)]
    pub documentation_url: Option<String>,
    #[serde(default)]
    pub icon_assets: Option<RegistryIconAssets>,
    #[serde(default)]
    pub permission_fingerprint: Option<String>,
    #[serde(default)]
    pub portable_settings: Vec<RegistryPortableSetting>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryPortableSetting {
    pub setting_id: String,
    pub value_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPublisher {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryIconAssets {
    pub light: RegistryIconAsset,
    pub dark: RegistryIconAsset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryIconAsset {
    pub url: String,
    pub sha256: String,
    #[serde(default, skip_deserializing)]
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryIndex {
    pub schema_version: u32,
    pub packages: Vec<RegistryPackage>,
    #[serde(default)]
    pub revocations: Vec<RegistryRevocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryRevocation {
    pub package_id: String,
    pub version: String,
    pub sha256: String,
    #[serde(default)]
    pub reason: String,
}

impl RegistryIndex {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_REGISTRY_BYTES {
            bail!("registry index exceeds 2 MiB");
        }
        let index: Self =
            serde_json::from_slice(bytes).context("registry index is not valid JSON")?;
        if index.schema_version != 4
            || index.packages.len() > 10_000
            || index.revocations.len() > 10_000
        {
            bail!("unsupported or oversized registry index");
        }
        let mut entries = BTreeMap::new();
        for package in &index.packages {
            ExtensionManifest::parse(format!(
                "schemaVersion = 3\ncontractRevision = 3\npackageId = \"{}\"\nversion = \"{}\"\napiVersion = \"{}\"\ndisplayName = \"{}\"\n[[contributions]]\nid = \"placeholder\"\nkind = \"detector\"\ndisplayName = \"placeholder\"\nemitsFacetIds = [\"placeholder\"]\n",
                package.package_id, package.version, "^3.2", package.display_name
            ).as_bytes())?;
            if package.sha256.len() != 64
                || !package
                    .sha256
                    .bytes()
                    .all(|value| value.is_ascii_hexdigit())
            {
                bail!("registry package checksum is invalid");
            }
            validate_release_url(&package.release_url)?;
            if package.api_version != "^3.2" {
                bail!("registry package uses an unsupported extension API");
            }
            validate_marketplace_metadata(package)?;
            validate_portable_settings(package)?;
            if entries
                .insert((&package.package_id, &package.version), ())
                .is_some()
            {
                bail!("registry contains duplicate package versions");
            }
        }
        let mut revocations = BTreeMap::new();
        for revocation in &index.revocations {
            if revocation.package_id.is_empty()
                || revocation.package_id.len() > 120
                || revocation.version.is_empty()
                || revocation.version.len() > 64
                || revocation.sha256.len() != 64
                || !revocation
                    .sha256
                    .bytes()
                    .all(|value| value.is_ascii_hexdigit())
                || revocation.reason.len() > 500
            {
                bail!("registry revocation is invalid");
            }
            if revocations
                .insert(
                    (
                        &revocation.package_id,
                        &revocation.version,
                        &revocation.sha256,
                    ),
                    (),
                )
                .is_some()
            {
                bail!("registry contains a duplicate revocation");
            }
        }
        Ok(index)
    }

    pub fn find(&self, package_id: &str, version: &str) -> Option<&RegistryPackage> {
        self.packages
            .iter()
            .find(|entry| entry.package_id == package_id && entry.version == version)
    }

    pub fn revocation(
        &self,
        package_id: &str,
        version: &str,
        sha256: &str,
    ) -> Option<&RegistryRevocation> {
        self.revocations.iter().find(|entry| {
            entry.package_id == package_id
                && entry.version == version
                && entry.sha256.eq_ignore_ascii_case(sha256)
        })
    }
}

pub fn validate_release_url(value: &str) -> Result<()> {
    let url = url::Url::parse(value).context("registry release URL is invalid")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.path().contains("/releases/download/")
    {
        bail!("registry release URL must be an HTTPS GitHub release URL");
    }
    Ok(())
}

fn validate_marketplace_metadata(package: &RegistryPackage) -> Result<()> {
    let publisher = package
        .publisher
        .as_ref()
        .context("registry package is missing publisher metadata")?;
    if publisher.id.is_empty()
        || publisher.id.len() > 120
        || publisher.display_name.is_empty()
        || publisher.display_name.len() > 160
        || package.categories.len() > 12
        || package.tags.len() > 24
        || package.categories.iter().chain(&package.tags).any(|value| {
            value.is_empty() || value.len() > 80 || value.chars().any(char::is_control)
        })
    {
        bail!("registry package metadata exceeds its limits");
    }
    for timestamp in [&package.published_at, &package.updated_at] {
        if timestamp
            .as_deref()
            .is_none_or(|value| value.len() < 10 || value.len() > 40)
        {
            bail!("registry package timestamp is invalid");
        }
    }
    if package
        .archive_size_bytes
        .is_none_or(|size| size == 0 || size > MAX_ARCHIVE_BYTES as u64)
        || package.license.as_deref().is_none_or(str::is_empty)
    {
        bail!("registry package archive metadata is invalid");
    }
    let icons = package
        .icon_assets
        .as_ref()
        .context("registry package is missing icon assets")?;
    for asset in [&icons.light, &icons.dark] {
        validate_catalog_icon_descriptor(asset)?;
    }
    if package
        .permission_fingerprint
        .as_deref()
        .is_none_or(|value| {
            value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        bail!("registry package permission fingerprint is invalid");
    }
    for link in [
        &package.homepage_url,
        &package.repository_url,
        &package.documentation_url,
    ]
    .into_iter()
    .flatten()
    {
        let url = url::Url::parse(link).context("registry marketplace link is invalid")?;
        if url.scheme() != "https" || url.host_str().is_none() || link.len() > 2048 {
            bail!("registry marketplace link must be HTTPS");
        }
    }
    Ok(())
}

fn validate_portable_settings(package: &RegistryPackage) -> Result<()> {
    let mut previous = None;
    for setting in &package.portable_settings {
        if setting.setting_id.is_empty()
            || setting.setting_id.len() > 120
            || !matches!(setting.value_kind.as_str(), "boolean" | "number")
            || previous.is_some_and(|value: &str| value >= setting.setting_id.as_str())
        {
            bail!("registry portable settings are invalid or not canonically sorted");
        }
        previous = Some(setting.setting_id.as_str());
    }
    Ok(())
}

pub(crate) fn validate_catalog_icon_descriptor(asset: &RegistryIconAsset) -> Result<()> {
    let url = url::Url::parse(&asset.url).context("catalog icon URL is invalid")?;
    if url.scheme() != "https"
        || url.host_str() != Some("raw.githubusercontent.com")
        || !url.path().starts_with("/azure06/clipsx-registry/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("catalog icons must use the official registry raw-content origin");
    }
    if asset.sha256.len() != 64 || !asset.sha256.bytes().all(|value| value.is_ascii_hexdigit()) {
        bail!("catalog icon checksum is invalid");
    }
    Ok(())
}

impl RegistryPackage {
    pub(crate) fn schema_requires_permission_fingerprint(&self) -> bool {
        self.publisher.is_some() && self.permission_fingerprint.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> serde_json::Value {
        let icon = json!({"url":"https://raw.githubusercontent.com/azure06/clipsx-registry/main/icons/test.png","sha256":"c".repeat(64)});
        json!({"schemaVersion":4,"packages":[{
            "packageId":"infiniti.test","version":"1.0.0","apiVersion":"^3.2",
            "displayName":"Test","releaseUrl":"https://github.com/azure06/clipsx-extensions/releases/download/test-v1.0.0/test-1.0.0.clipsx",
            "sha256":"a".repeat(64),"publisher":{"id":"infiniti","displayName":"Infiniti","verified":true},
            "categories":["Utilities"],"tags":["test"],"publishedAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-29T00:00:00Z",
            "archiveSizeBytes":1024,"license":"MIT","iconAssets":{"light":icon,"dark":icon},
            "permissionFingerprint":"b".repeat(64),"externalNavigationOrigins":["https://chatgpt.com"]
        }],"revocations":[]})
    }

    #[test]
    fn catalog_contract_rejects_object_navigation_origins() {
        let mut value = catalog();
        assert!(RegistryIndex::parse(&serde_json::to_vec(&value).unwrap()).is_ok());
        value["packages"][0]["externalNavigationOrigins"] =
            json!([{"origin":"https://chatgpt.com"}]);
        assert!(RegistryIndex::parse(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn catalog_contract_checks_icons_and_duplicate_identities() {
        let mut value = catalog();
        value["packages"][0]["iconAssets"]["light"]["sha256"] = json!("wrong");
        assert!(RegistryIndex::parse(&serde_json::to_vec(&value).unwrap()).is_err());
        let mut value = catalog();
        let package = value["packages"][0].clone();
        value["packages"].as_array_mut().unwrap().push(package);
        assert!(RegistryIndex::parse(&serde_json::to_vec(&value).unwrap()).is_err());
    }
}
