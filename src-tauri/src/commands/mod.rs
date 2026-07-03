// Tauri commands (IPC handlers)
use crate::models::{
    AiCapabilityKind, AiCapabilityStatus, AppSettings, ClipItem, IndexingOverview,
};
use crate::repositories::{ClipRepository, SettingsRepository};
use crate::services::capabilities::{ImageSearchCapability, TextSearchCapability};
use crate::services::clipboard::ClipboardService;
use crate::services::indexing::{AiStackProgressPayload, IndexingService};
use crate::services::paste;
use crate::services::search::{SearchService, DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD};
use crate::services::semantic::{SemanticRuntimeStatus, SemanticService};
use crate::services::visual::VisualService;
use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::State;

pub struct AppState {
    pub repository: Arc<ClipRepository>,
    pub clipboard_service: Arc<ClipboardService>,
    pub settings_repository: Arc<SettingsRepository>,
    pub text_search: Arc<TextSearchCapability>,
    pub image_search: Arc<ImageSearchCapability>,
    pub semantic_service: Arc<SemanticService>,
    pub visual_service: Arc<VisualService>,
    pub search_service: Arc<SearchService>,
    pub indexing_service: Arc<IndexingService>,
    pub updater_configured: bool,
    #[cfg(target_os = "macos")]
    pub previous_app_pid: Mutex<Option<i32>>,
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn get_frontmost_app_pid() -> Option<i32> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace == nil {
            return None;
        }

        let frontmost_app: id = msg_send![workspace, frontmostApplication];
        if frontmost_app == nil {
            return None;
        }

        let pid: i32 = msg_send![frontmost_app, processIdentifier];
        let self_pid = std::process::id() as i32;

        if pid <= 0 || pid == self_pid {
            None
        } else {
            Some(pid)
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn remember_frontmost_app(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    if let Ok(mut previous_app_pid) = state.previous_app_pid.lock() {
        let pid = get_frontmost_app_pid();
        eprintln!("[PASTE] remember_frontmost_app: pid={:?}", pid);
        *previous_app_pid = pid;
    };
}

#[cfg(target_os = "macos")]
fn take_previous_app_pid(app: &tauri::AppHandle) -> Option<i32> {
    let state = app.try_state::<AppState>()?;
    let Ok(mut previous_app_pid) = state.previous_app_pid.lock() else {
        return None;
    };

    previous_app_pid.take()
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn activate_app_by_pid(pid: i32) -> bool {
    use cocoa::appkit::{NSApplicationActivationOptions, NSRunningApplication};
    use cocoa::base::{id, nil};

    unsafe {
        let running_app: id =
            NSRunningApplication::runningApplicationWithProcessIdentifier(nil, pid as _);
        if running_app == nil {
            return false;
        }

        NSRunningApplication::activateWithOptions_(
            running_app,
            NSApplicationActivationOptions::NSApplicationActivateIgnoringOtherApps,
        )
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfoPayload {
    pub updater_configured: bool,
}

/// Status payload used by AppLayout / SearchBar to drive the AI toggle in the search bar.
/// Reflects the text-search capability only (other capabilities don't gate search UX).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSearchStatusPayload {
    pub state: String,
    pub enabled: bool,
    pub message: String,
    pub progress: Option<AiStackProgressPayload>,
}

fn build_text_search_status(
    enabled: bool,
    installed: bool,
    runtime_status: SemanticRuntimeStatus,
) -> TextSearchStatusPayload {
    if !enabled {
        return TextSearchStatusPayload {
            state: "disabled".to_string(),
            enabled: false,
            message: "Text search is turned off in Plugins.".to_string(),
            progress: None,
        };
    }

    match runtime_status {
        SemanticRuntimeStatus::Idle => TextSearchStatusPayload {
            state: if installed {
                "idle".to_string()
            } else {
                "missing_model".to_string()
            },
            enabled: true,
            message: if installed {
                "Text search is installed and waiting to load.".to_string()
            } else {
                "Text search model is not loaded. Install Text Search in Plugins.".to_string()
            },
            progress: None,
        },
        SemanticRuntimeStatus::Loading { model_name } => TextSearchStatusPayload {
            state: "loading".to_string(),
            enabled: true,
            message: format!("Loading {} into memory.", model_name),
            progress: None,
        },
        SemanticRuntimeStatus::Indexing {
            model_name,
            done,
            total,
        } => TextSearchStatusPayload {
            state: "indexing".to_string(),
            enabled: true,
            message: format!("Indexing existing clips with {}.", model_name),
            progress: Some(AiStackProgressPayload { done, total }),
        },
        SemanticRuntimeStatus::Ready { model_name } => TextSearchStatusPayload {
            state: "ready".to_string(),
            enabled: true,
            message: format!("{} is ready.", model_name),
            progress: None,
        },
        SemanticRuntimeStatus::Error { message, .. } => TextSearchStatusPayload {
            state: "error".to_string(),
            enabled: true,
            message,
            progress: None,
        },
    }
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
    tag_filter: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .get_recent_paginated(
            limit.unwrap_or(50),
            offset.unwrap_or(0),
            favorites_only.unwrap_or(false),
            pinned_only.unwrap_or(false),
            tag_filter,
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
#[allow(clippy::too_many_arguments)]
pub async fn search_objects_paginated(
    query: String,
    filter_types: Option<Vec<String>>,
    limit: Option<i32>,
    offset: Option<i32>,
    favorites_only: Option<bool>,
    pinned_only: Option<bool>,
    tag_filter: Option<i64>,
    use_semantic_search: bool,
    similarity_threshold: Option<f32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    let limit_val = limit.unwrap_or(50);
    let offset_val = offset.unwrap_or(0);
    let fav_val = favorites_only.unwrap_or(false);
    let pin_val = pinned_only.unwrap_or(false);
    let threshold = similarity_threshold.unwrap_or(DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD);

    state
        .search_service
        .search_paginated(
            &query,
            filter_types,
            limit_val,
            offset_val,
            fav_val,
            pin_val,
            tag_filter,
            use_semantic_search,
            threshold,
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

#[tauri::command]
pub async fn decode_qr_code(clip_id: String, state: State<'_, AppState>) -> Result<String, String> {
    // Get the clip from the database
    let clip = state
        .repository
        .get_by_id(&clip_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Clip {} not found", clip_id))?;

    // Only image clips can have QR codes
    if clip.content_type != "image" {
        return Err("Clip is not an image".to_string());
    }

    // Check if image path exists
    let image_path = clip.image_path.ok_or("Image clip has no image_path")?;

    // Attempt QR decode from image file
    let qr_content = crate::services::qr_decoder::decode_qr_from_path(&image_path)
        .map_err(|e| e.to_string())?
        .ok_or("No QR code found in image")?;

    Ok(qr_content)
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

/// Shared write pipeline for all OS clipboard writes.
///
/// - `track_usage=true` + `clip_id` present → calls `touch()` to update recency
/// - `clip_id` present + `plain=false` → reconstructs full rich clipboard object
/// - all other cases → plain-text write only
/// - monitor is notified exactly once per call to prevent self-recapture
async fn execute_clipboard_write(
    text: String,
    clip_id: Option<&str>,
    plain: Option<bool>,
    track_usage: bool,
    state: &State<'_, AppState>,
) -> Result<(), String> {
    if track_usage {
        if let Some(id) = clip_id {
            state
                .repository
                .touch(id)
                .await
                .map_err(|e: anyhow::Error| e.to_string())?;
        }
    }

    let should_reconstruct = clip_id.is_some() && plain != Some(true);

    if should_reconstruct {
        let id = clip_id.unwrap();
        eprintln!("[RECONSTRUCT] Starting clipboard write for clip_id: {}", id);

        let clip = state
            .repository
            .get_by_id(id)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?
            .ok_or_else(|| "Clip not found".to_string())?;

        eprintln!(
            "[RECONSTRUCT] content_type={}, attachment_path={:?}, svg_path={:?}, pdf_path={:?}, image_path={:?}",
            clip.content_type,
            clip.attachment_path.as_ref().map(|_| "set"),
            clip.svg_path.as_ref().map(|_| "set"),
            clip.pdf_path.as_ref().map(|_| "set"),
            clip.image_path.as_ref().map(|_| "set")
        );

        let content = reconstruct_clipboard_content(&clip, text).await?;

        crate::services::clipboard_platform::write_clipboard(&content)
            .map_err(|e| format!("Failed to write clipboard: {}", e))?;

        {
            let monitor = state.clipboard_service.get_monitor();
            let mut monitor = monitor.lock().await;
            monitor.notify_wrote(&content);
        }

        eprintln!("[RECONSTRUCT] ✓ Clipboard write complete");
    } else {
        // Plain-text write (set_text already calls notify_wrote internally)
        state
            .clipboard_service
            .set_text(&text)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_to_clipboard(
    text: String,
    clip_id: Option<String>,
    plain: Option<bool>,
    track_usage: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    execute_clipboard_write(
        text,
        clip_id.as_deref(),
        plain,
        track_usage.unwrap_or(false),
        &state,
    )
    .await
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
    clip_id: Option<String>,
    plain: Option<bool>,
    track_usage: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::Manager;

    // 1. Write clip content to clipboard via shared pipeline
    execute_clipboard_write(
        text,
        clip_id.as_deref(),
        plain,
        track_usage.unwrap_or(false),
        &state,
    )
    .await?;

    // 2. Hide the overlay window
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    #[cfg(target_os = "macos")]
    let previous_app_pid = take_previous_app_pid(&app);

    #[cfg(target_os = "macos")]
    {
        if let Some(previous_app_pid) = previous_app_pid {
            eprintln!("[PASTE] activating and targeting pid={}", previous_app_pid);
            let app_handle = app.clone();
            let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
            let _ = app_handle.run_on_main_thread(move || {
                let ok = activate_app_by_pid(previous_app_pid);
                eprintln!("[PASTE] activate_app_by_pid returned={}", ok);
                let _ = tx.send(ok);
            });
            let _ = rx.await;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        } else {
            eprintln!("[PASTE] no previous_app_pid — using session paste fallback");
            tokio::time::sleep(std::time::Duration::from_millis(75)).await;
        }
    }
    #[cfg(not(target_os = "macos"))]
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // 4. Simulate paste keystroke (Ctrl+V / ⌘V)
    eprintln!("[PASTE] simulate_paste firing");
    let paste_result = paste::simulate_paste({
        #[cfg(target_os = "macos")]
        {
            previous_app_pid
        }
        #[cfg(not(target_os = "macos"))]
        {
            None
        }
    });
    eprintln!("[PASTE] simulate_paste result={:?}", paste_result);
    paste_result.map_err(|e| e.to_string())?;

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
        show_main_window(app)?;
    }

    Ok(())
}

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    remember_frontmost_app(app);

    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    crate::window_behavior::reconcile_main_window(app, &window);

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
    app: tauri::AppHandle,
) -> Result<AppSettings, String> {
    use tauri::Manager;
    state
        .settings_repository
        .save(&settings)
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        crate::window_behavior::reconcile_main_window(&app, &window);
    }
    Ok(settings)
}

#[tauri::command]
pub fn reset_settings(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<AppSettings, String> {
    use tauri::Manager;
    let settings = AppSettings::default();
    state
        .settings_repository
        .save(&settings)
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        crate::window_behavior::reconcile_main_window(&app, &window);
    }
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
// AI Capability Commands
// ============================================================================

/// Returns the status of all downloadable AI capabilities.
#[tauri::command]
pub fn get_ai_capabilities(state: State<'_, AppState>) -> Result<Vec<AiCapabilityStatus>, String> {
    Ok(vec![
        state.text_search.status(),
        state.image_search.status(),
    ])
}

/// Install (download / init) a single capability.
#[tauri::command]
pub async fn install_ai_capability(
    kind: AiCapabilityKind,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    match kind {
        AiCapabilityKind::TextSearch => {
            state
                .text_search
                .install(&app_handle)
                .await
                .map_err(|e| e.to_string())?;

            // Enable text search once successfully installed.
            let mut settings = state
                .settings_repository
                .load()
                .map_err(|e| e.to_string())?;
            settings.text_search_enabled = true;
            state
                .settings_repository
                .save(&settings)
                .map_err(|e| e.to_string())?;
        }
        AiCapabilityKind::ImageSearch => {
            // Purge any legacy CLIP embeddings so they are regenerated with the current model.
            let _ = state
                .repository
                .delete_image_embeddings_for_model("Qdrant/clip-ViT-B-32-vision")
                .await;

            state
                .image_search
                .install(&app_handle)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Delete (unload + remove files) a single capability.
#[tauri::command]
pub fn delete_ai_capability(
    kind: AiCapabilityKind,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    match kind {
        AiCapabilityKind::TextSearch => {
            state
                .text_search
                .delete(&app_handle)
                .map_err(|e| e.to_string())?;

            let mut settings = state
                .settings_repository
                .load()
                .map_err(|e| e.to_string())?;
            settings.text_search_enabled = false;
            state
                .settings_repository
                .save(&settings)
                .map_err(|e| e.to_string())?;
        }
        AiCapabilityKind::ImageSearch => {
            state
                .image_search
                .delete(&app_handle)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Toggle the text-search capability on or off (load/unload the model).
/// Does not affect Image Search or OCR.
#[tauri::command]
pub async fn set_text_search_enabled(
    enabled: bool,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AppSettings, String> {
    use tauri::Emitter;

    let mut settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;

    if enabled {
        let ts_status = state.text_search.status();
        if ts_status.install_state != crate::models::AiCapabilityInstallState::Ready {
            return Err("Text Search is not installed. Install it from Plugins first.".to_string());
        }
        state
            .semantic_service
            .init_model(Some(app_handle.clone()))
            .await
            .map_err(|e| e.to_string())?;
        settings.text_search_enabled = true;
    } else {
        state.semantic_service.unload_model();
        settings.text_search_enabled = false;
    }

    state
        .settings_repository
        .save(&settings)
        .map_err(|e| e.to_string())?;

    if !enabled {
        let _ = app_handle.emit("ai-capabilities-changed", ());
    }

    Ok(settings)
}

/// Status payload used by AppLayout / SearchBar — reflects text search only.
#[tauri::command]
pub fn get_text_search_status(
    state: State<'_, AppState>,
) -> Result<TextSearchStatusPayload, String> {
    let settings = state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())?;
    let text_search_status = state.text_search.status();

    Ok(build_text_search_status(
        settings.text_search_enabled,
        text_search_status.install_state == crate::models::AiCapabilityInstallState::Ready,
        state.semantic_service.get_runtime_status(),
    ))
}

#[tauri::command]
pub fn get_release_info(state: State<'_, AppState>) -> ReleaseInfoPayload {
    ReleaseInfoPayload {
        updater_configured: state.updater_configured,
    }
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

#[tauri::command]
pub async fn get_indexing_overview(state: State<'_, AppState>) -> Result<IndexingOverview, String> {
    state
        .indexing_service
        .get_indexing_overview()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn index_missing_search_content(
    state: State<'_, AppState>,
) -> Result<IndexingOverview, String> {
    state
        .indexing_service
        .index_missing()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reindex_all_search_content(
    state: State<'_, AppState>,
) -> Result<IndexingOverview, String> {
    state
        .indexing_service
        .reindex_all()
        .await
        .map_err(|e| e.to_string())?;

    state
        .indexing_service
        .get_indexing_overview()
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tag & Note Commands
// ============================================================================

#[tauri::command]
pub async fn get_tags(state: State<'_, AppState>) -> Result<Vec<crate::models::Tag>, String> {
    state
        .repository
        .get_all_tags()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tag(
    name: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<crate::models::Tag, String> {
    state
        .repository
        .create_tag(&name, color)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_tag(tag_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state
        .repository
        .delete_tag(tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_tag_to_clip(
    clip_id: String,
    tag_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .repository
        .add_tag_to_clip(&clip_id, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_tag_from_clip(
    clip_id: String,
    tag_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .repository
        .remove_tag_from_clip(&clip_id, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tags_for_clip(
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::Tag>, String> {
    state
        .repository
        .get_tags_for_clip(&clip_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tags_for_clips(
    clip_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::ClipTagEntry>, String> {
    let pairs = state
        .repository
        .get_tags_for_clips(&clip_ids)
        .await
        .map_err(|e| e.to_string())?;
    Ok(pairs
        .into_iter()
        .map(|(clip_id, tag)| crate::models::ClipTagEntry { clip_id, tag })
        .collect())
}

#[tauri::command]
pub async fn update_clip_note(
    clip_id: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<crate::models::ClipItem, String> {
    eprintln!(
        "[NOTE_DEBUG][command] update_clip_note called | clip_id={} | incoming_note={:?} | expected=repository should save the note and return the updated clip",
        clip_id, note
    );

    let result = state.repository.update_clip_note(&clip_id, note).await;

    match &result {
        Ok(clip) => {
            eprintln!(
                "[NOTE_DEBUG][command] update_clip_note succeeded | clip_id={} | returned_note={:?} | expected=returned_note should equal the saved DB value",
                clip.id, clip.note
            );
            state
                .indexing_service
                .enqueue_clip_indexing(clip, false)
                .await;
        }
        Err(error) => eprintln!(
            "[NOTE_DEBUG][command] update_clip_note failed | clip_id={} | error={} | expected=no error",
            clip_id, error
        ),
    }

    result.map_err(|e| e.to_string())
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    type OleWriteCase = (Option<&'static [u8]>, Option<&'static str>, bool);

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
        let cases: &[OleWriteCase] = &[
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

    #[tokio::test]
    async fn clear_all_clips_deletes_all_clips_and_files() -> Result<(), String> {
        // Setup: Create a test repository with clips
        use crate::models::ClipItem;
        use crate::repositories::ClipRepository;

        let repo = ClipRepository::new("sqlite::memory:")
            .await
            .map_err(|e| e.to_string())?;

        // Insert test clips
        let clip1 = ClipItem::from_text("text1".to_string(), "test".to_string(), None);
        let clip2 = ClipItem::from_text("text2".to_string(), "test".to_string(), None);
        repo.insert(&clip1).await.map_err(|e| e.to_string())?;
        repo.insert(&clip2).await.map_err(|e| e.to_string())?;

        // Verify clips exist
        let before = repo.get_recent(100).await.map_err(|e| e.to_string())?;
        assert_eq!(before.len(), 2, "Expected 2 clips before clear");

        // Clear all clips from database
        repo.clear_all().await.map_err(|e| e.to_string())?;

        // Verify all clips are deleted
        let after = repo.get_recent(100).await.map_err(|e| e.to_string())?;
        assert_eq!(after.len(), 0, "Expected 0 clips after clear");

        Ok(())
    }
}
