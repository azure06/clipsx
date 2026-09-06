use crate::{
    contributions::transformer::TransformService,
    extensions::ExtensionService,
    foundation::{AppRoots, SchemaState},
    history::HistoryRepository,
};
use std::sync::{Arc, Mutex};
use tauri::menu::MenuItem;

pub struct StartupState {
    pub roots: AppRoots,
    pub schema_state: SchemaState,
}

pub struct HostState {
    pub updater_configured: bool,
    pub tray_open_item: MenuItem<tauri::Wry>,
    pub tray_settings_item: MenuItem<tauri::Wry>,
    pub tray_quit_item: MenuItem<tauri::Wry>,
    pub paste_target: Mutex<Option<crate::output::paste::FocusTarget>>,
    pub window_behavior: Arc<super::window_behavior::WindowBehaviorState>,
    pub global_shortcut: super::global_shortcut::GlobalShortcutState,
}

impl HostState {
    pub fn remember_paste_target(&self, target: Option<crate::output::paste::FocusTarget>) {
        if let Ok(mut value) = self.paste_target.lock() {
            *value = target;
        }
    }

    pub fn take_paste_target(&self) -> Option<crate::output::paste::FocusTarget> {
        self.paste_target.lock().ok()?.take()
    }
}

pub struct AppState {
    pub roots: AppRoots,
    pub history: HistoryRepository,
    pub transforms: TransformService,
    pub extensions: ExtensionService,
    pub workers: super::workers::BackgroundWorkers,
    pub recall: crate::search::recall::RecallRuntime,
}
