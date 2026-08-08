#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod contracts;
mod foundation;

use contracts::{FactoryResetResult, StartupStatus};
use foundation::{AppRoots, SchemaState};
use tauri::{Manager, State};

struct AppState {
    roots: AppRoots,
    schema_state: SchemaState,
}

#[tauri::command]
fn get_startup_status(state: State<'_, AppState>) -> StartupStatus {
    foundation::startup_status(state.schema_state)
}

#[tauri::command]
fn factory_reset(
    confirmation: String,
    state: State<'_, AppState>,
) -> Result<FactoryResetResult, String> {
    foundation::factory_reset(&state.roots, &confirmation).map_err(|error| error.to_string())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let roots =
                AppRoots::from_app(app.handle()).expect("Failed to resolve ClipsX storage roots");
            let schema_state = tauri::async_runtime::block_on(foundation::prepare(&roots))
                .expect("Failed to prepare the ClipsX v2 foundation");
            app.manage(AppState {
                roots,
                schema_state,
            });
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_status,
            factory_reset,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipsX");
}
