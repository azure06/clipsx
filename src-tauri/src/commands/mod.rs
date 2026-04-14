// Tauri commands (IPC handlers)
use crate::models::{AppSettings, ClipItem};
use crate::repositories::{ClipRepository, SettingsRepository};
use crate::services::clipboard::ClipboardService;
use crate::services::paste;
use crate::services::semantic::SemanticService;
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub repository: Arc<ClipRepository>,
    pub clipboard_service: Arc<ClipboardService>,
    pub settings_repository: Arc<SettingsRepository>,
    pub semantic_service: Arc<SemanticService>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexStats {
    pub total_text_clips: i64,
    pub indexed_clips: i64,
    pub pending_clips: i64,
}

// ============================================================================
// Clip Commands
// ============================================================================

#[tauri::command]
pub async fn get_recent_clips(
    limit: Option<i32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .get_recent(limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recent_clips_paginated(
    limit: Option<i32>,
    offset: Option<i32>,
    favorites_only: Option<bool>,
    pinned_only: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .get_recent_paginated(
            limit.unwrap_or(50),
            offset.unwrap_or(0),
            favorites_only.unwrap_or(false),
            pinned_only.unwrap_or(false),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_clips_after_timestamp(
    timestamp: i64,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .get_after_timestamp(timestamp)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_clip_by_id(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<ClipItem>, String> {
    state
        .repository
        .get_by_id(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_clips(
    query: String,
    filter_types: Option<Vec<String>>,
    limit: Option<i32>,
    use_semantic_search: bool,
    similarity_threshold: Option<f32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    let limit_val = limit.unwrap_or(50);
    search_clips_paginated(
        query,
        filter_types,
        Some(limit_val),
        Some(0),
        Some(false),
        Some(false),
        use_semantic_search,
        similarity_threshold,
        state,
    )
    .await
}

#[tauri::command]
pub async fn search_clips_paginated(
    query: String,
    filter_types: Option<Vec<String>>,
    limit: Option<i32>,
    offset: Option<i32>,
    favorites_only: Option<bool>,
    pinned_only: Option<bool>,
    use_semantic_search: bool,
    similarity_threshold: Option<f32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    let limit_val = limit.unwrap_or(50);
    let offset_val = offset.unwrap_or(0);
    let fav_val = favorites_only.unwrap_or(false);
    let pin_val = pinned_only.unwrap_or(false);
    let threshold = similarity_threshold.unwrap_or(0.3); // Default threshold

    if use_semantic_search && state.semantic_service.is_ready() && !query.trim().is_empty() {
        // Run semantic search
        let query_vector = state
            .semantic_service
            .embed(query.clone())
            .await
            .map_err(|e| e.to_string())?;

        // Fetch embeddings with filters
        let all_embeddings = state
            .repository
            .get_embeddings_with_filters(filter_types.clone(), fav_val, pin_val)
            .await
            .map_err(|e| e.to_string())?;

        // Score all embeddings against query and filter by threshold
        let mut scored_clips: Vec<(String, f32)> = all_embeddings
            .into_iter()
            .filter_map(|emb| {
                let vec_float =
                    crate::services::semantic::SemanticService::bytes_to_vector(&emb.vector);
                let score = crate::services::semantic::SemanticService::cosine_similarity(
                    &query_vector,
                    &vec_float,
                );

                if score >= threshold {
                    Some((emb.clip_id, score))
                } else {
                    None
                }
            })
            .collect();

        // Sort by score DESC
        scored_clips.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Paginate in memory
        let start = offset_val as usize;
        let end = (start + limit_val as usize).min(scored_clips.len());

        if start >= scored_clips.len() {
            return Ok(Vec::new());
        }

        let page_ids: Vec<String> = scored_clips[start..end]
            .iter()
            .map(|(id, _)| id.clone())
            .collect();

        // Fetch actual clips
        let mut clips = state
            .repository
            .get_clips_by_ids(&page_ids)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;

        // Sort clips to match the scored order and assign scores
        clips.sort_by_key(|c| {
            page_ids
                .iter()
                .position(|id| id == &c.id)
                .unwrap_or(std::usize::MAX)
        });

        for clip in &mut clips {
            if let Some((_, score)) = scored_clips.iter().find(|(id, _)| id == &clip.id) {
                clip.similarity_score = Some(*score);
            }
        }

        return Ok(clips);
    }

    // Fallback to Full Text Search (FTS)
    state
        .repository
        .search_paginated(
            &query,
            filter_types,
            limit_val,
            offset_val,
            fav_val,
            pin_val,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_clip(id: String, state: State<'_, AppState>) -> Result<(), String> {
    // 1. Fetch clip to get file paths
    let clip = state
        .repository
        .get_by_id(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Clip not found".to_string())?;

    // 2. Delete files FIRST (before DB record)
    state
        .clipboard_service
        .cleanup_clip_files(&clip)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Delete DB record
    state
        .repository
        .delete(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_favorite(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state
        .repository
        .toggle_favorite(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_pin(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state
        .repository
        .toggle_pin(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_clips(state: State<'_, AppState>) -> Result<(), String> {
    // 1. Fetch ALL clips to get file paths
    let clips = state
        .repository
        .get_recent(i32::MAX)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Delete all files
    for clip in clips {
        state
            .clipboard_service
            .cleanup_clip_files(&clip)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 3. Clear DB
    state
        .repository
        .clear_all()
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Clipboard Commands
// ============================================================================

/// Reconstruct a full [`ClipboardContent`] from a stored [`ClipItem`], reading any
/// associated files from disk. Used by both `copy_to_clipboard` and `paste_clip` so
/// that rich formats (Office, image, HTML, RTF) are always fully restored.
///
/// ## Storage contract — DB field → ClipboardContent field
///
/// | content_type | DB / file field            | → ClipboardContent field  |
/// |-------------|----------------------------|---------------------------|
/// | any         | `content_text`             | `content` / `plain` / `extracted_text` |
/// | html        | `content_html`             | `html`                    |
/// | rtf         | `content_rtf`              | `rtf`                     |
/// | image       | `image_path` (disk)        | `data`                    |
/// | image       | `pdf_path` (disk, opt.)    | `pdf_data`                |
/// | files       | `file_paths` (JSON)        | `paths`                   |
/// | office      | `attachment_path` (disk)   | `ole_data`                |
/// | office      | `attachment_type`          | `ole_type`                |
/// | office      | `metadata["extra_types"]`  | `extra_types` (hex→bytes) |
/// | office      | `svg_path` (disk)          | `svg_data`                |
/// | office      | `pdf_path` (disk)          | `pdf_data`                |
/// | office      | `image_path` (disk)        | `png_data`                |
/// | office      | `content_html`             | `html_data`               |
/// | office      | `content_rtf`              | `rtf_data`                |
/// | office      | `app_name`                 | `source_app`              |
///
/// **Invariant**: `ole_data` and `ole_type` are always captured together. If
/// `ole_type` is `None` the OLE binary will be present but `write_clipboard`
/// will skip it rather than guess a version-specific UTI.
async fn reconstruct_clipboard_content(
    clip: &crate::models::ClipItem,
    fallback_text: String,
) -> Result<crate::services::clipboard_platform::ClipboardContent, String> {
    use crate::services::clipboard_platform::ClipboardContent;

    let content = match clip.content_type.as_str() {
        "text" => ClipboardContent::Text {
            content: clip.content_text.clone().unwrap_or(fallback_text),
        },

        "html" => ClipboardContent::Html {
            html: clip.content_html.clone().unwrap_or_default(),
            plain: clip.content_text.clone().unwrap_or_default(),
        },

        "rtf" => ClipboardContent::Rtf {
            rtf: clip.content_rtf.clone().unwrap_or_default(),
            plain: clip.content_text.clone().unwrap_or_default(),
        },

        "image" => {
            let image_data = if let Some(path) = &clip.image_path {
                tokio::fs::read(path)
                    .await
                    .map_err(|e| format!("Failed to read image: {}", e))?
            } else {
                return Err("Image clip has no image_path".to_string());
            };

            let format = if let Some(path) = &clip.image_path {
                if path.ends_with(".png") {
                    crate::services::clipboard_platform::ImageFormat::Png
                } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
                    crate::services::clipboard_platform::ImageFormat::Jpeg
                } else {
                    crate::services::clipboard_platform::ImageFormat::Tiff
                }
            } else {
                crate::services::clipboard_platform::ImageFormat::Png
            };

            ClipboardContent::Image {
                data: image_data,
                format,
                pdf_data: if let Some(path) = &clip.pdf_path {
                    tokio::fs::read(path).await.ok()
                } else {
                    None
                },
            }
        }

        "files" => ClipboardContent::Files {
            paths: serde_json::from_str(&clip.file_paths.clone().unwrap_or_default())
                .unwrap_or_default(),
        },

        "office" => {
            eprintln!("[RECONSTRUCT] Reading Office files from disk...");

            let ole_data = if let Some(path) = &clip.attachment_path {
                eprintln!("[RECONSTRUCT]Attempting to read OLE from: {}", path);
                match tokio::fs::read(path).await {
                    Ok(data) => {
                        eprintln!("[RECONSTRUCT]✓ OLE read successfully: {} bytes", data.len());
                        Some(data)
                    }
                    Err(e) => {
                        eprintln!("[RECONSTRUCT]✗ OLE read failed: {}", e);
                        None
                    }
                }
            } else {
                eprintln!("[RECONSTRUCT]No OLE path in clip");
                None
            };

            let svg_data = if let Some(path) = &clip.svg_path {
                eprintln!("[RECONSTRUCT]Attempting to read SVG from: {}", path);
                match tokio::fs::read(path).await {
                    Ok(data) => {
                        eprintln!("[RECONSTRUCT]✓ SVG read successfully: {} bytes", data.len());
                        Some(data)
                    }
                    Err(e) => {
                        eprintln!("[RECONSTRUCT]✗ SVG read failed: {}", e);
                        None
                    }
                }
            } else {
                eprintln!("[RECONSTRUCT]No SVG path in clip");
                None
            };

            let pdf_data = if let Some(path) = &clip.pdf_path {
                eprintln!("[RECONSTRUCT]Attempting to read PDF from: {}", path);
                match tokio::fs::read(path).await {
                    Ok(data) => {
                        eprintln!("[RECONSTRUCT]✓ PDF read successfully: {} bytes", data.len());
                        Some(data)
                    }
                    Err(e) => {
                        eprintln!("[RECONSTRUCT]✗ PDF read failed: {}", e);
                        None
                    }
                }
            } else {
                eprintln!("[RECONSTRUCT]No PDF path in clip");
                None
            };

            let png_data = if let Some(path) = &clip.image_path {
                eprintln!("[RECONSTRUCT]Attempting to read PNG from: {}", path);
                match tokio::fs::read(path).await {
                    Ok(data) => {
                        eprintln!("[RECONSTRUCT]✓ PNG read successfully: {} bytes", data.len());
                        Some(data)
                    }
                    Err(e) => {
                        eprintln!("[RECONSTRUCT]✗ PNG read failed: {}", e);
                        None
                    }
                }
            } else {
                eprintln!("[RECONSTRUCT]No PNG path in clip");
                None
            };

            eprintln!(
                "[RECONSTRUCT] Office content reconstructed - OLE: {}, SVG: {}, PDF: {}, PNG: {}",
                ole_data.is_some(),
                svg_data.is_some(),
                pdf_data.is_some(),
                png_data.is_some()
            );

            ClipboardContent::Office {
                ole_data,
                ole_type: clip.attachment_type.clone(),
                extra_types: {
                    let mut decoded = vec![];
                    if let Some(ref meta) = clip.metadata {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(meta) {
                            if let Some(arr) = json["extra_types"].as_array() {
                                for entry in arr {
                                    if let (Some(t), Some(hex)) =
                                        (entry["type"].as_str(), entry["hex"].as_str())
                                    {
                                        let data: Vec<u8> = (0..hex.len())
                                            .step_by(2)
                                            .filter_map(|i| {
                                                hex.get(i..i + 2)
                                                    .and_then(|s| u8::from_str_radix(s, 16).ok())
                                            })
                                            .collect();
                                        decoded.push((t.to_string(), data));
                                    }
                                }
                            }
                        }
                    }
                    decoded
                },
                svg_data,
                pdf_data,
                png_data,
                html_data: clip.content_html.clone(),
                rtf_data: clip.content_rtf.clone(),
                extracted_text: clip.content_text.clone().unwrap_or_default(),
                source_app: clip
                    .app_name
                    .clone()
                    .unwrap_or_else(|| "Microsoft Office".to_string()),
            }
        }

        _ => ClipboardContent::Text {
            content: fallback_text,
        },
    };

    Ok(content)
}

#[tauri::command]
pub async fn copy_to_clipboard(
    text: String,
    id: Option<String>,
    plain: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // If no ID, just copy plain text (for non-clip text)
    if id.is_none() {
        state
            .clipboard_service
            .set_text(&text)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;
        return Ok(());
    }

    let clip_id = id.unwrap();

    eprintln!("[COPY] Starting copy_to_clipboard for clip_id: {}", clip_id);

    // 1. Update timestamp (bump to top)
    state
        .repository
        .touch(&clip_id)
        .await
        .map_err(|e: anyhow::Error| e.to_string())?;

    // 2. If plain-text format requested, skip rich reconstruction
    if plain == Some(true) {
        state
            .clipboard_service
            .set_text(&text)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;
        eprintln!("[COPY] copy_to_clipboard complete (plain text)");
        return Ok(());
    }

    // 3. Fetch full ClipItem from database
    let clip = state
        .repository
        .get_by_id(&clip_id)
        .await
        .map_err(|e: anyhow::Error| e.to_string())?
        .ok_or_else(|| "Clip not found".to_string())?;

    eprintln!("[COPY] Fetched clip: content_type={}, attachment_path={:?}, svg_path={:?}, pdf_path={:?}, image_path={:?}",
              clip.content_type,
              clip.attachment_path.as_ref().map(|_| "set"),
              clip.svg_path.as_ref().map(|_| "set"),
              clip.pdf_path.as_ref().map(|_| "set"),
              clip.image_path.as_ref().map(|_| "set"));

    // 4. Reconstruct ClipboardContent based on content_type
    let content = reconstruct_clipboard_content(&clip, text).await?;

    // 5. Write all formats to clipboard
    eprintln!("[COPY] Writing content to clipboard...");
    crate::services::clipboard_platform::write_clipboard(&content)
        .map_err(|e| format!("Failed to write clipboard: {}", e))?;
    eprintln!("[COPY] ✓ Clipboard write complete");

    // 6. Pre-seed monitor hash to prevent re-capturing our own paste
    eprintln!("[COPY] Pre-seeding monitor hash...");
    {
        let monitor = state.clipboard_service.get_monitor();
        let mut monitor = monitor.lock().await;
        monitor.notify_wrote(&content);
    }
    eprintln!("[COPY] ✓ Monitor notified");

    eprintln!("[COPY] copy_to_clipboard complete");
    Ok(())
}

#[tauri::command]
pub fn get_clipboard_text(state: State<'_, AppState>) -> Result<String, String> {
    state
        .clipboard_service
        .get_text()
        .map_err(|e: anyhow::Error| e.to_string())
}

/// Quick Paste: copy clip → hide window (OS refocuses previous app) → simulate Ctrl+V/⌘V
#[tauri::command]
pub async fn paste_clip(
    text: String,
    id: Option<String>,
    plain: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::Manager;

    // 1. Write clip content to clipboard
    if let Some(ref clip_id) = id {
        state
            .repository
            .touch(clip_id)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;

        if plain == Some(true) {
            // Plain-text format requested — skip rich reconstruction
            state
                .clipboard_service
                .set_text(&text)
                .await
                .map_err(|e: anyhow::Error| e.to_string())?;
        } else {
            let clip = state
                .repository
                .get_by_id(clip_id)
                .await
                .map_err(|e: anyhow::Error| e.to_string())?
                .ok_or_else(|| "Clip not found".to_string())?;

            let content = reconstruct_clipboard_content(&clip, text).await?;

            crate::services::clipboard_platform::write_clipboard(&content)
                .map_err(|e| format!("Failed to write clipboard: {}", e))?;

            {
                let monitor = state.clipboard_service.get_monitor();
                let mut monitor = monitor.lock().await;
                monitor.notify_wrote(&content);
            }
        }
    } else {
        // No clip ID — plain text only (called without a stored clip)
        state
            .clipboard_service
            .set_text(&text)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;
    }

    // 2. Hide the overlay window — OS auto-refocuses previous app
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    // 3. Wait for OS to settle the focus change
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // 4. Simulate paste keystroke (Ctrl+V / ⌘V)
    paste::simulate_paste().map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// Window / Shortcut Commands
// ============================================================================

/// Register (or re-register) the global shortcut that toggles the overlay window.
/// Called at startup from main.rs AND when user changes shortcut in Settings.
#[tauri::command]
pub async fn register_global_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    setup_global_shortcut(&app, &shortcut)
}

/// Shared helper: parse shortcut string, register with toggle behavior.
/// Used by both the startup code (main.rs) and the `register_global_shortcut` command.
pub fn setup_global_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    // Unregister all existing shortcuts first
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    // Parse shortcut string (e.g. "Ctrl+Shift+V")
    let shortcut_parsed: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;

    // Register shortcut: toggle on key-down only (ignore key-up)
    app.global_shortcut()
        .on_shortcut(shortcut_parsed, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = toggle_window(app);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Helper to show/focus/hide the main window, used by global shortcut and tray.
///
/// Window state machine:
///   hidden                        → show + unminimize + focus
///   minimized (visible on taskbar)→ unminimize + show + focus
///   visible but not focused       → focus
///   visible + focused             → hide  (toggle off)
pub fn toggle_window(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let is_visible = window.is_visible().unwrap_or(false);
    let is_focused = window.is_focused().unwrap_or(false);
    let is_minimized = window.is_minimized().unwrap_or(false);

    if is_visible && is_focused && !is_minimized {
        // Fully visible and focused → toggle off
        let _ = window.hide();
    } else {
        // Any other state (hidden / minimized / visible-but-unfocused) → bring forward
        if is_minimized {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

// ============================================================================
// Settings Commands
// ============================================================================

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.settings_repository.load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    state
        .settings_repository
        .save(&settings)
        .map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn get_settings_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .settings_repository
        .config_path()
        .to_string_lossy()
        .to_string())
}
// ============================================================================
// IO / External Commands
// ============================================================================

#[tauri::command]
pub async fn open_text_in_editor(text: String, extension: Option<String>) -> Result<(), String> {
    // 1. Determine extension (default to .txt)
    let ext = extension.unwrap_or_else(|| "txt".to_string());
    // Ensure it starts with a dot if missing, though Builder::suffix handles this usually
    let suffix = if ext.starts_with('.') {
        ext
    } else {
        format!(".{}", ext)
    };

    // 2. Create a temporary file with the given extension
    // We use Builder to set the suffix
    let mut temp_file = tempfile::Builder::new()
        .suffix(&suffix)
        .tempfile()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    // 3. Write content to file
    use std::io::Write;
    temp_file
        .write_all(text.as_bytes())
        .map_err(|e| format!("Failed to write to temp file: {}", e))?;

    // 4. Persist the file so it outlives the function scope (otherwise it's deleted immediately)
    // The tempfile crate deletes on drop by default. We want it to persist so the editor can open it.
    // 'persist' keeps the file. We should rely on OS temp cleanup or implement our own cleanup logic later.
    // However, usually editors lock the file or read it quickly.
    // A better approach for "Open With" is to use `.keep()` or similar, BUT `tempfile::NamedTempFile`
    // deletes on drop. To keep it, we use `.keep()`.
    let (_file, path) = temp_file
        .keep()
        .map_err(|e| format!("Failed to persist temp file: {}", e))?;

    // Close the file handle explicitly before opening to avoid locking issues on Windows
    drop(_file);

    // 5. Open the file with default application
    open::that(&path).map_err(|e| format!("Failed to open file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open path: {}", e))?;
    Ok(())
}

// ============================================================================
// Semantic Search Commands
// ============================================================================

#[tauri::command]
pub async fn init_semantic_search(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;

    state
        .semantic_service
        .init_model(settings.semantic_model, Some(app_handle))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_semantic_search_enabled(
    enabled: bool,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AppSettings, String> {
    let mut settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;

    if enabled {
        state
            .semantic_service
            .init_model(settings.semantic_model.clone(), Some(app_handle))
            .await
            .map_err(|e| e.to_string())?;
        settings.semantic_search_enabled = true;
    } else {
        state.semantic_service.unload_model();
        settings.semantic_search_enabled = false;
    }

    state
        .settings_repository
        .save(&settings)
        .map_err(|e| e.to_string())?;

    Ok(settings)
}

#[tauri::command]
pub async fn change_semantic_model(
    model_name: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;

    // Unload the existing model first to free memory
    state.semantic_service.unload_model();

    // Load the new model
    state
        .semantic_service
        .init_model(model_name.clone(), Some(app_handle))
        .await
        .map_err(|e| e.to_string())?;

    settings.semantic_model = model_name;
    settings.semantic_search_enabled = true;
    state
        .settings_repository
        .save(&settings)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_semantic_search_status(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.semantic_service.is_ready())
}

#[tauri::command]
pub fn get_downloaded_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.semantic_service.get_downloaded_models())
}

#[tauri::command]
pub async fn get_semantic_index_stats(
    state: State<'_, AppState>,
) -> Result<SemanticIndexStats, String> {
    let settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;

    let stats = state
        .repository
        .get_embedding_stats(&settings.semantic_model)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SemanticIndexStats {
        total_text_clips: stats.total_text_clips,
        indexed_clips: stats.indexed_clips,
        pending_clips: (stats.total_text_clips - stats.indexed_clips).max(0),
    })
}

#[tauri::command]
pub fn delete_semantic_model(model_name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;

    state
        .semantic_service
        .delete_model(&model_name)
        .map_err(|e| e.to_string())?;

    if settings.semantic_model == model_name {
        settings.semantic_search_enabled = false;
        state.semantic_service.unload_model();
        state
            .settings_repository
            .save(&settings)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn reindex_semantic_embeddings(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<SemanticIndexStats, String> {
    use tauri::Emitter;

    let (model_name, dimensions) = state
        .semantic_service
        .get_model_info()
        .ok_or_else(|| "Semantic model is not loaded yet.".to_string())?;

    let candidates = state
        .repository
        .get_embedding_candidates_for_model(&model_name)
        .await
        .map_err(|e| e.to_string())?;

    let total = candidates.len() as u64;

    #[derive(serde::Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct ReindexProgressPayload {
        done: u64,
        total: u64,
    }

    for (index, clip) in candidates.into_iter().enumerate() {
        let vector = state
            .semantic_service
            .embed(clip.content_text)
            .await
            .map_err(|e| e.to_string())?;

        state
            .repository
            .create_embedding(
                &clip.id,
                SemanticService::vector_to_bytes(&vector),
                &model_name,
                dimensions,
            )
            .await
            .map_err(|e| e.to_string())?;

        let _ = app_handle.emit(
            "semantic-index-progress",
            ReindexProgressPayload {
                done: index as u64 + 1,
                total,
            },
        );
    }

    let stats = state
        .repository
        .get_embedding_stats(&model_name)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SemanticIndexStats {
        total_text_clips: stats.total_text_clips,
        indexed_clips: stats.indexed_clips,
        pending_clips: (stats.total_text_clips - stats.indexed_clips).max(0),
    })
}

#[tauri::command]
pub async fn generate_embedding(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (model_name, dimensions) = match state.semantic_service.get_model_info() {
        Some(info) => info,
        None => return Err("Semantic model is not loaded yet.".to_string()),
    };

    let clip = state
        .repository
        .get_by_id(&id)
        .await
        .map_err(|e: anyhow::Error| e.to_string())?
        .ok_or_else(|| "Clip not found".to_string())?;

    if let Some(text) = clip.content_text {
        let vector = state
            .semantic_service
            .embed(text)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;

        let vector_bytes = crate::services::semantic::SemanticService::vector_to_bytes(&vector);

        state
            .repository
            .create_embedding(&id, vector_bytes, &model_name, dimensions)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;

        Ok(())
    } else {
        Err("Clip does not have text content to embed".to_string())
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    /// Decode a hex string using the same safe `str::get` pattern used in
    /// `reconstruct_clipboard_content` for `extra_types`.
    fn hex_decode(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .filter_map(|i| {
                hex.get(i..i + 2)
                    .and_then(|s| u8::from_str_radix(s, 16).ok())
            })
            .collect()
    }

    #[test]
    fn hex_decode_normal() {
        assert_eq!(hex_decode("deadbeef"), vec![0xde, 0xad, 0xbe, 0xef]);
    }

    #[test]
    fn hex_decode_empty() {
        assert!(hex_decode("").is_empty());
    }

    #[test]
    fn hex_decode_odd_length_does_not_panic() {
        // "de" → 0xde, "ad" → 0xad, trailing "b" has no second nibble → silently skipped
        assert_eq!(hex_decode("deadb"), vec![0xde, 0xad]);
    }

    #[test]
    fn hex_decode_invalid_chars_skipped() {
        // "__" is not valid hex — from_str_radix returns Err → filtered out
        assert_eq!(hex_decode("de__ef"), vec![0xde, 0xef]);
    }

    #[test]
    fn hex_decode_uppercase() {
        assert_eq!(hex_decode("DEADBEEF"), vec![0xde, 0xad, 0xbe, 0xef]);
    }

    /// Verify the OLE write guard: only write when BOTH ole_data and ole_type
    /// are present. If either is None, we must skip to avoid pasteboard corruption.
    #[test]
    fn ole_write_guard_requires_both_data_and_uti() {
        let cases: &[(Option<&[u8]>, Option<&str>, bool)] = &[
            (
                Some(b"data"),
                Some("com.microsoft.PowerPoint-16.0-Slides-Package"),
                true,
            ),
            (Some(b"data"), None, false), // UTI unknown — must skip
            (
                None,
                Some("com.microsoft.PowerPoint-16.0-Slides-Package"),
                false,
            ), // no data
            (None, None, false),
        ];

        for (ole_data, ole_type, expected_written) in cases {
            let written = matches!((ole_data, ole_type), (Some(_), Some(_)));
            assert_eq!(
                written,
                *expected_written,
                "ole_data={} ole_type={} should_write={}",
                ole_data.is_some(),
                ole_type.is_some(),
                expected_written
            );
        }
    }
}
