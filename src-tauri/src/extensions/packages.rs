use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive};

use super::ExtensionManifest;

const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
const MAX_UNPACKED_BYTES: usize = 32 * 1024 * 1024;
const MAX_COMPONENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 4 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 256;
const MAX_REGISTRY_BYTES: usize = 2 * 1024 * 1024;
const MAX_REGISTRY_SIGNATURE_BYTES: usize = 64 * 1024;
const MAX_CATALOG_ICON_BYTES: usize = 256 * 1024;

/// Public registry trust roots are intentionally compiled into the client.
/// Add a new key before publishing overlapping rotation signatures; remove an
/// old key only after every supported client release trusts its replacement.
const TRUSTED_REGISTRY_KEYS: &[(&str, &str)] = &[(
    "infiniti-registry-2026-01",
    "zWBq9jTt/X/ps0+qFlu8GekJDI+Ju87GFkyDnP0Fia8=",
)];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallSource {
    Registry,
    Developer,
}

#[derive(Debug, Clone)]
pub struct ExtensionPackage {
    pub manifest: ExtensionManifest,
    pub sha256: String,
    pub relative_path: PathBuf,
    pub component_path: Option<PathBuf>,
}

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistrySignatures {
    schema_version: u32,
    signatures: Vec<RegistrySignature>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistrySignature {
    key_id: String,
    algorithm: String,
    signature: String,
}

impl RegistryIndex {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_REGISTRY_BYTES {
            bail!("registry index exceeds 2 MiB");
        }
        let index: Self =
            serde_json::from_slice(bytes).context("registry index is not valid JSON")?;
        if !(1..=3).contains(&index.schema_version)
            || index.packages.len() > 10_000
            || index.revocations.len() > 10_000
        {
            bail!("unsupported or oversized registry index");
        }
        let mut entries = BTreeMap::new();
        for package in &index.packages {
            ExtensionManifest::parse(format!(
                "schemaVersion = 2\ncontractRevision = 2\npackageId = \"{}\"\nversion = \"{}\"\napiVersion = \"{}\"\ndisplayName = \"{}\"\n[[contributions]]\nid = \"placeholder\"\nkind = \"detector\"\ndisplayName = \"placeholder\"\nemitsFacetIds = [\"placeholder\"]\n",
                package.package_id, package.version, package.api_version, package.display_name
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
            if index.schema_version >= 2 {
                validate_marketplace_metadata(package)?;
            }
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

pub fn verify_registry_signatures(index: &[u8], signatures: &[u8]) -> Result<()> {
    let trusted_keys = TRUSTED_REGISTRY_KEYS
        .iter()
        .map(|(key_id, encoded_key)| {
            let key = BASE64
                .decode(encoded_key)
                .context("embedded extension-registry public key is invalid base64")?;
            let key = key.try_into().map_err(|_| {
                anyhow::anyhow!("embedded extension-registry public key must be 32 bytes")
            })?;
            Ok((*key_id, key))
        })
        .collect::<Result<Vec<_>>>()?;
    verify_registry_signatures_with_keys(index, signatures, &trusted_keys)
}

fn verify_registry_signatures_with_keys(
    index: &[u8],
    signatures: &[u8],
    trusted_keys: &[(&str, [u8; 32])],
) -> Result<()> {
    if index.len() > MAX_REGISTRY_BYTES || signatures.len() > MAX_REGISTRY_SIGNATURE_BYTES {
        bail!("extension registry or signature document exceeds its limit");
    }
    let document: RegistrySignatures = serde_json::from_slice(signatures)
        .context("registry signature document is not valid JSON")?;
    if document.schema_version != 1
        || document.signatures.is_empty()
        || document.signatures.len() > 8
    {
        bail!("registry signature document has an unsupported shape");
    }
    for entry in document.signatures {
        if entry.algorithm != "ed25519" || entry.key_id.is_empty() || entry.key_id.len() > 120 {
            continue;
        }
        let Some((_, key_bytes)) = trusted_keys.iter().find(|(id, _)| *id == entry.key_id) else {
            continue;
        };
        let Ok(signature_bytes) = BASE64.decode(entry.signature) else {
            continue;
        };
        let Ok(signature) = Signature::from_slice(&signature_bytes) else {
            continue;
        };
        let Ok(key) = VerifyingKey::from_bytes(key_bytes) else {
            continue;
        };
        if key.verify_strict(index, &signature).is_ok() {
            return Ok(());
        }
    }
    bail!("extension registry is not signed by a trusted key")
}

#[derive(Clone)]
pub struct ExtensionPackageStore {
    root: PathBuf,
}

impl ExtensionPackageStore {
    pub fn new(root: PathBuf) -> Result<Self> {
        for path in [
            root.join("packages"),
            root.join("staging"),
            root.join("cache"),
        ] {
            fs::create_dir_all(path)?;
        }
        Ok(Self { root })
    }

    pub fn cache_path(&self) -> PathBuf {
        self.root.join("cache").join("registry-v3.json")
    }

    fn signature_cache_path(&self) -> PathBuf {
        self.root.join("cache").join("registry-v3.signatures.json")
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn packages_root(&self) -> PathBuf {
        self.root.join("packages")
    }

    pub fn cache_registry(&self, bytes: &[u8], signatures: &[u8]) -> Result<RegistryIndex> {
        verify_registry_signatures(bytes, signatures)?;
        let mut index = RegistryIndex::parse(bytes)?;
        let staged_index = self
            .root
            .join("staging")
            .join(format!("registry-{}.pending", Uuid::now_v7()));
        let staged_signatures = self
            .root
            .join("staging")
            .join(format!("registry-signatures-{}.pending", Uuid::now_v7()));
        fs::write(&staged_index, bytes)?;
        fs::write(&staged_signatures, signatures)?;
        fs::rename(staged_signatures, self.signature_cache_path())?;
        fs::rename(staged_index, self.cache_path())?;
        self.attach_cached_icons(&mut index)?;
        Ok(index)
    }

    pub fn cached_registry(&self) -> Result<Option<RegistryIndex>> {
        let index_path = self.cache_path();
        let signature_path = self.signature_cache_path();
        if index_path.exists() && signature_path.exists() {
            let bytes = fs::read(index_path)?;
            let signatures = fs::read(signature_path)?;
            verify_registry_signatures(&bytes, &signatures)?;
            let mut index = RegistryIndex::parse(&bytes)?;
            self.attach_cached_icons(&mut index)?;
            return Ok(Some(index));
        }
        Ok(None)
    }

    pub fn cache_catalog_icon(&self, descriptor: &RegistryIconAsset, bytes: &[u8]) -> Result<()> {
        validate_catalog_icon_descriptor(descriptor)?;
        if bytes.is_empty() || bytes.len() > MAX_CATALOG_ICON_BYTES {
            bail!("catalog icon exceeds its size limit");
        }
        catalog_icon_media_type(bytes).context("catalog icon must be PNG or WebP")?;
        if hex_digest(bytes) != descriptor.sha256.to_ascii_lowercase() {
            bail!("catalog icon checksum does not match the signed registry");
        }
        let path = self.catalog_icon_path(&descriptor.sha256);
        if path.exists() {
            let cached = fs::read(&path)?;
            if cached.len() <= MAX_CATALOG_ICON_BYTES
                && catalog_icon_media_type(&cached).is_some()
                && hex_digest(&cached) == descriptor.sha256.to_ascii_lowercase()
            {
                return Ok(());
            }
            bail!("existing catalog icon cache entry failed integrity verification");
        }
        let staged = self
            .root
            .join("staging")
            .join(format!("catalog-icon-{}.pending", Uuid::now_v7()));
        fs::write(&staged, bytes)?;
        fs::rename(staged, path)?;
        Ok(())
    }

    fn attach_cached_icons(&self, index: &mut RegistryIndex) -> Result<()> {
        for package in &mut index.packages {
            let Some(icons) = &mut package.icon_assets else {
                continue;
            };
            for descriptor in [&mut icons.light, &mut icons.dark] {
                let bytes = fs::read(self.catalog_icon_path(&descriptor.sha256))
                    .context("verified catalog icon is missing from the local cache")?;
                let media = catalog_icon_media_type(&bytes)
                    .context("cached catalog icon has an invalid raster format")?;
                if bytes.len() > MAX_CATALOG_ICON_BYTES
                    || hex_digest(&bytes) != descriptor.sha256.to_ascii_lowercase()
                {
                    bail!("cached catalog icon failed integrity verification");
                }
                descriptor.data_url = Some(format!("data:{media};base64,{}", BASE64.encode(bytes)));
            }
        }
        Ok(())
    }

    fn catalog_icon_path(&self, sha256: &str) -> PathBuf {
        self.root
            .join("cache")
            .join(format!("catalog-icon-{}.bin", sha256.to_ascii_lowercase()))
    }

    pub fn install(
        &self,
        archive: &[u8],
        source: InstallSource,
        registry_entry: Option<&RegistryPackage>,
    ) -> Result<ExtensionPackage> {
        if archive.len() > MAX_ARCHIVE_BYTES {
            bail!("extension archive exceeds 16 MiB");
        }
        let sha256 = hex_digest(archive);
        if let Some(entry) = registry_entry {
            if !matches!(source, InstallSource::Registry) || entry.sha256 != sha256 {
                bail!("extension archive checksum does not match the reviewed registry");
            }
        } else if matches!(source, InstallSource::Registry) {
            bail!("registry installation requires a reviewed registry entry");
        }

        let contents = unpack(archive)?;
        let manifest = ExtensionManifest::parse(required(&contents, "clipsx-extension.toml")?)?;
        if let Some(entry) = registry_entry {
            if manifest.package_id != entry.package_id
                || manifest.version != entry.version
                || manifest.api_version != entry.api_version
            {
                bail!("extension manifest does not match the reviewed registry entry");
            }
            if entry.schema_requires_permission_fingerprint()
                && entry.permission_fingerprint.as_deref()
                    != Some(permission_fingerprint(&manifest).as_str())
            {
                bail!("extension permissions do not match the reviewed registry entry");
            }
        }
        if let Some(component) = contents.get("component.wasm") {
            if component.len() > MAX_COMPONENT_BYTES || !component.starts_with(b"\0asm") {
                bail!("extension package contains an invalid bounded WebAssembly component");
            }
        } else if manifest_requires_component(&manifest) {
            bail!("extension package declares guest logic but does not contain component.wasm");
        }
        validate_assets(&contents)?;
        validate_declared_assets(&manifest, &contents)?;
        let relative_path = PathBuf::from("packages")
            .join(&manifest.package_id)
            .join(&manifest.version)
            .join(&sha256);
        let destination = self.root.join(&relative_path);
        if !destination.starts_with(self.root.join("packages")) {
            bail!("extension package destination escaped its root");
        }
        if !destination.exists() {
            let staged = self
                .root
                .join("staging")
                .join(format!("package-{}", Uuid::now_v7()));
            fs::create_dir_all(&staged)?;
            for (name, bytes) in &contents {
                if let Some(parent) = staged.join(name).parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(staged.join(name), bytes)?;
            }
            fs::create_dir_all(
                destination
                    .parent()
                    .context("extension package has no parent")?,
            )?;
            fs::rename(&staged, &destination)?;
        }
        Ok(ExtensionPackage {
            manifest,
            sha256,
            relative_path: relative_path.clone(),
            component_path: contents
                .contains_key("component.wasm")
                .then(|| self.root.join(relative_path).join("component.wasm")),
        })
    }

    pub fn inspect(&self, archive: &[u8]) -> Result<ExtensionManifest> {
        if archive.len() > MAX_ARCHIVE_BYTES {
            bail!("extension archive exceeds 16 MiB");
        }
        let contents = unpack(archive)?;
        let manifest = ExtensionManifest::parse(required(&contents, "clipsx-extension.toml")?)?;
        if let Some(component) = contents.get("component.wasm") {
            if component.len() > MAX_COMPONENT_BYTES || !component.starts_with(b"\0asm") {
                bail!("extension package does not contain a valid bounded WebAssembly component");
            }
        } else if manifest_requires_component(&manifest) {
            bail!("extension package declares guest logic but does not contain component.wasm");
        }
        validate_assets(&contents)?;
        validate_declared_assets(&manifest, &contents)?;
        Ok(manifest)
    }

    pub fn load(&self, relative_path: &Path) -> Result<ExtensionPackage> {
        if relative_path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::RootDir
            )
        }) {
            bail!("extension package path is invalid");
        }
        let path = self.root.join(relative_path);
        if !path.starts_with(self.root.join("packages")) {
            bail!("extension package path escaped its root");
        }
        let manifest = ExtensionManifest::parse(&fs::read(path.join("clipsx-extension.toml"))?)?;
        let component_path = path
            .join("component.wasm")
            .exists()
            .then(|| path.join("component.wasm"));
        let sha256 = path
            .file_name()
            .and_then(|name| name.to_str())
            .context("extension package lacks checksum path")?
            .into();
        Ok(ExtensionPackage {
            manifest,
            sha256,
            relative_path: relative_path.into(),
            component_path,
        })
    }

    pub fn package_asset(&self, relative_path: &Path, asset_path: &str) -> Result<Vec<u8>> {
        if relative_path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::RootDir
            )
        }) || !allowed_path(asset_path)
            || !(asset_path.starts_with("ui/") || asset_path.starts_with("icons/"))
        {
            bail!("extension asset path is invalid");
        }
        let package_root = self.root.join(relative_path);
        let path = package_root.join(asset_path);
        if !package_root.starts_with(self.root.join("packages")) || !path.starts_with(&package_root)
        {
            bail!("extension asset escaped its package root");
        }
        let bytes = fs::read(path).context("extension asset is unavailable")?;
        if bytes.len() > MAX_ASSET_BYTES {
            bail!("extension asset exceeds its runtime limit");
        }
        Ok(bytes)
    }
}

fn unpack(archive: &[u8]) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut zip =
        ZipArchive::new(Cursor::new(archive)).context("extension archive is not a ZIP file")?;
    if zip.is_empty() || zip.len() > MAX_PACKAGE_FILES {
        bail!("extension archive has an invalid number of entries");
    }
    let mut total = 0usize;
    let mut files = BTreeMap::new();
    for index in 0..zip.len() {
        let mut file = zip.by_index(index)?;
        let name = file.name().to_owned();
        if !allowed_path(&name)
            || name.contains('\\')
            || name.starts_with('.')
            || file.is_dir()
            || !matches!(
                file.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
        {
            bail!("extension archive contains an unsupported path or entry");
        }
        let length =
            usize::try_from(file.size()).context("extension archive entry is too large")?;
        total = total
            .checked_add(length)
            .context("extension archive size overflow")?;
        if total > MAX_UNPACKED_BYTES {
            bail!("extension archive expands beyond 32 MiB");
        }
        let mut bytes = Vec::with_capacity(length);
        file.read_to_end(&mut bytes)?;
        if bytes.len() != length || files.insert(name, bytes).is_some() {
            bail!("extension archive contains a duplicate or truncated entry");
        }
    }
    if !files.contains_key("clipsx-extension.toml") {
        bail!("extension archive must contain a manifest");
    }
    Ok(files)
}

fn allowed_path(name: &str) -> bool {
    matches!(
        name,
        "clipsx-extension.toml" | "component.wasm" | "README.md" | "LICENSE"
    ) || (name.starts_with("icons/") && name.ends_with(".svg") && name.matches('/').count() == 1)
        || (name.starts_with("ui/")
            && name
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."))
}

fn manifest_requires_component(manifest: &ExtensionManifest) -> bool {
    manifest.contributions.iter().any(|contribution| {
        (contribution.ui_surfaces.is_empty()
            && matches!(contribution.kind, super::ContributionKind::Renderer))
            || matches!(
                contribution.kind,
                super::ContributionKind::Detector | super::ContributionKind::Transformer
            )
            || matches!(contribution.handler, Some(super::ActionHandler::Guest))
    })
}

fn validate_assets(contents: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    for (path, bytes) in contents {
        if (path.starts_with("icons/") || path.starts_with("ui/")) && bytes.len() > MAX_ASSET_BYTES
        {
            bail!("extension UI asset exceeds 4 MiB");
        }
        if path.starts_with("icons/") {
            validate_svg(bytes)?;
        }
    }
    Ok(())
}

fn validate_declared_assets(
    manifest: &ExtensionManifest,
    contents: &BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    if let Some(icons) = &manifest.icon_assets {
        for (theme, icon) in [("light", &icons.light), ("dark", &icons.dark)] {
            if !contents.contains_key(icon) {
                bail!("extension package iconAssets.{theme} is not present in the package");
            }
        }
    }
    for contribution in &manifest.contributions {
        if let Some(icon) = &contribution.icon_asset {
            if !contents.contains_key(icon) {
                bail!("extension iconAsset is not present in the package");
            }
        }
        if let Some(icons) = &contribution.icon_assets {
            for (theme, icon) in [("light", &icons.light), ("dark", &icons.dark)] {
                if !contents.contains_key(icon) {
                    bail!("extension iconAssets.{theme} is not present in the package");
                }
            }
        }
        if let Some(entry) = &contribution.ui_entry {
            if !contents.contains_key(entry) {
                bail!("extension uiEntry is not present in the package");
            }
        }
    }
    Ok(())
}

/// Conservative allow-list validation. The host deliberately accepts a small
/// static SVG subset and renders it only through an image boundary.
fn validate_svg(bytes: &[u8]) -> Result<()> {
    let source = std::str::from_utf8(bytes).context("SVG icon must be UTF-8")?;
    if source.len() > 128 * 1024 || !source.trim_start().starts_with("<svg") {
        bail!("SVG icon is invalid or exceeds 128 KiB");
    }
    let lower = source.to_ascii_lowercase();
    let forbidden = [
        "<!",
        "<script",
        "<foreignobject",
        "<iframe",
        "<object",
        "<embed",
        "<image",
        "<use",
        "<animate",
        "<set",
        "<style",
        "href=",
        "xlink:",
        "javascript:",
        "data:",
    ];
    if forbidden.iter().any(|token| lower.contains(token))
        || !only_local_fragment_urls(&lower)
        || lower
            .split_whitespace()
            .any(|token| token.starts_with("on") && token.contains('='))
    {
        bail!("SVG icon contains unsupported active or external content");
    }
    Ok(())
}

fn only_local_fragment_urls(source: &str) -> bool {
    source.split("url(").skip(1).all(|tail| {
        let Some((value, _)) = tail.split_once(')') else {
            return false;
        };
        let value = value.trim();
        value.starts_with('#')
            && value.len() > 1
            && value[1..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    })
}

fn required<'a>(contents: &'a BTreeMap<String, Vec<u8>>, name: &str) -> Result<&'a [u8]> {
    contents
        .get(name)
        .map(Vec::as_slice)
        .context("extension archive is missing a required file")
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    format!("{:x}", hash.finalize())
}

fn catalog_icon_media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn validate_catalog_icon_descriptor(asset: &RegistryIconAsset) -> Result<()> {
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
        .context("registry v2 package is missing publisher metadata")?;
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
        bail!("registry v2 package metadata exceeds its limits");
    }
    for timestamp in [&package.published_at, &package.updated_at] {
        if timestamp
            .as_deref()
            .is_none_or(|value| value.len() < 10 || value.len() > 40)
        {
            bail!("registry v2 package timestamp is invalid");
        }
    }
    if package
        .archive_size_bytes
        .is_none_or(|size| size == 0 || size > MAX_ARCHIVE_BYTES as u64)
        || package.license.as_deref().is_none_or(str::is_empty)
    {
        bail!("registry v2 package archive metadata is invalid");
    }
    let icons = package
        .icon_assets
        .as_ref()
        .context("registry v2 package is missing icon assets")?;
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
        bail!("registry v2 package permission fingerprint is invalid");
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

impl RegistryPackage {
    fn schema_requires_permission_fingerprint(&self) -> bool {
        self.publisher.is_some() && self.permission_fingerprint.is_some()
    }
}

pub fn permission_fingerprint(manifest: &ExtensionManifest) -> String {
    hex_digest(&serde_json::to_vec(&manifest.permissions).expect("extension permissions serialize"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn rejects_non_release_url() {
        assert!(validate_release_url("https://example.com/a").is_err());
        assert!(
            validate_release_url("https://github.com/a/b/releases/download/v1/a.clipsx").is_ok()
        );
    }

    #[test]
    fn registry_verification_binds_exact_bytes_and_accepts_key_overlap() {
        let index = br#"{"schemaVersion":2,"packages":[]}"#;
        let old_key = SigningKey::from_bytes(&[7; 32]);
        let next_key = SigningKey::from_bytes(&[9; 32]);
        let signatures = serde_json::json!({
            "schemaVersion": 1,
            "signatures": [
                {
                    "keyId": "old",
                    "algorithm": "ed25519",
                    "signature": BASE64.encode(old_key.sign(index).to_bytes()),
                },
                {
                    "keyId": "next",
                    "algorithm": "ed25519",
                    "signature": BASE64.encode(next_key.sign(index).to_bytes()),
                }
            ]
        });
        let signatures = serde_json::to_vec(&signatures).unwrap();
        let trusted = [("next", next_key.verifying_key().to_bytes())];
        assert!(verify_registry_signatures_with_keys(index, &signatures, &trusted).is_ok());
        assert!(verify_registry_signatures_with_keys(b"tampered", &signatures, &trusted).is_err());
    }

    #[test]
    fn registry_v1_remains_a_limited_cached_catalog() {
        let index = RegistryIndex::parse(
            br#"{"schemaVersion":1,"packages":[{"packageId":"clipsx.example","version":"1.0.0","apiVersion":"2.0.0","displayName":"Example","releaseUrl":"https://github.com/a/b/releases/download/v1/example.clipsx","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}"#,
        )
        .unwrap();
        assert_eq!(index.schema_version, 1);
        assert!(index.packages[0].publisher.is_none());
    }

    #[test]
    fn registry_v3_requires_reviewed_marketplace_metadata_and_hashed_icons() {
        let valid = r#"{"schemaVersion":3,"packages":[{"packageId":"clipsx.example","version":"1.0.0","apiVersion":"2.0.0","displayName":"Example","releaseUrl":"https://github.com/a/b/releases/download/v1/example.clipsx","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","publisher":{"id":"clipsx","displayName":"ClipsX","verified":true},"categories":["Productivity"],"tags":["clipboard"],"publishedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","archiveSizeBytes":1024,"license":"MIT","iconAssets":{"light":{"url":"https://raw.githubusercontent.com/azure06/clipsx-registry/main/icons/example-light.png","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"dark":{"url":"https://raw.githubusercontent.com/azure06/clipsx-registry/main/icons/example-dark.png","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}},"permissionFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],"revocations":[]}"#;
        assert!(RegistryIndex::parse(valid.as_bytes()).is_ok());
        let missing_publisher = valid.replacen(
            "\"publisher\":{\"id\":\"clipsx\",\"displayName\":\"ClipsX\",\"verified\":true},",
            "",
            1,
        );
        assert!(RegistryIndex::parse(missing_publisher.as_bytes()).is_err());
    }

    #[test]
    fn registry_revocations_bind_package_version_and_checksum() {
        let index = RegistryIndex::parse(
            br#"{"schemaVersion":3,"packages":[],"revocations":[{"packageId":"example.tools","version":"1.2.3","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"compromised release"}]}"#,
        )
        .unwrap();
        assert!(index
            .revocation(
                "example.tools",
                "1.2.3",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            )
            .is_some());
        assert!(index
            .revocation(
                "example.tools",
                "1.2.4",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            )
            .is_none());
    }

    #[test]
    fn catalog_icons_are_raster_bounded_and_hash_pinned() {
        let root = tempfile::tempdir().unwrap();
        let store = ExtensionPackageStore::new(root.path().into()).unwrap();
        let bytes = b"\x89PNG\r\n\x1a\nfixture";
        let descriptor = RegistryIconAsset {
            url: "https://raw.githubusercontent.com/azure06/clipsx-registry/main/icons/test.png"
                .into(),
            sha256: hex_digest(bytes),
            data_url: None,
        };
        store.cache_catalog_icon(&descriptor, bytes).unwrap();

        let mut corrupt = descriptor.clone();
        corrupt.sha256 = "a".repeat(64);
        assert!(store.cache_catalog_icon(&corrupt, bytes).is_err());
        assert!(store
            .cache_catalog_icon(&descriptor, b"<svg></svg>")
            .is_err());
    }

    #[test]
    fn package_store_rejects_traversal_before_publish() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("../component.wasm", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"not a component").unwrap();
        let archive = writer.finish().unwrap().into_inner();
        let root = tempfile::tempdir().unwrap();
        let store = ExtensionPackageStore::new(root.path().into()).unwrap();
        assert!(store
            .install(&archive, InstallSource::Developer, None)
            .is_err());
        assert!(!root.path().join("packages").join("component.wasm").exists());
    }

    #[tokio::test]
    #[ignore = "requires CLIPSX_TEST_EXTENSION_ARCHIVE to point to a packed .clipsx archive"]
    async fn packed_extension_completes_host_store_install_and_load() {
        let archive_path = std::env::var("CLIPSX_TEST_EXTENSION_ARCHIVE")
            .expect("CLIPSX_TEST_EXTENSION_ARCHIVE must name the package under test");
        let archive = fs::read(archive_path).unwrap();
        let root = tempfile::tempdir().unwrap();
        let store = ExtensionPackageStore::new(root.path().into()).unwrap();

        let installed = store
            .install(&archive, InstallSource::Developer, None)
            .unwrap();
        let loaded = store.load(&installed.relative_path).unwrap();

        assert_eq!(loaded.manifest.package_id, installed.manifest.package_id);
        assert_eq!(loaded.manifest.version, installed.manifest.version);
        assert_eq!(loaded.sha256, installed.sha256);
        assert!(loaded
            .component_path
            .as_ref()
            .is_some_and(|path| path.exists()));
        let runtime = crate::extensions::runtime::ExtensionRuntime::new().unwrap();
        runtime
            .validate_component(
                &loaded.sha256,
                loaded
                    .component_path
                    .as_deref()
                    .expect("package must contain its declared component"),
            )
            .await
            .unwrap();
        let declared_asset = installed
            .manifest
            .contributions
            .iter()
            .find_map(|contribution| contribution.ui_entry.as_deref())
            .or_else(|| {
                installed
                    .manifest
                    .icon_assets
                    .as_ref()
                    .map(|icons| icons.light.as_str())
            })
            .expect("package must declare a UI entry or identity icon");
        assert!(!store
            .package_asset(&installed.relative_path, declared_asset)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_active_and_external_svg_content() {
        assert!(validate_svg(
            br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>"#
        )
        .is_ok());
        assert!(validate_svg(
            br#"<svg><defs><clipPath id="icon"><path d="M0 0h1v1z"/></clipPath></defs><g clip-path="url(#icon)"/></svg>"#
        )
        .is_ok());
        for malicious in [
            br#"<svg onload="alert(1)"></svg>"#.as_slice(),
            br#"<svg><script>alert(1)</script></svg>"#.as_slice(),
            br#"<svg><foreignObject><html/></foreignObject></svg>"#.as_slice(),
            br#"<svg><use href="https://example.com/icon.svg#x"/></svg>"#.as_slice(),
            br#"<!DOCTYPE svg><svg></svg>"#.as_slice(),
            br#"<svg><path fill="url(https://example.com/icon.svg)"/></svg>"#.as_slice(),
        ] {
            assert!(validate_svg(malicious).is_err());
        }
    }

    #[test]
    fn package_asset_paths_are_scoped() {
        assert!(allowed_path("ui/assets/app.js"));
        assert!(allowed_path("icons/action.svg"));
        assert!(!allowed_path("ui/../component.wasm"));
        assert!(!allowed_path("icons/nested/action.svg"));
        assert!(!allowed_path("other/app.js"));
    }
}
