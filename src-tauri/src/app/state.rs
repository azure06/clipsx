use crate::{
    contributions::transformer::TransformService,
    extensions::ExtensionService,
    foundation::{AppRoots, SchemaState},
    history::HistoryRepository,
};
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
}

pub struct AppState {
    pub roots: AppRoots,
    pub history: HistoryRepository,
    pub transforms: TransformService,
    pub extensions: ExtensionService,
}
