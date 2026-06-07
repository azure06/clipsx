use crate::events::emit_clip_updated;
use crate::models::{compute_index_text, ClipItem};
use crate::repositories::{ClipRepository, SettingsRepository};
use crate::services::clipboard_monitor::{self, ClipboardCheckResult, ClipboardMonitor};
use crate::services::clipboard_platform::{self, ClipboardContent};
use crate::services::ocr::OcrService;
use crate::services::office::classify_office_payload;
use crate::services::semantic::SemanticService;
use anyhow::Result;
use arboard::Clipboard;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration, Instant};

struct CreateOfficeClipParams {
    ole_data: Option<Vec<u8>>,
    ole_type: Option<String>,
    extra_types: Vec<(String, Vec<u8>)>,
    svg_data: Option<Vec<u8>>,
    pdf_data: Option<Vec<u8>>,
    png_data: Option<Vec<u8>>,
    html_data: Option<String>,
    rtf_data: Option<String>,
    extracted_text: String,
    source_app: String,
}

fn determine_office_text_state(extracted_text: &str, has_ocr_candidate: bool) -> (String, String) {
    if extracted_text.is_empty() {
        if has_ocr_candidate {
            ("none".to_string(), "pending".to_string())
        } else {
            ("none".to_string(), "not_needed".to_string())
        }
    } else {
        ("office".to_string(), "not_needed".to_string())
    }
}

/// Main clipboard service - coordinates monitoring, storage, and notifications
///
/// Think of this as the "hub" of the application. It:
///   1. Watches the OS clipboard for changes (via a background polling loop)
///   2. Saves new clips to the SQLite database
///   3. Tells the frontend that a new clip arrived (via a Tauri event)
///   4. Runs two additional background tasks: storage cleanup and OS clipboard auto-clear
///
/// JS/TS mental model:
/// class ClipboardService {
///   private repository: ClipRepository        // database
///   private settingsRepository: SettingsRepository
///   private monitor: ClipboardMonitor         // OS clipboard watcher
///   private appHandle: AppHandle              // Tauri bridge (emit events to frontend)
///   private storageDir: string               // folder where images/files are saved
///   private lastCopyAt: Date | null          // for auto-clear timer
/// }
pub struct ClipboardService {
    repository: Arc<ClipRepository>,
    settings_repository: Arc<SettingsRepository>,
    semantic_service: Arc<SemanticService>,
    ocr_service: Arc<OcrService>,
    // NOTE: Arc<Mutex<T>> is like a thread-safe shared wrapper.
    // Arc  = Atomic Reference Counter. Like a shared pointer that keeps a count of how
    //        many places are using the value. When count reaches 0, the value is dropped.
    //        JS equivalent: all objects are reference-counted by the garbage collector.
    // Mutex = Mutual Exclusion lock. Only one "thread" (async task) can use the value
    //         at a time. Think of it as a door with one key — you grab the key (.lock()),
    //         do your work, then put the key back (key is dropped automatically).
    //         JS is single-threaded so it never needs explicit locks.
    monitor: Arc<Mutex<Box<dyn ClipboardMonitor>>>,
    app_handle: AppHandle,
    storage_dir: PathBuf,
    /// Tracks when something was last copied, so the auto-clear timer knows when to fire.
    /// It's wrapped in Arc<Mutex<>> so both the clipboard loop and the auto-clear task
    /// can safely read and write it without conflicting.
    /// JS equivalent: this.lastCopyAt: Date | null (no lock needed in JS)
    last_copy_at: Arc<Mutex<Option<Instant>>>,
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
        std::fs::create_dir_all(storage_dir.join("images")).ok();
        std::fs::create_dir_all(storage_dir.join("svg")).ok();
        std::fs::create_dir_all(storage_dir.join("pdf")).ok();
        std::fs::create_dir_all(storage_dir.join("office")).ok();

        Self {
            repository,
            settings_repository,
            semantic_service,
            ocr_service: Arc::new(OcrService::new()),
            monitor: Arc::new(Mutex::new(clipboard_monitor::create_monitor(
                app_handle.clone(),
            ))),
            app_handle,
            storage_dir,
            last_copy_at: Arc::new(Mutex::new(None)),
        }
    }

    /// Start monitoring the clipboard and all ancillary background tasks.
    ///
    /// This spawns THREE separate async background tasks that run forever
    /// (until the app closes). Think of `tokio::spawn` like `setTimeout`/`setInterval`
    /// in JS — it starts a task in the background without blocking the current flow.
    ///
    /// NOTE: `self: Arc<Self>` instead of `&self` because we need to move a clone of
    /// the service reference into each background task. Arc makes cloning cheap —
    /// it just bumps a counter, it does NOT copy the actual data.
    pub async fn start_monitoring(self: Arc<Self>) {
        // ═══════════════════════════════════════════════════════════════════════
        // TASK 1: Clipboard polling loop
        // ═══════════════════════════════════════════════════════════════════════
        // This is the heart of the app. Every 500ms (twice per second) it asks
        // the OS: "Did anything new land on the clipboard?"
        //
        // Why 500ms? Fast enough to feel instant, slow enough to not hammer the CPU.
        // On macOS this is nearly free (just reads a change counter — 1 syscall).
        // On Windows/Linux it reads the actual clipboard every tick and compares a
        // hash of the content in memory to detect changes.
        //
        // JS mental model:
        //   setInterval(() => checkClipboard(), 500)
        let svc = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = svc.check_clipboard().await {
                    eprintln!("[ERROR] Clipboard check error: {}", e);
                }
                // Wait 500ms before the next poll.
                // `await` here yields control back to Tokio's async runtime so other
                // tasks (Task 2, Task 3) can run during this wait.
                // JS equivalent: await new Promise(resolve => setTimeout(resolve, 500))
                sleep(Duration::from_millis(500)).await;
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // TASK 2: Periodic storage-limit enforcement
        // ═══════════════════════════════════════════════════════════════════════
        // Every 5 minutes, check if the database has grown too large and prune it.
        //
        // This is a safety net — the main pruning happens right after each insert
        // (in check_clipboard below). This periodic task catches edge cases like
        // the user lowering their limit setting after already having 2000 clips.
        //
        // Pinned and favorited clips are NEVER deleted by this task.
        //
        // JS mental model:
        //   setInterval(() => enforceStorageLimits(), 5 * 60 * 1000)
        let svc2 = self.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(300)).await;
                if let Ok(settings) = svc2.settings_repository.load() {
                    if let Err(e) = svc2
                        .repository
                        .enforce_storage_limits(settings.max_clips, settings.max_age_days)
                        .await
                    {
                        eprintln!("[ERROR] Storage limit enforcement failed: {}", e);
                    }
                }
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // TASK 3: Auto-clear the OS clipboard (Privacy feature)
        // ═══════════════════════════════════════════════════════════════════════
        // When this feature is enabled, the app will wipe the OPERATING SYSTEM's
        // active clipboard after X minutes of inactivity.
        //
        // WHY? When you copy a password or a credit card number, it sits on the
        // OS clipboard until something else replaces it. Any app on your computer
        // can read it silently. This feature limits that exposure window.
        //
        // HOW IT WORKS:
        // - Every time a new clip is saved (see check_clipboard below), we record
        //   the current timestamp in `last_copy_at`.
        // - This task wakes up every 30 seconds and checks: how long ago was the
        //   last copy? If it exceeds `auto_clear_minutes`, we tell arboard
        //   (the Rust clipboard library) to clear the OS clipboard.
        // - We clear `last_copy_at` afterwards so we don't clear repeatedly.
        //
        // NOTE: This clears the OS clipboard (what Ctrl+V pastes from), NOT the
        // Clipsx database history. Your history is still visible in the app.
        //
        // JS mental model:
        //   setInterval(() => {
        //     if (lastCopyAt && Date.now() - lastCopyAt > autoMinutes * 60000) {
        //       navigator.clipboard.writeText('') // clear OS clipboard
        //       lastCopyAt = null
        //     }
        //   }, 30000)
        let svc3 = self.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(30)).await;

                let settings = match svc3.settings_repository.load() {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                let minutes = settings.auto_clear_minutes;
                if minutes == 0 {
                    // Feature is disabled — nothing to do
                    continue;
                }

                // `*` dereferences the MutexGuard to get the inner Option<Instant>
                // This is a copy (Instant is Copy), so `last_copy` is its own value
                let last_copy = *svc3.last_copy_at.lock().await;
                if let Some(instant) = last_copy {
                    if instant.elapsed().as_secs() >= (minutes as u64 * 60) {
                        eprintln!("[PRIVACY] Auto-clearing OS clipboard after {} min", minutes);
                        // arboard is the cross-platform library that talks to the OS clipboard.
                        // On Windows this calls the Win32 OpenClipboard / EmptyClipboard API.
                        // On macOS it calls NSPasteboard.clearContents().
                        if let Ok(mut cb) = arboard::Clipboard::new() {
                            let _ = cb.clear();
                        }
                        // Reset — don't fire again until the next copy event
                        *svc3.last_copy_at.lock().await = None;
                    }
                }
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // TASK 4: Background OCR worker
        // ═══════════════════════════════════════════════════════════════════════
        // Polls for clips whose ocr_status='pending' and runs Vision OCR on
        // the saved image file.  Runs every 2 seconds; each poll processes all
        // pending clips one by one so that a burst of pasted images drains
        // quickly without spawning an unbounded number of concurrent jobs.
        //
        // After OCR succeeds:
        //   - update_after_ocr() promotes OCR text to content_text / index_text
        //     when no stronger source already owns them.
        //   - A fresh embedding is triggered if index_text changed.
        //   - A clip-updated event notifies the frontend.
        //
        // If OCR is not supported on this platform, the worker sets all pending
        // clips to 'failed' on first run so they are never retried.
        let svc4 = self.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(2)).await;

                let pending = match svc4.repository.get_pending_ocr_clips().await {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("[OCR] Failed to query pending clips: {}", e);
                        continue;
                    }
                };

                for clip in pending {
                    let image_path = match clip.image_path.as_deref() {
                        Some(p) => p.to_string(),
                        None => {
                            // No image file (e.g. office clip with only SVG/PDF): mark failed.
                            if let Err(e) =
                                svc4.repository.set_ocr_status(&clip.id, "failed").await
                            {
                                eprintln!("[OCR] set_ocr_status failed: {}", e);
                            }
                            continue;
                        }
                    };

                    if let Err(e) =
                        svc4.repository.set_ocr_status(&clip.id, "running").await
                    {
                        eprintln!("[OCR] set_ocr_status(running) failed: {}", e);
                        continue;
                    }

                    let ocr_result = match svc4.ocr_service.run_ocr(&image_path).await {
                        Ok(r) => r,
                        Err(e) => {
                            eprintln!("[OCR] Unexpected error for {}: {}", clip.id, e);
                            let _ =
                                svc4.repository.set_ocr_status(&clip.id, "failed").await;
                            continue;
                        }
                    };

                    if !ocr_result.supported {
                        // Platform has no OCR engine: mark all pending as failed once.
                        let _ =
                            svc4.repository.set_ocr_status(&clip.id, "failed").await;
                        continue;
                    }

                    // Decide whether OCR should own content_text.
                    // It should only promote when no real source already has text.
                    let real_sources =
                        ["clipboard", "office", "pdf_extract", "svg_extract", "ocr"];
                    let update_content =
                        !real_sources.contains(&clip.primary_text_source.as_str());

                    let updated_clip = match svc4
                        .repository
                        .update_after_ocr(&clip.id, &ocr_result.text, update_content)
                        .await
                    {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("[OCR] update_after_ocr failed for {}: {}", clip.id, e);
                            continue;
                        }
                    };

                    // Trigger embedding generation when index_text is now non-empty.
                    if !updated_clip.index_text.is_empty()
                        && updated_clip.primary_text_source != "none"
                    {
                        if let Some((model_name, dimensions)) =
                            svc4.semantic_service.get_model_info()
                        {
                            let clip_id = updated_clip.id.clone();
                            let index_text = updated_clip.index_text.clone();
                            let repo = svc4.repository.clone();
                            let semantic = svc4.semantic_service.clone();
                            let app_handle = svc4.app_handle.clone();

                            tokio::spawn(async move {
                                match semantic.embed(index_text).await {
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
                                            eprintln!("[OCR] Failed to save embedding: {}", e);
                                        }
                                        if let Err(e) = emit_clip_updated(
                                            &app_handle,
                                            repo.as_ref(),
                                            &clip_id,
                                        )
                                        .await
                                        {
                                            eprintln!(
                                                "[OCR] clip-updated emit failed: {}",
                                                e
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("[OCR] Embedding generation failed: {}", e);
                                        // Still notify frontend of OCR status change.
                                        if let Err(e) = emit_clip_updated(
                                            &app_handle,
                                            repo.as_ref(),
                                            &clip_id,
                                        )
                                        .await
                                        {
                                            eprintln!(
                                                "[OCR] clip-updated emit failed: {}",
                                                e
                                            );
                                        }
                                    }
                                }
                            });
                        } else {
                            // No semantic model loaded; just notify the frontend.
                            if let Err(e) = emit_clip_updated(
                                &svc4.app_handle,
                                svc4.repository.as_ref(),
                                &updated_clip.id,
                            )
                            .await
                            {
                                eprintln!("[OCR] clip-updated emit failed: {}", e);
                            }
                        }
                    } else {
                        // No text (or source unchanged): still update the frontend.
                        if let Err(e) = emit_clip_updated(
                            &svc4.app_handle,
                            svc4.repository.as_ref(),
                            &updated_clip.id,
                        )
                        .await
                        {
                            eprintln!("[OCR] clip-updated emit failed: {}", e);
                        }
                    }
                }
            }
        });
    }

    /// Check clipboard for changes and process new content.
    ///
    /// This is called by Task 1 (the polling loop) every 500ms.
    ///
    /// Full flow:
    ///   1. Ask the platform monitor: "Did clipboard change?"
    ///      - macOS: compare NSPasteboard changeCount (basically a version number)
    ///      - Windows/Linux: read clipboard, compute hash, compare with last known hash
    ///   2. Unchanged → return immediately (no DB query, very cheap)
    ///   3. Changed  → build a ClipItem struct from the raw clipboard data
    ///   4. Check if this content already exists in DB (deduplication by hash)
    ///      - Duplicate → just bump its `updated_at` timestamp (moves it to top)
    ///      - New       → insert into DB, enforce storage limits, emit event to frontend
    async fn check_clipboard(&self) -> Result<()> {
        // Lock the monitor for the duration of the check.
        // `lock().await` waits until no other task is using the monitor.
        // `drop(monitor)` releases the lock early so other tasks can use it
        // before we do the (potentially slow) DB operations below.
        let mut monitor = self.monitor.lock().await;
        let result = monitor.check()?;
        let platform = monitor.platform_name();
        drop(monitor); // Release the lock now — we don't need it anymore

        let (content, content_hash, source_app) = match result {
            // Clipboard hasn't changed — exit immediately without touching the DB
            ClipboardCheckResult::Unchanged => return Ok(()),
            ClipboardCheckResult::Changed {
                content,
                hash,
                source_app,
            } => (*content, hash, source_app),
        };

        // Load current settings on every check so changes take effect immediately
        // without needing to restart the app. The settings file is tiny so this is
        // fast (just a JSON file read from disk).
        let settings = self.settings_repository.load().unwrap_or_default();

        // ── App exclusion check ─────────────────────────────────────────────
        // The user may have listed apps whose clipboard we should ignore
        // (e.g. a password manager). If the source app matches any excluded app,
        // we silently drop this clipboard event without saving anything.
        // We use a substring, case-insensitive match so e.g. "1password" will
        // match "1Password 7" (the full macOS/Windows bundle name).
        if let Some(app) = &source_app {
            let app_lower = app.to_lowercase();
            let excluded = settings
                .excluded_apps
                .iter()
                .any(|ex| app_lower.contains(&ex.to_lowercase()));
            if excluded {
                eprintln!("[{}] Skipping clip from excluded app: {}", platform, app);
                return Ok(());
            }
        }

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
            ClipboardContent::Image {
                data,
                format,
                pdf_data,
            } => {
                self.create_image_clip(data, format, &pdf_data, &content_hash, source_app.clone())
                    .await?
            }
            ClipboardContent::Files { paths } => {
                Self::create_files_clip(paths, &content_hash, source_app.clone())
            }
            ClipboardContent::Office {
                ole_data,
                ole_type,
                extra_types,
                svg_data,
                pdf_data,
                png_data,
                html_data,
                rtf_data,
                extracted_text,
                source_app: office_app,
            } => {
                self.create_office_clip(
                    CreateOfficeClipParams {
                        ole_data,
                        ole_type,
                        extra_types,
                        svg_data,
                        pdf_data,
                        png_data,
                        html_data,
                        rtf_data,
                        extracted_text,
                        source_app: office_app,
                    },
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
                // ── Max item size check ───────────────────────────────────────
                // Binary content (images, Office files) is stored to disk.
                // For text/html/rtf we check their in-memory size against the
                // user's limit and silently drop oversized clips.
                // NOTE: Image size is checked differently (by the file write size)
                // so we only measure text-based payloads here.
                let max_bytes = (settings.max_item_size_mb as usize) * 1024 * 1024;
                let payload_size = clip.content_text.as_ref().map(|t| t.len()).unwrap_or(0)
                    + clip.content_html.as_ref().map(|h| h.len()).unwrap_or(0)
                    + clip.content_rtf.as_ref().map(|r| r.len()).unwrap_or(0);

                if max_bytes > 0 && payload_size > max_bytes {
                    eprintln!(
                        "[{}] Clip too large ({} bytes > {} MB limit) - skipping",
                        platform, payload_size, settings.max_item_size_mb
                    );
                    return Ok(());
                }

                eprintln!(
                    "[{}] New {:?} content - inserting",
                    platform, clip.content_type
                );
                self.repository.insert(&clip).await?;

                // ── Storage limit enforcement ─────────────────────────────────
                // After every insert we immediately check if we've exceeded the
                // user's configured limits and prune if needed. This prevents the
                // database from ever growing beyond the cap by more than 1 entry.
                // (A periodic task in Task 2 also handles this as a safety net.)
                if let Err(e) = self
                    .repository
                    .enforce_storage_limits(settings.max_clips, settings.max_age_days)
                    .await
                {
                    eprintln!("[ERROR] Storage limit enforcement failed: {}", e);
                }

                // ── Update auto-clear timer ───────────────────────────────────
                // Record "right now" as the moment something was copied. Task 3
                // reads this value to decide when to clear the OS clipboard.
                *self.last_copy_at.lock().await = Some(Instant::now());

                // Trigger background embedding generation using index_text.
                // Clips with primary_text_source='none' have no real text yet and are skipped.
                let index_text = clip.index_text.clone();
                if !index_text.is_empty() && clip.primary_text_source != "none" {
                    if let Some((model_name, dimensions)) = self.semantic_service.get_model_info() {
                        let clip_id = clip.id.clone();
                        let repo = self.repository.clone();
                        let semantic = self.semantic_service.clone();
                        let app_handle = self.app_handle.clone();

                        tokio::spawn(async move {
                            match semantic.embed(index_text).await {
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
                                    } else if let Err(e) =
                                        emit_clip_updated(&app_handle, repo.as_ref(), &clip_id)
                                            .await
                                    {
                                        eprintln!(
                                            "[ERROR] Failed to emit clip-updated after embedding save: {}",
                                            e
                                        );
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
        let index_text = compute_index_text(Some(&plain), None);

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
            ocr_text: None,
            index_text,
            primary_text_source: "clipboard".to_string(),
            ocr_status: "not_needed".to_string(),
            detected_type: detection.detected_type_str().to_string(),
            metadata: detection.metadata_json(),
            note: None,
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
        let index_text = compute_index_text(Some(&plain), None);

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
            ocr_text: None,
            index_text,
            primary_text_source: "clipboard".to_string(),
            ocr_status: "not_needed".to_string(),
            detected_type: detection.detected_type_str().to_string(),
            metadata: detection.metadata_json(),
            note: None,
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
        pdf_data: &Option<Vec<u8>>,
        hash: &str,
        app_name: Option<String>,
    ) -> Result<ClipItem> {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        let filename = format!("{}.{}", id, format.extension());
        let image_path = self.storage_dir.join("images").join(&filename);

        tokio::fs::write(&image_path, data).await?;

        // Save PDF alongside the raster image if present (e.g. PowerPoint slideshow)
        let saved_pdf_path = if let Some(pdf) = pdf_data {
            let pdf_filename = format!("{}.pdf", id);
            let pdf_path = self.storage_dir.join("pdf").join(&pdf_filename);
            tokio::fs::write(&pdf_path, pdf).await?;
            Some(pdf_path.to_string_lossy().to_string())
        } else {
            None
        };

        // Images start with no text source; OCR may later promote primary_text_source to 'ocr'.
        // The placeholder is stored in content_text for UI display but is NOT in index_text
        // so it cannot be embedded or matched by FTS.
        // TODO: Wire a background OCR worker that consumes clips with ocr_status='pending'
        // and calls set_ocr_status/update_after_ocr after processing the saved image.
        let placeholder = format!("[Image: {}]", filename);

        Ok(ClipItem {
            id,
            content_type: "image".to_string(),
            content_text: Some(placeholder),
            content_html: None,
            content_rtf: None,
            svg_path: None,
            pdf_path: saved_pdf_path,
            image_path: Some(image_path.to_string_lossy().to_string()),
            attachment_path: None,
            attachment_type: None,
            file_paths: None,
            ocr_text: None,
            index_text: String::new(), // populated by OCR when available
            primary_text_source: "none".to_string(),
            ocr_status: "pending".to_string(), // queue OCR
            detected_type: "image".to_string(),
            metadata: Some(format!(r#"{{"format":"{}"}}"#, format.mime_type())),
            note: None,
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

        let index_text = compute_index_text(Some(&preview), None);

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
            ocr_text: None,
            index_text,
            primary_text_source: "clipboard".to_string(),
            ocr_status: "not_needed".to_string(),
            detected_type: "files".to_string(),
            metadata: Some(metadata_json.to_string()),
            note: None,
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
        params: CreateOfficeClipParams,
        hash: &str,
        app_name: Option<String>,
    ) -> Result<ClipItem> {
        let CreateOfficeClipParams {
            ole_data,
            ole_type,
            extra_types,
            svg_data,
            pdf_data,
            png_data,
            html_data,
            rtf_data,
            extracted_text,
            source_app,
        } = params;
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();
        let office_classification = classify_office_payload(
            &source_app,
            app_name.as_deref(),
            ole_type.as_deref(),
            html_data.as_deref(),
            &extracted_text,
        );

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

        let extra_json: Vec<Value> = extra_types
            .iter()
            .map(|(t, d)| {
                serde_json::json!({
                    "type": t,
                    "hex": d.iter().map(|b| format!("{:02x}", b)).collect::<String>()
                })
            })
            .collect();

        let mut metadata = Map::new();
        metadata.insert("source_app".to_string(), Value::String(source_app));
        metadata.insert(
            "office_app".to_string(),
            Value::String(office_classification.app.as_metadata_value().to_string()),
        );
        metadata.insert("extra_types".to_string(), Value::Array(extra_json));
        metadata.insert(
            "office_kind".to_string(),
            Value::String(office_classification.kind.as_metadata_value().to_string()),
        );

        if let Some(table) = office_classification.table {
            metadata.insert(
                "table_source".to_string(),
                Value::String(table.source.as_metadata_value().to_string()),
            );
            if let Some(delimiter) = table.delimiter {
                metadata.insert("delimiter".to_string(), Value::String(delimiter));
            }
            if let Some(rows) = table.rows {
                metadata.insert(
                    "rows".to_string(),
                    Value::Number(serde_json::Number::from(rows)),
                );
            }
            if let Some(columns) = table.columns {
                metadata.insert(
                    "columns".to_string(),
                    Value::Number(serde_json::Number::from(columns)),
                );
            }
        }

        // extracted_text comes from direct clipboard/SVG/PDF extraction and stays preferred
        // over OCR when available. If extraction fails but we still have a preview asset,
        // keep OCR pending so a future worker can promote real text into index_text.
        let has_ocr_candidate = image_path.is_some() || pdf_path.is_some() || svg_path.is_some();
        let (primary_text_source, ocr_status) =
            determine_office_text_state(&extracted_text, has_ocr_candidate);

        let index_text = compute_index_text(
            if extracted_text.is_empty() {
                None
            } else {
                Some(extracted_text.as_str())
            },
            None,
        );

        Ok(ClipItem {
            id,
            content_type: "office".to_string(),
            content_text: Some(extracted_text), // Text from pasteboard/SVG/PDF → searchable via FTS5
            content_html: html_data,
            content_rtf: rtf_data,
            svg_path,                  // SVG file: clipboard_data/svg/{id}.svg
            pdf_path,                  // PDF file: clipboard_data/pdf/{id}.pdf
            image_path,                // PNG file: clipboard_data/images/{id}.png
            attachment_path,           // Office native format: clipboard_data/office/{id}.bin
            attachment_type: ole_type, // UTI type for restoring OLE to pasteboard
            file_paths: None,
            ocr_text: None,
            index_text,
            primary_text_source,
            ocr_status,
            detected_type: "office".to_string(),
            metadata: Some(Value::Object(metadata).to_string()),
            note: None,
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

    pub fn app_handle(&self) -> &AppHandle {
        &self.app_handle
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

#[cfg(test)]
mod tests {
    use super::determine_office_text_state;

    #[test]
    fn office_with_extracted_text_is_not_ocr_pending() {
        let (primary_text_source, ocr_status) =
            determine_office_text_state("Quarterly summary", true);

        assert_eq!(primary_text_source, "office");
        assert_eq!(ocr_status, "not_needed");
    }

    #[test]
    fn office_without_text_but_with_preview_stays_pending_for_ocr() {
        let (primary_text_source, ocr_status) = determine_office_text_state("", true);

        assert_eq!(primary_text_source, "none");
        assert_eq!(ocr_status, "pending");
    }

    #[test]
    fn office_without_text_or_preview_does_not_queue_ocr() {
        let (primary_text_source, ocr_status) = determine_office_text_state("", false);

        assert_eq!(primary_text_source, "none");
        assert_eq!(ocr_status, "not_needed");
    }
}
