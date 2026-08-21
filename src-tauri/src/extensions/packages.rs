use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive};

use super::ExtensionManifest;

const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
const MAX_UNPACKED_BYTES: usize = 32 * 1024 * 1024;
const MAX_COMPONENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 2 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryIndex {
    pub schema_version: u32,
    pub packages: Vec<RegistryPackage>,
}

impl RegistryIndex {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > 2 * 1024 * 1024 {
            bail!("registry index exceeds 2 MiB");
        }
        let index: Self =
            serde_json::from_slice(bytes).context("registry index is not valid JSON")?;
        if index.schema_version != 1 || index.packages.len() > 10_000 {
            bail!("unsupported or oversized registry index");
        }
        let mut entries = BTreeMap::new();
        for package in &index.packages {
            ExtensionManifest::parse(format!(
                "schemaVersion = 2\npackageId = \"{}\"\nversion = \"{}\"\napiVersion = \"{}\"\ndisplayName = \"{}\"\n[[contributions]]\nid = \"placeholder\"\nkind = \"detector\"\ndisplayName = \"placeholder\"\nemitsFacetIds = [\"placeholder\"]\n",
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
            if entries
                .insert((&package.package_id, &package.version), ())
                .is_some()
            {
                bail!("registry contains duplicate package versions");
            }
        }
        Ok(index)
    }

    pub fn find(&self, package_id: &str, version: &str) -> Option<&RegistryPackage> {
        self.packages
            .iter()
            .find(|entry| entry.package_id == package_id && entry.version == version)
    }
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
        self.root.join("cache").join("registry-v1.json")
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn packages_root(&self) -> PathBuf {
        self.root.join("packages")
    }

    pub fn cache_registry(&self, bytes: &[u8]) -> Result<RegistryIndex> {
        let index = RegistryIndex::parse(bytes)?;
        let staged = self
            .root
            .join("staging")
            .join(format!("registry-{}.pending", Uuid::now_v7()));
        fs::write(&staged, bytes)?;
        fs::rename(staged, self.cache_path())?;
        Ok(index)
    }

    pub fn cached_registry(&self) -> Result<Option<RegistryIndex>> {
        let path = self.cache_path();
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(RegistryIndex::parse(&fs::read(path)?)?))
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
            bail!("extension UI asset exceeds 2 MiB");
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
    for contribution in &manifest.contributions {
        if let Some(icon) = &contribution.icon_asset {
            if !contents.contains_key(icon) {
                bail!("extension iconAsset is not present in the package");
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
        "url(",
        "href=",
        "xlink:",
        "javascript:",
        "data:",
    ];
    if forbidden.iter().any(|token| lower.contains(token))
        || lower
            .split_whitespace()
            .any(|token| token.starts_with("on") && token.contains('='))
    {
        bail!("SVG icon contains unsupported active or external content");
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
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
}
