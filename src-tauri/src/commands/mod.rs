// Tauri commands (IPC handlers)
use crate::models::{AppSettings, ClipItem};
use crate::repositories::{ClipRepository, SettingsRepository};
use crate::services::clipboard::ClipboardService;
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub repository: Arc<ClipRepository>,
    pub clipboard_service: Arc<ClipboardService>,
    pub settings_repository: Arc<SettingsRepository>,
}

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
    limit: Option<i32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .search(&query, limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

/// Search clips with FTS pagination
/// NOTE: For future semantic search integration, add a new command:
/// search_clips_semantic(query, limit, offset, use_embeddings)
#[tauri::command]
pub async fn search_clips_paginated(
    query: String,
    limit: Option<i32>,
    offset: Option<i32>,
    state: State<'_, AppState>,
) -> Result<Vec<ClipItem>, String> {
    state
        .repository
        .search_paginated(&query, limit.unwrap_or(50), offset.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_clip(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .repository
        .delete(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_favorite(
    id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .repository
        .toggle_favorite(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_pin(
    id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .repository
        .toggle_pin(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_clips(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .repository
        .clear_all()
        .await
        .map_err(|e| e.to_string())
}

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
pub fn get_clipboard_text(
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .clipboard_service
        .get_text()
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
pub async fn register_global_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    use tauri::Manager;
    
    // Unregister all existing shortcuts first
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    
    // Parse string to Shortcut
    let shortcut_parsed: Shortcut = shortcut.parse()
        .map_err(|e| format!("Invalid shortcut format: {}", e))?;
    
    // Register new shortcut
    app.global_shortcut()
        .on_shortcut(shortcut_parsed, move |app, _event, _shortcut| {
            if let Some(window) = app.get_webview_window("main") {
                match window.is_visible() {
                    Ok(true) => { let _ = window.hide(); }
                    Ok(false) => { 
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    Err(_) => {}
                }
            }
        })
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn toggle_window_visibility(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => window.hide().map_err(|e| e.to_string())?,
            Ok(false) => {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}


// ============================================================================
// Settings Commands
// ============================================================================

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .settings_repository
        .load()
        .map_err(|e| e.to_string())
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
