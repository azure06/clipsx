use crate::models::ClipItem;
use crate::repositories::{ClipRepository, SettingsRepository};
use crate::services::clipboard_monitor::{self, ClipboardCheckResult, ClipboardMonitor};
use crate::services::clipboard_platform::{self, ClipboardContent};
use crate::services::semantic::SemanticService;
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
    _settings_repository: Arc<SettingsRepository>,
    semantic_service: Arc<SemanticService>,
    // NOTE: `Arc<Mutex<T>>` is like a thread-safe shared reference
    // Arc = Atomic Reference Counted (like shared_ptr in C++)
    // Mutex = Mutual exclusion lock (prevents concurrent access)
    // JS equivalent: just `monitor` (JS is single-threaded, no locks needed)
    monitor: Arc<Mutex<Box<dyn ClipboardMonitor>>>,
    app_handle: AppHandle,
    storage_dir: PathBuf,
}

impl ClipboardService {
    pub fn new(
        repository: Arc<ClipRepository>,
        settings_repository: Arc<SettingsRepository>,
        semantic_service: Arc<SemanticService>,
        app_handle: AppHandle,
    ) -> Self {
        // Base directory for all clipboard data
        let storage_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("clipboard_data");

        // Create per-type subdirectories (professional organization)
        std::fs::create_dir_all(&storage_dir.join("images")).ok();
        std::fs::create_dir_all(&storage_dir.join("svg")).ok();
        std::fs::create_dir_all(&storage_dir.join("pdf")).ok();
        std::fs::create_dir_all(&storage_dir.join("office")).ok();

        Self {
            repository,
            _settings_repository: settings_repository,
            semantic_service,
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
            ClipboardContent::Office {
                ole_data,
                ole_type,
                svg_data,
                pdf_data,
                png_data,
                extracted_text,
                source_app: office_app,
            } => {
                self.create_office_clip(
                    ole_data,
                    ole_type,
                    svg_data,
                    pdf_data,
                    png_data,
                    extracted_text,
                    office_app,
                    &content_hash,
                    source_app.clone(),
                )
                .await?
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

                // Trigger background embedding generation if a model is loaded
                if let Some(text) = &clip.content_text {
                    if let Some((model_name, dimensions)) = self.semantic_service.get_model_info() {
                        let text_clone = text.clone();
                        let clip_id = clip.id.clone();
                        let repo = self.repository.clone();
                        let semantic = self.semantic_service.clone();

                        tokio::spawn(async move {
                            match semantic.embed(text_clone).await {
                                Ok(vector) => {
                                    if let Err(e) = repo
                                        .create_embedding(
                                            &clip_id,
                                            SemanticService::vector_to_bytes(&vector),
                                            &model_name,
                                            dimensions,
                                        )
                                        .await
                                    {
                                        eprintln!("[ERROR] Failed to save embedding: {}", e);
                                    }
                                }
                                Err(e) => eprintln!("[ERROR] Failed to generate embedding: {}", e),
                            }
                        });
                    }
                }
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
            svg_path: None,
            pdf_path: None,
            image_path: None,
            attachment_path: None,
            attachment_type: None,
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
            has_embedding: Some(false),
            similarity_score: None,
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
            svg_path: None,
            pdf_path: None,
            image_path: None,
            attachment_path: None,
            attachment_type: None,
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
            has_embedding: Some(false),
            similarity_score: None,
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
        let image_path = self.storage_dir.join("images").join(&filename);

        tokio::fs::write(&image_path, data).await?;

        Ok(ClipItem {
            id,
            content_type: "image".to_string(),
            content_text: Some(format!("[Image: {}]", filename)),
            content_html: None,
            content_rtf: None,
            svg_path: None,
            pdf_path: None,
            image_path: Some(image_path.to_string_lossy().to_string()),
            attachment_path: None,
            attachment_type: None,
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
            has_embedding: Some(false),
            similarity_score: None,
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
            svg_path: None,
            pdf_path: None,
            image_path: None,
            attachment_path: None,
            attachment_type: None,
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
            has_embedding: Some(false),
            similarity_score: None,
        }
    }

    async fn create_office_clip(
        &self,
        ole_data: Option<Vec<u8>>,
        ole_type: Option<String>,
        svg_data: Option<Vec<u8>>,
        pdf_data: Option<Vec<u8>>,
        png_data: Option<Vec<u8>>,
        extracted_text: String,
        source_app: String,
        hash: &str,
        app_name: Option<String>,
    ) -> Result<ClipItem> {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        // Directories are already created in new() with per-type structure
        // storage_dir = clipboard_data/ with subdirs: images/, svg/, pdf/, office/

        // Save OLE/Office package file → clipboard_data/office/{id}.bin
        let attachment_path = if let Some(ole) = ole_data {
            let path = self.storage_dir.join("office").join(format!("{}.bin", id));
            tokio::fs::write(&path, ole).await?;
            Some(path.to_string_lossy().to_string())
        } else {
            None
        };

        // Save SVG file → clipboard_data/svg/{id}.svg
        let svg_path = if let Some(svg) = svg_data {
            let path = self.storage_dir.join("svg").join(format!("{}.svg", id));
            tokio::fs::write(&path, svg).await?;
            Some(path.to_string_lossy().to_string())
        } else {
            None
        };

        // Save PDF file → clipboard_data/pdf/{id}.pdf
        let pdf_path = if let Some(pdf) = pdf_data {
            let path = self.storage_dir.join("pdf").join(format!("{}.pdf", id));
            tokio::fs::write(&path, pdf).await?;
            Some(path.to_string_lossy().to_string())
        } else {
            None
        };

        // Save PNG file → clipboard_data/images/{id}.png
        let image_path = if let Some(png) = png_data {
            let path = self.storage_dir.join("images").join(format!("{}.png", id));
            tokio::fs::write(&path, png).await?;
            Some(path.to_string_lossy().to_string())
        } else {
            None
        };

        Ok(ClipItem {
            id,
            content_type: "office".to_string(),
            content_text: Some(extracted_text), // Text from pasteboard/SVG/PDF → searchable via FTS5
            content_html: None,
            content_rtf: None,
            svg_path,                  // SVG file: clipboard_data/svg/{id}.svg
            pdf_path,                  // PDF file: clipboard_data/pdf/{id}.pdf
            image_path,                // PNG file: clipboard_data/images/{id}.png
            attachment_path,           // Office native format: clipboard_data/office/{id}.bin
            attachment_type: ole_type, // UTI type for restoring OLE to pasteboard
            file_paths: None,
            detected_type: "office".to_string(),
            metadata: Some(format!(r#"{{"source_app":"{}"}}"#, source_app)),
            created_at: now,
            updated_at: now,
            app_name,
            is_pinned: 0,
            is_favorite: 0,
            access_count: 0,
            content_hash: Some(hash.to_string()),
            has_embedding: Some(false),
            similarity_score: None,
        })
    }

    /// Manually copy text to clipboard
    pub async fn set_text(&self, text: &str) -> Result<()> {
        let mut clipboard = Clipboard::new()?;
        clipboard.set_text(text)?;
        // Pre-seed the monitor's last-known hash so the next poll tick
        // sees this content as "already known" and won't create a duplicate entry.
        let mut monitor = self.monitor.lock().await;
        let content = crate::services::clipboard_platform::ClipboardContent::Text {
            content: text.to_string(),
        };
        monitor.notify_wrote(&content);
        Ok(())
    }

    /// Get current clipboard text
    pub fn get_text(&self) -> Result<String> {
        let mut clipboard = Clipboard::new()?;
        Ok(clipboard.get_text()?)
    }

    /// Get access to the monitor (for notify_wrote)
    pub fn get_monitor(&self) -> Arc<Mutex<Box<dyn clipboard_monitor::ClipboardMonitor>>> {
        Arc::clone(&self.monitor)
    }

    /// Delete all files associated with a clip (images, attachments)
    /// Returns Ok even if some files are missing (idempotent cleanup)
    pub async fn cleanup_clip_files(&self, clip: &ClipItem) -> Result<()> {
        // Helper: delete file and log warnings instead of failing
        async fn delete_file(path: &str) {
            if let Err(e) = tokio::fs::remove_file(path).await {
                // Only log if file exists but can't be deleted (not if already missing)
                if e.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("[WARN] Failed to delete {}: {}", path, e);
                }
            }
        }

        // Clean up image file
        if let Some(path) = &clip.image_path {
            delete_file(path).await;
        }

        // Clean up attachment file (Office OLE, PDF, etc.)
        if let Some(path) = &clip.attachment_path {
            delete_file(path).await;
        }

        // Clean up SVG file
        if let Some(path) = &clip.svg_path {
            delete_file(path).await;
        }

        // Clean up PDF file
        if let Some(path) = &clip.pdf_path {
            delete_file(path).await;
        }

        Ok(())
    }
}
