// Tauri commands (IPC handlers)
use crate::models::{AppSettings, ClipItem};
use crate::repositories::{ClipRepository, SettingsRepository};
use crate::services::clipboard::ClipboardService;
use crate::services::paste;
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub repository: Arc<ClipRepository>,
    pub clipboard_service: Arc<ClipboardService>,
    pub settings_repository: Arc<SettingsRepository>,
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
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .get_recent_paginated(limit.unwrap_or(50), offset.unwrap_or(0))
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
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .search(&query, filter_types, limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

/// Search clips with FTS pagination
/// NOTE: For future semantic search integration, add a new command:
/// search_clips_semantic(query, limit, offset, use_embeddings)
#[tauri::command]
pub async fn search_clips_paginated(
    query: String,
    filter_types: Option<Vec<String>>,
    limit: Option<i32>,
    offset: Option<i32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .search_paginated(
            &query,
            filter_types,
            limit.unwrap_or(50),
            offset.unwrap_or(0),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_clip(id: String, state: State<'_, AppState>) -> Result<(), String> {
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
    state
        .repository
        .clear_all()
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Clipboard Commands
// ============================================================================

#[tauri::command]
pub async fn copy_to_clipboard(
    text: String,
    id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Update timestamp when copying existing clip
    if let Some(clip_id) = id {
        state
            .repository
            .touch(&clip_id)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;
    }

    state
        .clipboard_service
        .set_text(&text)
        .map_err(|e: anyhow::Error| e.to_string())
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::Manager;

    // 1. Copy text to clipboard
    if let Some(ref clip_id) = id {
        state
            .repository
            .touch(clip_id)
            .await
            .map_err(|e: anyhow::Error| e.to_string())?;
    }
    state
        .clipboard_service
        .set_text(&text)
        .map_err(|e: anyhow::Error| e.to_string())?;

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

/// Helper to toggle the main window visibility (used by shortcut and tray)
pub fn toggle_window(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        match (window.is_visible(), window.is_focused()) {
            (Ok(true), Ok(true)) => {
                // Visible and focused -> Hide
                let _ = window.hide();
            }
            _ => {
                // Hidden OR Visible but not focused -> Show and Focus
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
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
