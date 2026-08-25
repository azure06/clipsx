use std::{
    collections::BTreeMap,
    env, fs,
    io::{Cursor, Read, Write},
    path::Path,
};

use anyhow::{bail, Context, Result};
use serde_json::json;
use sha2::{Digest, Sha256};
use wit_component::ComponentEncoder;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const API_VERSION: &str = "2.0.0";
#[allow(dead_code)]
#[path = "../extensions/manifest.rs"]
mod manifest;

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    match args.as_slice() {
        [_, command, input] if command == "validate" => validate(Path::new(input)),
        [_, command, input] if command == "inspect" => inspect(Path::new(input)),
        [_, command, input] if command == "test" => test_package(Path::new(input)),
        [_, command, input, output] if command == "pack" => {
            pack(Path::new(input), Path::new(output))
        }
        [_, command, output, package_id] if command == "scaffold" => {
            scaffold(Path::new(output), package_id)
        }
        [_, command, input, release_url] if command == "registry-entry" => {
            registry_entry(Path::new(input), release_url)
        }
        _ => bail!(
            "usage: clipsx-extension-tool scaffold <directory> <package-id> | pack <directory> <package.clipsx> | validate|inspect|test <package.clipsx> | registry-entry <package.clipsx> <github-release-url>"
        ),
    }
}

fn scaffold(output: &Path, package_id: &str) -> Result<()> {
    if output.exists() || package_id.is_empty() || package_id.len() > 120 {
        bail!("scaffold destination must be new and package ID must be bounded");
    }
    let display_name = package_id
        .split(['.', '-'])
        .next_back()
        .unwrap_or(package_id)
        .replace('_', " ");
    fs::create_dir_all(output.join("icons"))?;
    fs::create_dir_all(output.join("ui"))?;
    fs::write(
        output.join("clipsx-extension.toml"),
        format!(
            "schemaVersion = 2\ncontractRevision = 2\npackageId = \"{package_id}\"\nversion = \"0.1.0\"\napiVersion = \"^2.0\"\ndisplayName = \"{display_name}\"\ndescription = \"A ClipsX Extension API v2 package.\"\nlicense = \"MIT\"\niconAssets = {{ light = \"icons/package.svg\", dark = \"icons/package.svg\" }}\n\n[[contributions]]\nid = \"text-view\"\nkind = \"renderer\"\ndisplayName = \"Text view\"\npurpose = \"source\"\nsurfaces = [\"detail\"]\nuiEntry = \"ui/index.html\"\nuiSurfaces = [\"detail\"]\n\n[[contributions.matchers]]\nmimeTypes = [\"text/plain\"]\n"
        ),
    )?;
    fs::write(output.join("README.md"), format!("# {display_name}\n"))?;
    fs::write(
        output.join("icons/package.svg"),
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="#7c3aed"/></svg>"##,
    )?;
    fs::write(output.join("ui/index.html"), "<!doctype html><meta charset=\"utf-8\"><title>ClipsX extension</title><main id=\"app\">Extension view</main>")?;
    println!("scaffolded {}", output.display());
    Ok(())
}

fn pack(input: &Path, output: &Path) -> Result<()> {
    let mut files = BTreeMap::new();
    collect_package_files(input, input, &mut files)?;
    componentize_core_module(&mut files)?;
    validate_contents(&files)?;
    if output.extension().and_then(|value| value.to_str()) != Some("clipsx") {
        bail!("extension package output must use the .clipsx suffix");
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = fs::File::create(output)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in files {
        archive.start_file(name, options)?;
        archive.write_all(&bytes)?;
    }
    archive.finish()?;
    println!("packed {}", output.display());
    Ok(())
}

/// Guest crates build a core module for `wasm32-unknown-unknown`. The package
/// tool owns the final componentization step so extension authors never need
/// ambient WASI just to produce a Component Model artifact.
fn componentize_core_module(files: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
    let Some(component) = files.get("component.wasm") else {
        return Ok(());
    };
    if !is_core_module(component) {
        return Ok(());
    }
    let mut encoder = ComponentEncoder::default()
        .module(component)
        .context("component.wasm cannot be componentized; build it with wit-bindgen for wasm32-unknown-unknown")?
        .validate(true);
    let encoded = encoder
        .encode()
        .context("component.wasm componentization failed")?;
    files.insert("component.wasm".into(), encoded);
    Ok(())
}

fn is_core_module(bytes: &[u8]) -> bool {
    bytes.get(0..8) == Some(b"\0asm\x01\0\0\0")
}

fn validate(path: &Path) -> Result<()> {
    let files = archive_files(path)?;
    validate_contents(&files)?;
    println!("valid Extension API v2 package: {}", path.display());
    Ok(())
}

fn archive_files(path: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    if path.extension().and_then(|value| value.to_str()) != Some("clipsx") {
        bail!("extension package must use the .clipsx suffix");
    }
    let bytes = fs::read(path)?;
    if bytes.len() > 16 * 1024 * 1024 {
        bail!("extension archive exceeds 16 MiB");
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let mut files = BTreeMap::new();
    let mut total = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_string();
        if entry.is_dir() || !allowed_path(&name) {
            bail!("extension archive contains unsupported entry {name}");
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        total += bytes.len();
        if total > 32 * 1024 * 1024 || files.insert(name, bytes).is_some() {
            bail!("extension archive is oversized or contains duplicate entries");
        }
    }
    Ok(files)
}

fn inspect(path: &Path) -> Result<()> {
    let files = archive_files(path)?;
    validate_contents(&files)?;
    let manifest = manifest::ExtensionManifest::parse(&files["clipsx-extension.toml"])?;
    let archive = fs::read(path)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "packageId": manifest.package_id,
            "version": manifest.version,
            "apiVersion": manifest.api_version,
            "compatible": manifest.api_version == API_VERSION || manifest.api_version == "^2.0",
            "archiveSizeBytes": archive.len(),
            "sha256": hex_digest(&archive),
            "contributions": manifest.contributions.iter().map(|item| item.id.clone()).collect::<Vec<_>>(),
            "permissions": manifest.permissions,
        }))?
    );
    Ok(())
}

fn test_package(path: &Path) -> Result<()> {
    let files = archive_files(path)?;
    validate_contents(&files)?;
    if let Some(component) = files.get("component.wasm") {
        let mut config = wasmtime::Config::new();
        config.wasm_component_model(true);
        let engine = wasmtime::Engine::new(&config)
            .map_err(|error| anyhow::anyhow!("Wasmtime engine setup failed: {error}"))?;
        wasmtime::component::Component::new(&engine, component)
            .map_err(|error| anyhow::anyhow!("component failed Wasmtime validation: {error}"))?;
    }
    println!("package tests passed: compatibility, manifest, assets, limits, and component");
    Ok(())
}

fn registry_entry(path: &Path, release_url: &str) -> Result<()> {
    if !release_url.starts_with("https://github.com/")
        || !release_url.contains("/releases/download/")
    {
        bail!("registry entry requires an HTTPS GitHub release URL");
    }
    let files = archive_files(path)?;
    validate_contents(&files)?;
    let manifest = manifest::ExtensionManifest::parse(&files["clipsx-extension.toml"])?;
    let archive = fs::read(path)?;
    let permissions = serde_json::to_vec(&manifest.permissions)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "packageId": manifest.package_id,
            "version": manifest.version,
            "apiVersion": manifest.api_version,
            "displayName": manifest.display_name,
            "description": manifest.description,
            "releaseUrl": release_url,
            "sha256": hex_digest(&archive),
            "archiveSizeBytes": archive.len(),
            "permissionFingerprint": hex_digest(&permissions),
            "permissionReport": manifest.permissions,
        }))?
    );
    Ok(())
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_contents(files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    let find = |name: &str| files.get(name);
    let manifest_bytes = find("clipsx-extension.toml").context("manifest is missing")?;
    let manifest = manifest::ExtensionManifest::parse(manifest_bytes)?;
    if let Some(icons) = &manifest.icon_assets {
        for icon in [&icons.light, &icons.dark] {
            find(icon).with_context(|| format!("declared package icon {icon} is missing"))?;
        }
    }
    if let Some(component) = find("component.wasm") {
        if component.len() > 8 * 1024 * 1024 || !component.starts_with(b"\0asm") {
            bail!("component.wasm is oversized or is not WebAssembly");
        }
        if is_core_module(component) {
            bail!("component.wasm is a core module; package it with clipsx-extension-tool so it can be converted to a no-WASI component");
        }
    } else if manifest.contributions.iter().any(|contribution| {
        matches!(
            contribution.kind,
            manifest::ContributionKind::Detector | manifest::ContributionKind::Transformer
        ) || (matches!(contribution.kind, manifest::ContributionKind::Renderer)
            && contribution.ui_surfaces.is_empty())
            || matches!(contribution.handler, Some(manifest::ActionHandler::Guest))
    }) {
        bail!("component.wasm is required by declared guest logic");
    }
    for contribution in &manifest.contributions {
        if let Some(icon) = &contribution.icon_asset {
            find(icon).with_context(|| format!("declared icon asset {icon} is missing"))?;
        }
        if let Some(entry) = &contribution.ui_entry {
            find(entry).with_context(|| format!("declared UI entry {entry} is missing"))?;
        }
    }
    Ok(())
}

fn collect_package_files(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_package_files(root, &path, files)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        if allowed_path(&relative) {
            files.insert(
                relative.clone(),
                fs::read(&path).with_context(|| format!("unable to read {relative}"))?,
            );
        }
    }
    Ok(())
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
