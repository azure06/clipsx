//! macOS owns native crash capture. Reports are read and submitted only on request.
use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_REPORT_BYTES: u64 = 5_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub path: String,
    pub sha256: String,
    pub text: String,
}

pub fn read(path: &Path) -> Result<CrashReport> {
    if path.extension().and_then(|part| part.to_str()) != Some("ips") {
        bail!("Select a macOS .ips crash report");
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_REPORT_BYTES
    {
        bail!("Crash report must be a regular file smaller than 5 MB");
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAX_REPORT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        bail!("Crash report exceeds 5 MB");
    }
    let text = String::from_utf8(bytes).context("Crash report is not UTF-8")?;
    let documents = serde_json::Deserializer::from_str(&text)
        .into_iter::<serde_json::Value>()
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Crash report is not valid JSON")?;
    if documents.is_empty()
        || documents.len() > 2
        || !documents.iter().any(|value| {
            value["bundleID"] == "com.infiniti.clipsx"
                || value["bundleInfo"]["CFBundleIdentifier"] == "com.infiniti.clipsx"
        })
        || !documents
            .iter()
            .any(|value| value.get("exception").is_some() || value.get("termination").is_some())
    {
        bail!("This is not a ClipsX crash report");
    }
    Ok(CrashReport {
        path: path.to_string_lossy().into(),
        sha256: format!("{:x}", Sha256::digest(text.as_bytes())),
        text,
    })
}

pub fn selected(path: &Path, sha256: &str) -> Result<CrashReport> {
    let report = read(path)?;
    if report.sha256 != sha256 {
        bail!("Crash report changed; review it again before sending");
    }
    Ok(report)
}

pub fn export(path: &Path, sha256: &str, destination: &Path) -> Result<()> {
    let report = selected(path, sha256)?;
    fs::write(destination, report.text)?;
    Ok(())
}

pub fn discover() -> Option<CrashReport> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let home = std::env::var_os("HOME")?;
    let directory = PathBuf::from(home).join("Library/Logs/DiagnosticReports");
    let mut files = fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .starts_with("clipsx")
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect::<Vec<_>>();
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    files
        .into_iter()
        .take(10)
        .find_map(|(_, path)| read(&path).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_apple_reports_without_reading_other_app_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ClipsX.ips");
        fs::write(
            &path,
            "{\"bundleID\":\"com.infiniti.clipsx\"}\n{\"exception\":{\"type\":\"EXC_BAD_ACCESS\"}}",
        )
        .unwrap();
        let report = read(&path).unwrap();
        assert_eq!(report.sha256.len(), 64);
        assert!(selected(&path, "tampered").is_err());
        let copy = directory.path().join("export.ips");
        export(&path, &report.sha256, &copy).unwrap();
        assert_eq!(read(&copy).unwrap().text, report.text);
        fs::write(&path, "{\"bundleID\":\"com.other.app\",\"exception\":{}}").unwrap();
        assert!(read(&path).is_err());
        fs::write(&path, "malformed").unwrap();
        assert!(read(&path).is_err());
        fs::write(&path, "{\"bundleID\":\"com.infiniti.clipsx\"}").unwrap();
        assert!(read(&path).is_err());
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_REPORT_BYTES + 1)
            .unwrap();
        assert!(read(&path).is_err());
    }
}
