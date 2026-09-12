//! Operating-system window behavior shared by shortcuts, tray, and deep links.

use super::state::HostState;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const MAIN_WINDOW_ACTIVATED_EVENT: &str = "main-window-activated";
const ACTIVATION_CONFIRM_ATTEMPTS: usize = 10;
const ACTIVATION_CONFIRM_INTERVAL: Duration = Duration::from_millis(25);
const ACTIVATION_WATCHDOG: Duration = Duration::from_secs(5);

#[derive(Default)]
struct ActivationQueue {
    running: bool,
    pending_focus_search: bool,
}

struct ActivationCoordinatorInner {
    queue: Mutex<ActivationQueue>,
    next_id: AtomicU64,
}

#[derive(Clone)]
pub(crate) struct ActivationCoordinator(Arc<ActivationCoordinatorInner>);

impl Default for ActivationCoordinator {
    fn default() -> Self {
        Self(Arc::new(ActivationCoordinatorInner {
            queue: Mutex::new(ActivationQueue::default()),
            next_id: AtomicU64::new(1),
        }))
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ActivationSchedule {
    Start { id: u64, focus_search: bool },
    Coalesced,
}

impl ActivationCoordinator {
    fn request(&self, focus_search: bool) -> Result<ActivationSchedule, String> {
        let mut queue = self
            .0
            .queue
            .lock()
            .map_err(|_| "window activation coordinator is unavailable".to_owned())?;
        if queue.running {
            queue.pending_focus_search |= focus_search;
            return Ok(ActivationSchedule::Coalesced);
        }
        queue.running = true;
        Ok(ActivationSchedule::Start {
            id: self.0.next_id.fetch_add(1, Ordering::Relaxed),
            focus_search,
        })
    }

    fn complete(&self) -> Option<(u64, bool)> {
        let Ok(mut queue) = self.0.queue.lock() else {
            return None;
        };
        if queue.pending_focus_search {
            queue.pending_focus_search = false;
            Some((self.0.next_id.fetch_add(1, Ordering::Relaxed), true))
        } else {
            queue.running = false;
            None
        }
    }
}

#[derive(Clone, Copy)]
#[repr(u8)]
enum ActivationStage {
    Scheduled = 0,
    Restore = 1,
    Show = 2,
    WindowFocus = 3,
    Foreground = 4,
    Confirm = 5,
    WebviewFocus = 6,
    Emit = 7,
    Complete = 8,
}

impl ActivationStage {
    fn label(value: u8) -> &'static str {
        match value {
            1 => "restore",
            2 => "show",
            3 => "window-focus",
            4 => "foreground",
            5 => "confirm",
            6 => "webview-focus",
            7 => "emit",
            8 => "complete",
            _ => "scheduled",
        }
    }
}

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
    let state = app
        .try_state::<HostState>()
        .ok_or_else(|| "window host state is unavailable".to_owned())?;
    state.window_behavior.mark_native_interaction();
    if let Some(target) = crate::output::paste::capture_focus() {
        state.remember_paste_target(Some(target));
    }
    let coordinator = state.activation.clone();
    let ActivationSchedule::Start { id, focus_search } = coordinator.request(focus_search)? else {
        return Ok(());
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut request = Some((id, focus_search));
        while let Some((id, focus_search)) = request {
            run_activation(&app, &window, id, focus_search);
            request = coordinator.complete();
        }
    });
    Ok(())
}

fn run_activation(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    id: u64,
    focus_search: bool,
) {
    let started = Instant::now();
    let stage = Arc::new(AtomicU8::new(ActivationStage::Scheduled as u8));
    let completed = Arc::new(AtomicBool::new(false));
    start_activation_watchdog(id, stage.clone(), completed.clone());
    crate::diagnostic!("[WINDOW] Activation id={id} stage=scheduled");

    let result = perform_activation(app, window, focus_search, &stage);
    let final_stage = stage.load(Ordering::SeqCst);
    stage.store(ActivationStage::Complete as u8, Ordering::SeqCst);
    completed.store(true, Ordering::SeqCst);
    match result {
        Ok(()) => crate::diagnostic!(
            "[WINDOW] Activation id={id} result=completed duration_ms={}",
            started.elapsed().as_millis()
        ),
        Err(_) => crate::diagnostic!(
            "[WINDOW] Activation id={id} result=failed stage={} duration_ms={}",
            ActivationStage::label(final_stage),
            started.elapsed().as_millis()
        ),
    }
}

fn perform_activation(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    focus_search: bool,
    stage: &AtomicU8,
) -> Result<(), String> {
    stage.store(ActivationStage::Restore as u8, Ordering::SeqCst);
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    stage.store(ActivationStage::Show as u8, Ordering::SeqCst);
    window.show().map_err(|error| error.to_string())?;
    stage.store(ActivationStage::WindowFocus as u8, Ordering::SeqCst);
    window.set_focus().map_err(|error| error.to_string())?;
    stage.store(ActivationStage::Foreground as u8, Ordering::SeqCst);
    if !activate_native_window(window) {
        crate::diagnostic!("[WINDOW] The operating system did not grant foreground activation");
    }
    stage.store(ActivationStage::Confirm as u8, Ordering::SeqCst);
    let activated = (0..ACTIVATION_CONFIRM_ATTEMPTS).any(|_| {
        if main_window_is_active(window) {
            true
        } else {
            std::thread::sleep(ACTIVATION_CONFIRM_INTERVAL);
            false
        }
    });
    if !activated {
        return Err("foreground activation was not confirmed".to_owned());
    }
    stage.store(ActivationStage::WebviewFocus as u8, Ordering::SeqCst);
    app.get_webview("main")
        .ok_or_else(|| "main webview is unavailable".to_owned())?
        .set_focus()
        .map_err(|error| error.to_string())?;
    if focus_search {
        stage.store(ActivationStage::Emit as u8, Ordering::SeqCst);
        app.emit(MAIN_WINDOW_ACTIVATED_EVENT, ())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn start_activation_watchdog(id: u64, stage: Arc<AtomicU8>, completed: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ACTIVATION_WATCHDOG).await;
        if !completed.load(Ordering::SeqCst) {
            crate::diagnostic!(
                "[WINDOW] Activation id={id} result=watchdog-timeout stage={}",
                ActivationStage::label(stage.load(Ordering::SeqCst))
            );
        }
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

#[cfg(target_os = "windows")]
fn main_window_is_active(window: &tauri::WebviewWindow) -> bool {
    use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::GetForegroundWindow};

    window
        .hwnd()
        .map(|hwnd| unsafe { GetForegroundWindow() == HWND(hwnd.0) })
        .unwrap_or_else(|_| window.is_focused().unwrap_or(false))
}

#[cfg(not(target_os = "windows"))]
fn main_window_is_active(window: &tauri::WebviewWindow) -> bool {
    window.is_focused().unwrap_or(false)
}

pub fn toggle_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = main_window_is_active(&window);
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

    #[test]
    fn activation_coordinator_starts_and_cleans_up_requests() {
        let coordinator = ActivationCoordinator::default();
        assert_eq!(
            coordinator.request(false).unwrap(),
            ActivationSchedule::Start {
                id: 1,
                focus_search: false
            }
        );
        assert_eq!(coordinator.complete(), None);
        assert_eq!(
            coordinator.request(true).unwrap(),
            ActivationSchedule::Start {
                id: 2,
                focus_search: true
            }
        );
    }

    #[test]
    fn activation_coordinator_coalesces_and_promotes_search_focus() {
        let coordinator = ActivationCoordinator::default();
        let _ = coordinator.request(false).unwrap();
        assert_eq!(
            coordinator.request(false).unwrap(),
            ActivationSchedule::Coalesced
        );
        assert_eq!(
            coordinator.request(true).unwrap(),
            ActivationSchedule::Coalesced
        );
        assert_eq!(coordinator.complete(), Some((2, true)));
        assert_eq!(coordinator.complete(), None);
    }

    #[test]
    fn activation_coordinator_accepts_a_request_after_failure_cleanup() {
        let coordinator = ActivationCoordinator::default();
        let _ = coordinator.request(false).unwrap();
        assert_eq!(coordinator.complete(), None);
        assert!(matches!(
            coordinator.request(false).unwrap(),
            ActivationSchedule::Start { id: 2, .. }
        ));
    }
}
