//! Operating-system window behavior shared by shortcuts, tray, and deep links.

use super::state::HostState;
use tauri::{Emitter, Manager};

const MAIN_WINDOW_ACTIVATED_EVENT: &str = "main-window-activated";

#[derive(Debug, PartialEq, Eq)]
enum MainWindowAction {
    Show,
    Hide,
}

fn shortcut_window_action(visible: bool, focused: bool, minimized: bool) -> MainWindowAction {
    if visible && focused && !minimized {
        MainWindowAction::Hide
    } else {
        MainWindowAction::Show
    }
}

fn activate_main_window(app: &tauri::AppHandle, focus_search: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    if !window.is_focused().unwrap_or(false) {
        if let Some(state) = app.try_state::<HostState>() {
            state.window_behavior.mark_native_interaction();
            state.remember_paste_target(crate::output::paste::capture_focus());
        }
    }
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if !activate_native_window(&window) {
        eprintln!("[WINDOW] The operating system did not grant foreground activation");
    }
    app.get_webview("main")
        .ok_or_else(|| "main webview is unavailable".to_owned())?
        .set_focus()
        .map_err(|error| error.to_string())?;
    if focus_search {
        app.emit(MAIN_WINDOW_ACTIVATED_EVENT, ())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    activate_main_window(app, false)
}

pub fn show_main_window_and_focus_search(app: &tauri::AppHandle) -> Result<(), String> {
    activate_main_window(app, true)
}

#[cfg(target_os = "windows")]
fn activate_native_window(window: &tauri::WebviewWindow) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, SetForegroundWindow,
    };

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0);
        unsafe {
            let _ = BringWindowToTop(hwnd);
            let activated = SetForegroundWindow(hwnd).as_bool();
            return activated && GetForegroundWindow() == hwnd;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn activate_native_window(_window: &tauri::WebviewWindow) -> bool {
    true
}

pub fn toggle_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    match shortcut_window_action(visible, focused, minimized) {
        MainWindowAction::Hide => window.hide().map_err(|error| error.to_string()),
        MainWindowAction::Show => show_main_window_and_focus_search(app),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_hides_only_an_active_window() {
        assert_eq!(
            shortcut_window_action(true, true, false),
            MainWindowAction::Hide
        );
        assert_eq!(
            shortcut_window_action(false, false, false),
            MainWindowAction::Show
        );
        assert_eq!(
            shortcut_window_action(true, false, false),
            MainWindowAction::Show
        );
        assert_eq!(
            shortcut_window_action(true, true, true),
            MainWindowAction::Show
        );
    }
}
