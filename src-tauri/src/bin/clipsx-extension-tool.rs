use std::{
    collections::BTreeMap,
    env, fs,
    io::{Cursor, Read, Write},
    path::Path,
};

use anyhow::{bail, Context, Result};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const API_VERSION: &str = "2.0.0";
#[allow(dead_code)]
#[path = "../extensions/manifest.rs"]
mod manifest;

const ALLOWED: &[&str] = &[
    "clipsx-extension.toml",
    "component.wasm",
    "README.md",
    "LICENSE",
];

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
    for name in ALLOWED {
        let path = input.join(name);
        if path.exists() {
            files.insert(
                *name,
                fs::read(&path).with_context(|| format!("unable to read {name}"))?,
            );
        }
    }
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
        if entry.is_dir() || !ALLOWED.contains(&name.as_str()) {
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

fn validate_contents<T: AsRef<str>>(files: &BTreeMap<T, Vec<u8>>) -> Result<()> {
    let find = |name: &str| {
        files
            .iter()
            .find(|(key, _)| key.as_ref() == name)
            .map(|(_, value)| value)
    };
    let manifest_bytes = find("clipsx-extension.toml").context("manifest is missing")?;
    manifest::ExtensionManifest::parse(manifest_bytes)?;
    let component = find("component.wasm").context("component.wasm is missing")?;
    if component.len() > 8 * 1024 * 1024 || !component.starts_with(b"\0asm") {
        bail!("component.wasm is oversized or is not WebAssembly");
    }
    Ok(())
}
