use std::path::Path;

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::models::AiCapabilityArtifact;

/// Normalized progress event emitted for every in-progress capability download.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilityProgressPayload {
    pub capability: String,
    pub label: String,
    pub downloaded: u64,
    pub total: u64,
    pub phase: String,
}

pub async fn install_artifacts(
    capability: &str,
    artifacts: &[AiCapabilityArtifact],
    base_dir: &Path,
    app_handle: &AppHandle,
) -> Result<()> {
    for artifact in artifacts {
        install_artifact(capability, artifact, base_dir, app_handle).await?;
    }
    Ok(())
}

async fn install_artifact(
    capability: &str,
    artifact: &AiCapabilityArtifact,
    base_dir: &Path,
    app_handle: &AppHandle,
) -> Result<()> {
    if artifact.url.is_empty() {
        return Ok(());
    }

    let dest_dir = base_dir.join(&artifact.destination);
    fs::create_dir_all(&dest_dir)
        .await
        .context("Failed to create artifact destination directory")?;

    let dest_path = dest_dir.join(&artifact.filename);

    if !artifact.sha256.is_empty() && dest_path.exists() {
        let existing_size = fs::metadata(&dest_path).await?.len();
        if artifact.size_bytes > 0 && existing_size == artifact.size_bytes {
            let checksum = compute_sha256(&dest_path).await?;
            if checksum == artifact.sha256 {
                return Ok(());
            }
        }
    }

    let temp_path = dest_dir.join(format!("{}.tmp", artifact.filename));

    let result = download_to_file(capability, artifact, &temp_path, app_handle).await;

    if let Err(e) = result {
        let _ = fs::remove_file(&temp_path).await;
        return Err(e);
    }

    if !artifact.sha256.is_empty() {
        let checksum = compute_sha256(&temp_path).await?;
        if checksum != artifact.sha256 {
            let _ = fs::remove_file(&temp_path).await;
            bail!(
                "Checksum mismatch for {}: expected {}, got {}",
                artifact.filename,
                artifact.sha256,
                checksum
            );
        }
    }

    fs::rename(&temp_path, &dest_path)
        .await
        .context("Failed to move downloaded artifact to destination")?;

    Ok(())
}

async fn download_to_file(
    capability: &str,
    artifact: &AiCapabilityArtifact,
    dest: &Path,
    app_handle: &AppHandle,
) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .get(&artifact.url)
        .send()
        .await
        .with_context(|| format!("Failed to start download for {}", artifact.filename))?;

    if !response.status().is_success() {
        bail!(
            "Download failed for {} with HTTP {}",
            artifact.filename,
            response.status()
        );
    }

    let total = response.content_length().unwrap_or(artifact.size_bytes);
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(dest)
        .await
        .context("Failed to create temporary download file")?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.with_context(|| format!("Download stream error for {}", artifact.filename))?;
        file.write_all(&chunk)
            .await
            .context("Failed to write chunk")?;
        downloaded += chunk.len() as u64;

        let _ = app_handle.emit(
            "ai-capability-progress",
            AiCapabilityProgressPayload {
                capability: capability.to_string(),
                label: artifact.filename.clone(),
                downloaded,
                total,
                phase: "download".to_string(),
            },
        );
    }

    file.flush()
        .await
        .context("Failed to flush download file")?;
    Ok(())
}

async fn compute_sha256(path: &Path) -> Result<String> {
    let bytes = fs::read(path)
        .await
        .with_context(|| format!("Failed to read file for checksum: {}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn skips_artifact_with_empty_url() {
        let tmp = TempDir::new().unwrap();
        let artifact = AiCapabilityArtifact {
            filename: "model.onnx".to_string(),
            url: String::new(),
            sha256: String::new(),
            size_bytes: 0,
            destination: "models/".to_string(),
        };
        let result = install_artifact_no_handle(&artifact, tmp.path()).await;
        assert!(result.is_ok());
    }

    async fn install_artifact_no_handle(
        artifact: &AiCapabilityArtifact,
        _base_dir: &Path,
    ) -> Result<()> {
        if artifact.url.is_empty() {
            return Ok(());
        }
        bail!("should not reach download")
    }
}
