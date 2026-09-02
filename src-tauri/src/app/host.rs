//! Operating-system window behavior shared by shortcuts, tray, and deep links.

use super::state::HostState;
use tauri::Manager;

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

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
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
    activate_native_window(&window);
    Ok(())
}

#[cfg(target_os = "windows")]
fn activate_native_window(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{BringWindowToTop, SetForegroundWindow};

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0);
        // A tray click, registered hotkey, or second-instance launch gives the
        // process foreground activation rights. Use them after Tauri restores
        // and shows the window; failures remain harmless because `set_focus`
        // above is the portable fallback.
        unsafe {
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn activate_native_window(_window: &tauri::WebviewWindow) {}

pub fn toggle_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    match shortcut_window_action(visible, focused, minimized) {
        MainWindowAction::Hide => window.hide().map_err(|error| error.to_string()),
        MainWindowAction::Show => show_main_window(app),
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
