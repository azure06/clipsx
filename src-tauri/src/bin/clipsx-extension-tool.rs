use std::{
    collections::BTreeMap,
    env, fs,
    io::{Cursor, Read, Write},
    path::Path,
};

use anyhow::{bail, Context, Result};
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
        [_, command, input, output] if command == "pack" => {
            pack(Path::new(input), Path::new(output))
        }
        _ => bail!(
            "usage: clipsx-extension-tool validate <package.clipsx> | pack <directory> <package.clipsx>"
        ),
    }
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
    validate_contents(&files)?;
    println!("valid Extension API v2 package: {}", path.display());
    Ok(())
}

fn validate_contents(files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    let find = |name: &str| files.get(name);
    let manifest_bytes = find("clipsx-extension.toml").context("manifest is missing")?;
    let manifest = manifest::ExtensionManifest::parse(manifest_bytes)?;
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
