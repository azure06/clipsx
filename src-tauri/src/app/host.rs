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
    if focus_search {
        emit_search_focus_when_active(app.clone(), window);
    }
    Ok(())
}

fn emit_search_focus_when_active(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..10 {
            if window.is_focused().unwrap_or(false) {
                if let Err(error) = app.emit(MAIN_WINDOW_ACTIVATED_EVENT, ()) {
                    eprintln!("[WINDOW] Could not request search focus: {error}");
                }
                return;
            }
            let _ = activate_native_window(&window);
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        eprintln!("[WINDOW] Main window did not become focused after activation");
    });
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
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
        SetWindowPos, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0);
        unsafe {
            if SetForegroundWindow(hwnd).as_bool() && GetForegroundWindow() == hwnd {
                return true;
            }

            // Windows may keep the previous application's input queue active
            // while a tray or global-hotkey callback is running. Temporarily
            // join that queue so focus is assigned to this window, then detach.
            let foreground = GetForegroundWindow();
            let foreground_thread = GetWindowThreadProcessId(foreground, None);
            let current_thread = GetCurrentThreadId();
            let attached = foreground_thread != 0
                && foreground_thread != current_thread
                && AttachThreadInput(current_thread, foreground_thread, true).as_bool();
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = BringWindowToTop(hwnd);
            let activated = SetForegroundWindow(hwnd).as_bool();
            let _ = SetFocus(Some(hwnd));
            if attached {
                let _ = AttachThreadInput(current_thread, foreground_thread, false);
            }
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
