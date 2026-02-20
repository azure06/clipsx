use crate::models::ClipItem;
use crate::repositories::ClipRepository;
use crate::services::clipboard_monitor::{self, ClipboardCheckResult, ClipboardMonitor};
use crate::services::clipboard_platform::{self, ClipboardContent};
use anyhow::Result;
use arboard::Clipboard;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

/// Main clipboard service - coordinates monitoring, storage, and notifications
///
/// JS/TS equivalent: class ClipboardService {
///   private repository: ClipRepository
///   private monitor: ClipboardMonitor
///   private appHandle: AppHandle
///   private storageDir: string
/// }
pub struct ClipboardService {
    repository: Arc<ClipRepository>,
    // NOTE: `Arc<Mutex<T>>` is like a thread-safe shared reference
    // Arc = Atomic Reference Counted (like shared_ptr in C++)
    // Mutex = Mutual exclusion lock (prevents concurrent access)
    // JS equivalent: just `monitor` (JS is single-threaded, no locks needed)
    monitor: Arc<Mutex<Box<dyn ClipboardMonitor>>>,
    app_handle: AppHandle,
    storage_dir: PathBuf,
}

impl ClipboardService {
    pub fn new(repository: Arc<ClipRepository>, app_handle: AppHandle) -> Self {
        let storage_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("clipboard_images");

        std::fs::create_dir_all(&storage_dir).ok();

        Self {
            repository,
            // NOTE: Create platform-specific monitor (macOS vs Windows/Linux)
            monitor: Arc::new(Mutex::new(clipboard_monitor::create_monitor(
                app_handle.clone(),
            ))),
            app_handle,
            storage_dir,
        }
    }

    /// Start monitoring clipboard in background
    ///
    /// NOTE: `self: Arc<Self>` means we take ownership of the Arc
    /// This allows us to move it into the spawned task
    /// JS equivalent: async startMonitoring() { ... }
    pub async fn start_monitoring(self: Arc<Self>) {
        // NOTE: `tokio::spawn` is like creating a new async task
        // JS equivalent: (async () => { while(true) { ... } })()
        tokio::spawn(async move {
            loop {
                if let Err(e) = self.check_clipboard().await {
                    eprintln!("[ERROR] Clipboard check error: {}", e);
                }
                // NOTE: Poll every 500ms
                // macOS: Fast path skips read if unchanged (~1μs)
                // Windows/Linux: Reads clipboard, compares hash in memory
                sleep(Duration::from_millis(500)).await;
            }
        });
    }

    /// Check clipboard for changes and process new content
    ///
    /// Flow:
    /// 1. Call monitor.check() - platform-specific change detection
    /// 2. If unchanged → return early (no DB query)
    /// 3. If changed → create ClipItem, check DB for duplicates
    /// 4. Insert or update timestamp, notify frontend
    // Check clipboard for changes and process new content
    async fn check_clipboard(&self) -> Result<()> {
        let mut monitor = self.monitor.lock().await;
        let result = monitor.check()?;
        let platform = monitor.platform_name();
        drop(monitor);

        let (content, content_hash, source_app) = match result {
            ClipboardCheckResult::Unchanged => return Ok(()),
            ClipboardCheckResult::Changed {
                content,
                hash,
                source_app,
            } => (content, hash, source_app),
        };

        eprintln!(
            "[{}] Clipboard changed, hash: {}",
            platform,
            &content_hash[..8]
        );

        let clip = match content {
            ClipboardContent::Text { content } => {
                // Intelligence: detect semantic type from text content
                let detection =
                    crate::services::intelligence::IntelligenceService::detect(&content);

                let mut clip = ClipItem::from_text(
                    content,
                    detection.detected_type_str().to_string(),
                    detection.metadata_json(),
                );
                clip.content_hash = Some(content_hash.clone());
                clip.app_name = source_app.clone();
                clip
            }
            ClipboardContent::Html { html, plain } => {
                // Intelligence: analyze the plain text extracted from HTML
                let detection = crate::services::intelligence::IntelligenceService::detect(&plain);
                Self::create_html_clip(html, plain, &content_hash, &detection, source_app.clone())
            }
            ClipboardContent::Rtf { rtf, plain } => {
                // Intelligence: analyze the plain text extracted from RTF
                let detection = crate::services::intelligence::IntelligenceService::detect(&plain);
                Self::create_rtf_clip(rtf, plain, &content_hash, &detection, source_app.clone())
            }
            ClipboardContent::Image { data, format } => {
                self.create_image_clip(data, format, &content_hash, source_app.clone())
                    .await?
            }
            ClipboardContent::Files { paths } => {
                Self::create_files_clip(paths, &content_hash, source_app.clone())
            }
        };

        match self.repository.find_by_hash(&content_hash).await? {
            Some(existing) => {
                eprintln!("[{}] Duplicate in DB - updating timestamp", platform);
                self.repository.touch(&existing.id).await?;
            }
            None => {
                eprintln!(
                    "[{}] New {:?} content - inserting",
                    platform, clip.content_type
                );
                self.repository.insert(&clip).await?;
            }
        }

        let saved_clip = self
            .repository
            .find_by_hash(&content_hash)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve saved clip"))?;

        if let Err(e) = self.app_handle.emit("clipboard_changed", &saved_clip) {
            eprintln!("[ERROR] Failed to emit event: {}", e);
        }

        Ok(())
    }

    fn create_html_clip(
        html: String,
        plain: String,
        hash: &str,
        detection: &crate::services::intelligence::DetectionResult,
        app_name: Option<String>,
    ) -> ClipItem {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        ClipItem {
            id,
            content_type: "html".to_string(),
            content_text: Some(plain),
            content_html: Some(html),
            content_rtf: None,
            image_path: None,
            file_paths: None,
            detected_type: detection.detected_type_str().to_string(),
            metadata: detection.metadata_json(),
            created_at: now,
            updated_at: now,
            app_name,
            is_pinned: 0,
            is_favorite: 0,
            access_count: 0,
            content_hash: Some(hash.to_string()),
        }
    }

    fn create_rtf_clip(
        rtf: String,
        plain: String,
        hash: &str,
        detection: &crate::services::intelligence::DetectionResult,
        app_name: Option<String>,
    ) -> ClipItem {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        ClipItem {
            id,
            content_type: "rtf".to_string(),
            content_text: Some(plain),
            content_html: None,
            content_rtf: Some(rtf),
            image_path: None,
            file_paths: None,
            detected_type: detection.detected_type_str().to_string(),
            metadata: detection.metadata_json(),
            created_at: now,
            updated_at: now,
            app_name,
            is_pinned: 0,
            is_favorite: 0,
            access_count: 0,
            content_hash: Some(hash.to_string()),
        }
    }

    async fn create_image_clip(
        &self,
        data: Vec<u8>,
        format: clipboard_platform::ImageFormat,
        hash: &str,
        app_name: Option<String>,
    ) -> Result<ClipItem> {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        let filename = format!("{}.{}", id, format.extension());
        let image_path = self.storage_dir.join(&filename);

        tokio::fs::write(&image_path, data).await?;

        Ok(ClipItem {
            id,
            content_type: "image".to_string(),
            content_text: Some(format!("[Image: {}]", filename)),
            content_html: None,
            content_rtf: None,
            image_path: Some(image_path.to_string_lossy().to_string()),
            file_paths: None,
            detected_type: "image".to_string(),
            metadata: Some(format!(r#"{{"format":"{}"}}"#, format.mime_type())),
            created_at: now,
            updated_at: now,
            app_name,
            is_pinned: 0,
            is_favorite: 0,
            access_count: 0,
            content_hash: Some(hash.to_string()),
        })
    }

    fn create_files_clip(paths: Vec<String>, hash: &str, app_name: Option<String>) -> ClipItem {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        let file_count = paths.len();
        let preview = if file_count == 1 {
            std::path::Path::new(&paths[0])
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&paths[0])
                .to_string()
        } else {
            format!("{} files", file_count)
        };

        // Collect metadata
        let mut files_meta = Vec::new();
        for path in &paths {
            let meta_map = if let Ok(meta) = std::fs::metadata(path) {
                let size = meta.len();
                let created = meta
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                serde_json::json!({
                    "path": path,
                    "name": std::path::Path::new(path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    "size": size,
                    "created": created,
                    "modified": modified
                })
            } else {
                serde_json::json!({
                    "path": path,
                    "error": "Failed to read metadata"
                })
            };
            files_meta.push(meta_map);
        }

        let metadata_json = serde_json::json!({
            "count": file_count,
            "files": files_meta
        });

        ClipItem {
            id,
            content_type: "files".to_string(),
            content_text: Some(preview),
            content_html: None,
            content_rtf: None,
            image_path: None,
            file_paths: Some(serde_json::to_string(&paths).unwrap_or_default()),
            detected_type: "files".to_string(),
            metadata: Some(metadata_json.to_string()),
            created_at: now,
            updated_at: now,
            app_name,
            is_pinned: 0,
            is_favorite: 0,
            access_count: 0,
            content_hash: Some(hash.to_string()),
        }
    }

    /// Manually copy text to clipboard
    pub fn set_text(&self, text: &str) -> Result<()> {
        let mut clipboard = Clipboard::new()?;
        clipboard.set_text(text)?;
        Ok(())
    }

    /// Get current clipboard text
    pub fn get_text(&self) -> Result<String> {
        let mut clipboard = Clipboard::new()?;
        Ok(clipboard.get_text()?)
    }
}
