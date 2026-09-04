use crate::{
    foundation::AppRoots,
    history::{CapturedPayload, HistoryRepository},
};
use anyhow::{bail, Context, Result};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime},
};
use tauri::WebviewWindow;
use uuid::Uuid;

const STALE_SHARE_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PreparedShare {
    Url(String),
    Text(String),
    Files(Vec<PathBuf>),
}

pub async fn prepare(
    repository: &HistoryRepository,
    roots: &AppRoots,
    clip_id: &str,
) -> Result<PreparedShare> {
    let detail = repository.detail(clip_id).await?;
    if let Some(text) = detail
        .representations
        .iter()
        .filter(|item| {
            item.storage_kind == "text" && item.canonical_mime_type.as_deref() == Some("text/plain")
        })
        .min_by_key(|item| (item.capture_priority, item.ordinal))
        .and_then(|item| item.text_value.clone())
    {
        if let Ok(url) = url::Url::parse(text.trim()) {
            if matches!(url.scheme(), "http" | "https") {
                #[cfg(target_os = "linux")]
                return export_bytes(roots, url.as_str().as_bytes(), "txt");
                #[cfg(not(target_os = "linux"))]
                return Ok(PreparedShare::Url(url.into()));
            }
        }
        #[cfg(target_os = "linux")]
        return export_bytes(roots, text.as_bytes(), "txt");
        #[cfg(not(target_os = "linux"))]
        return Ok(PreparedShare::Text(text));
    }

    if let Some(files) = detail
        .representations
        .iter()
        .filter(|item| item.storage_kind == "file_list")
        .min_by_key(|item| (item.capture_priority, item.ordinal))
        .map(|item| {
            item.file_references
                .iter()
                .map(PathBuf::from)
                .filter(|path| path.is_file())
                .collect::<Vec<_>>()
        })
    {
        if files.is_empty() {
            bail!("the shared files no longer exist")
        }
        return Ok(PreparedShare::Files(files));
    }

    let representation = detail
        .representations
        .iter()
        .filter(|item| {
            is_exportable(
                item.canonical_mime_type.as_deref(),
                &item.format_family,
                &item.storage_kind,
            )
        })
        .min_by_key(|item| (item.capture_priority, item.ordinal))
        .context("this clip has no safely shareable representation")?;
    let (source, _) = repository
        .source_representation(clip_id, &representation.id)
        .await?;
    let bytes = match source.payload {
        CapturedPayload::Text(text) => text.into_bytes(),
        CapturedPayload::Binary(bytes) => bytes,
        CapturedPayload::Files(_) => bail!("invalid export representation"),
    };
    let extension = extension_for(
        representation.canonical_mime_type.as_deref(),
        &representation.format_family,
    );
    export_bytes(roots, &bytes, extension)
}

fn export_bytes(roots: &AppRoots, bytes: &[u8], extension: &str) -> Result<PreparedShare> {
    let staging = roots.share_staging();
    fs::create_dir_all(&staging)?;
    let path = staging.join(format!("clip-{}.{}", Uuid::now_v7(), extension));
    fs::write(&path, bytes)?;
    Ok(PreparedShare::Files(vec![path]))
}

pub fn cleanup_stale(roots: &AppRoots) -> Result<()> {
    let directory = roots.share_staging();
    let Ok(entries) = fs::read_dir(&directory) else {
        return Ok(());
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_SHARE_AGE);
        if stale && path.parent() == Some(directory.as_path()) && path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn is_exportable(mime: Option<&str>, family: &str, storage_kind: &str) -> bool {
    storage_kind == "text"
        || family == "office"
        || mime.is_some_and(|mime| {
            mime.starts_with("image/")
                || matches!(
                    mime,
                    "application/pdf" | "text/html" | "text/rtf" | "application/rtf"
                )
        })
}

fn extension_for(mime: Option<&str>, family: &str) -> &'static str {
    match mime {
        Some("image/png") => "png",
        Some("image/jpeg") => "jpg",
        Some("image/gif") => "gif",
        Some("image/webp") => "webp",
        Some("image/svg+xml") => "svg",
        Some("application/pdf") => "pdf",
        Some("text/html") => "html",
        Some("text/rtf") | Some("application/rtf") => "rtf",
        Some("application/json") => "json",
        Some("application/xml") | Some("text/xml") => "xml",
        Some("text/markdown") => "md",
        Some("text/csv") => "csv",
        _ if family == "office" => "bin",
        _ => "txt",
    }
}

pub async fn show(window: &WebviewWindow, payload: PreparedShare) -> Result<()> {
    platform::show(window, payload).await
}

#[cfg(target_os = "windows")]
mod platform;
#[cfg(target_os = "macos")]
#[path = "platform_macos.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "platform_linux.rs"]
mod platform;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        foundation,
        history::{CaptureSettings, CapturedRepresentation, CapturedSnapshot},
    };

    async fn repository() -> (tempfile::TempDir, AppRoots, HistoryRepository) {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        foundation::prepare(&roots).await.unwrap();
        let repository = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        (temp, roots, repository)
    }

    async fn capture(
        repository: &HistoryRepository,
        representation: CapturedRepresentation,
    ) -> String {
        repository
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![representation],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap()
            .0
    }

    #[tokio::test]
    async fn exact_plain_text_and_url_are_shared_without_exporting_files() {
        let (_temp, roots, repository) = repository().await;
        let text_id = capture(
            &repository,
            CapturedRepresentation {
                format_key: "mime:text/plain".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: None,
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Text("  雪\n".into()),
            },
        )
        .await;
        assert_eq!(
            prepare(&repository, &roots, &text_id).await.unwrap(),
            PreparedShare::Text("  雪\n".into())
        );
        let summary = repository.summary(&text_id).await.unwrap();
        assert!(summary.has_plain_text);
        assert!(summary.shareable);

        let url_id = capture(
            &repository,
            CapturedRepresentation {
                format_key: "mime:text/plain".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: None,
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Text("https://example.com/path".into()),
            },
        )
        .await;
        assert_eq!(
            prepare(&repository, &roots, &url_id).await.unwrap(),
            PreparedShare::Url("https://example.com/path".into())
        );
        assert!(!roots.share_staging().exists());
    }

    #[tokio::test]
    async fn managed_assets_are_verified_and_exported_to_private_staging() {
        let (_temp, roots, repository) = repository().await;
        let clip_id = capture(
            &repository,
            CapturedRepresentation {
                format_key: "mime:image/png".into(),
                canonical_mime_type: Some("image/png".into()),
                native_type: None,
                platform: "windows".into(),
                capture_priority: 1,
                payload: CapturedPayload::Binary(vec![137, 80, 78, 71]),
            },
        )
        .await;
        let PreparedShare::Files(paths) = prepare(&repository, &roots, &clip_id).await.unwrap()
        else {
            panic!("image should be exported as a file")
        };
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].parent(), Some(roots.share_staging().as_path()));
        assert_eq!(
            paths[0].extension().and_then(|value| value.to_str()),
            Some("png")
        );
        assert_eq!(fs::read(&paths[0]).unwrap(), vec![137, 80, 78, 71]);
    }

    #[test]
    fn export_extensions_are_conservative() {
        assert_eq!(extension_for(Some("image/png"), "image"), "png");
        assert_eq!(extension_for(Some("application/pdf"), "document"), "pdf");
        assert_eq!(extension_for(None, "office"), "bin");
        assert_eq!(
            extension_for(Some("application/octet-stream"), "other"),
            "txt"
        );
    }

    #[test]
    fn unsupported_binary_is_not_exportable() {
        assert!(!is_exportable(
            Some("application/octet-stream"),
            "other",
            "binary_asset"
        ));
        assert!(is_exportable(Some("image/png"), "image", "binary_asset"));
        assert!(is_exportable(Some("application/json"), "text", "text"));
    }

    #[test]
    fn stale_cleanup_never_descends_into_directories() {
        let root = std::env::temp_dir().join(format!("clipsx-share-test-{}", Uuid::now_v7()));
        let roots = AppRoots {
            data: root.clone(),
            config: root.join("config"),
        };
        let nested = roots.share_staging().join("nested");
        fs::create_dir_all(&nested).unwrap();
        cleanup_stale(&roots).unwrap();
        assert!(nested.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
