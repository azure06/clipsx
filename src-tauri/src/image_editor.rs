//! Explicit export of a clip-owned image. Canonical and artifact files are never opened for editing.
use crate::{contracts::ImageSource, history::HistoryRepository};
use anyhow::{bail, Context, Result};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub async fn prepare(
    repo: &HistoryRepository,
    directory: &Path,
    clip_id: &str,
    source: &ImageSource,
) -> Result<PathBuf> {
    let (bytes, mime) = match source {
        ImageSource::Managed { asset_id } => {
            let owns: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM clip_representations r JOIN clip_items c ON c.id=r.clip_id WHERE r.clip_id=? AND r.binary_file_id=? AND r.lifecycle_state='ready' AND c.lifecycle_state='ready' AND r.canonical_mime_type LIKE 'image/%')")
                .bind(clip_id).bind(asset_id).fetch_one(&repo.pool).await?;
            if !owns {
                bail!("image is not owned by this clip")
            }
            repo.asset(asset_id).await?
        }
        ImageSource::ArtifactFile { file_id } => {
            let owns: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM artifact_binary_files b JOIN artifact_records a ON a.id=b.artifact_id JOIN clip_items c ON c.id=a.owner_clip_id WHERE a.owner_clip_id=? AND b.id=? AND b.lifecycle_state='ready' AND a.lifecycle_state='ready' AND c.lifecycle_state='ready' AND NOT EXISTS(SELECT 1 FROM extension_result_outputs o JOIN extension_jobs j ON j.id=o.job_id WHERE o.artifact_id=a.id AND j.status!='completed'))")
                .bind(clip_id).bind(file_id).fetch_one(&repo.pool).await?;
            if !owns {
                bail!("image result is not owned by this clip")
            }
            crate::artifacts::artifact_binary(repo, file_id).await?
        }
    };
    export_copy(directory, &bytes, &mime)
}

fn export_copy(directory: &Path, bytes: &[u8], mime: &str) -> Result<PathBuf> {
    // Use the verified payload's format, not a filename or arbitrary MIME supplied by the webview.
    let format = image::guess_format(bytes).context("unsupported image format")?;
    let extension = match (mime, format) {
        ("image/png", image::ImageFormat::Png) => "png",
        ("image/jpeg", image::ImageFormat::Jpeg) => "jpg",
        ("image/gif", image::ImageFormat::Gif) => "gif",
        ("image/webp", image::ImageFormat::WebP) => "webp",
        ("image/bmp", image::ImageFormat::Bmp) => "bmp",
        ("image/tiff", image::ImageFormat::Tiff) => "tiff",
        ("image/avif", image::ImageFormat::Avif) => "avif",
        ("image/x-icon" | "image/vnd.microsoft.icon", image::ImageFormat::Ico) => "ico",
        _ => bail!("image type does not match its payload"),
    };
    fs::create_dir_all(directory)?;
    let path = directory.join(format!("image-{}.{}", uuid::Uuid::now_v7(), extension));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(error.into());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_export_preserves_bytes_and_never_replaces_an_edited_copy() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = b"\x89PNG\r\n\x1a\noriginal";
        let first = export_copy(temp.path(), bytes, "image/png").unwrap();
        fs::write(&first, b"edited").unwrap();
        let second = export_copy(temp.path(), bytes, "image/png").unwrap();
        assert_ne!(first, second);
        assert_eq!(second.extension().unwrap(), "png");
        assert_eq!(fs::read(second).unwrap(), bytes);
        assert_eq!(fs::read(first).unwrap(), b"edited");
        assert!(export_copy(temp.path(), bytes, "image/jpeg").is_err());
        assert!(export_copy(temp.path(), b"not an image", "image/png").is_err());
        let blocked = temp.path().join("file");
        fs::write(&blocked, b"file").unwrap();
        assert!(export_copy(&blocked, bytes, "image/png").is_err());
    }
    #[tokio::test]
    async fn image_export_requires_live_ownership_and_verified_original_bytes() {
        use crate::{
            foundation::{self, AppRoots},
            history::{
                sha256, CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
            },
        };
        let temp = tempfile::tempdir().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let bytes = b"\x89PNG\r\n\x1a\noriginal";
        let (clip, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: vec![],
                    representations: vec![CapturedRepresentation {
                        format_key: "windows:PNG".into(),
                        canonical_mime_type: Some("image/png".into()),
                        native_type: Some("PNG".into()),
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Binary(bytes.to_vec()),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let detail = repo.detail(&clip).await.unwrap();
        let source = ImageSource::Managed {
            asset_id: detail.representations[0].binary_file_id.clone().unwrap(),
        };
        let directory = roots.data.join("editor_previews");
        assert!(prepare(&repo, &directory, "another-clip", &source)
            .await
            .is_err());
        let path = prepare(&repo, &directory, &clip, &source).await.unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::write(path, b"edited externally").unwrap();
        let ImageSource::Managed { asset_id } = &source else {
            unreachable!()
        };
        assert_eq!(repo.asset(asset_id).await.unwrap().0, bytes);
        let relative = "managed/derived/editor-test";
        let artifact_path = repo.managed_root.join(relative);
        fs::create_dir_all(artifact_path.parent().unwrap()).unwrap();
        fs::write(&artifact_path, bytes).unwrap();
        sqlx::query("INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,lifecycle_state,created_at,updated_at) VALUES('editor-artifact',?,'thumbnail','test','1',?,'ready',1,1)").bind(&clip).bind("a".repeat(64)).execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO artifact_binary_files(id,artifact_id,sha256,byte_length,relative_path,lifecycle_state) VALUES('editor-file','editor-artifact',?,?,?,'ready')").bind(sha256(bytes)).bind(bytes.len() as i64).bind(relative).execute(&repo.pool).await.unwrap();
        let artifact = ImageSource::ArtifactFile {
            file_id: "editor-file".into(),
        };
        assert!(prepare(&repo, &directory, "another-clip", &artifact)
            .await
            .is_err());
        assert_eq!(
            fs::read(prepare(&repo, &directory, &clip, &artifact).await.unwrap()).unwrap(),
            bytes
        );
        fs::write(&artifact_path, b"corrupt").unwrap();
        assert!(prepare(&repo, &directory, &clip, &artifact).await.is_err());
        fs::write(&artifact_path, bytes).unwrap();
        sqlx::query(
            "UPDATE artifact_records SET lifecycle_state='invalidated' WHERE id='editor-artifact'",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        assert!(prepare(&repo, &directory, &clip, &artifact).await.is_err());
        repo.delete(&clip).await.unwrap();
        assert!(prepare(&repo, &directory, &clip, &source).await.is_err());
    }
}
