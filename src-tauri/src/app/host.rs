//! Operating-system window behavior shared by shortcuts, tray, and deep links.

use super::state::HostState;
use tauri::Manager;

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    if !window.is_focused().unwrap_or(false) {
        if let Some(state) = app.try_state::<HostState>() {
            state.remember_paste_target(crate::output::paste::capture_focus());
        }
    }
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn toggle_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && focused && !minimized {
        window.hide().map_err(|error| error.to_string())
    } else {
        show_main_window(app)
    }
}
