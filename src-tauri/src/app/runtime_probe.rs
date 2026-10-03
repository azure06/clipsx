//! Explicit packaging probe; never opens application storage or initializes telemetry.
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::path::Path;

pub async fn verify(path: &Path) -> Result<()> {
    if tokio::fs::metadata(path).await?.len() > 8 * 1024 * 1024 {
        anyhow::bail!("extension component exceeds 8 MiB");
    }
    let directory = tempfile::tempdir()?;
    let runtime = crate::extensions::runtime::ExtensionRuntime::new(directory.path())?;
    let bytes = tokio::fs::read(path).await?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    runtime.validate_component(&hash, path).await?;
    println!("extension-runtime verified sha256={hash} cold_cache=true");
    Ok(())
}
