#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod contracts;
mod foundation;
mod m1;

use contracts::{FactoryResetResult, StartupStatus};
use foundation::{AppRoots, SchemaState};
use m1::{
    CaptureSettings, ClipboardAdapter, HistoryRepository, ListRequest, SystemClipboardAdapter,
};
use tauri::{Emitter, Manager, State};

struct AppState {
    roots: AppRoots,
    schema_state: SchemaState,
    history: HistoryRepository,
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

#[tauri::command]
async fn list_clips(
    request: ListRequest,
    state: State<'_, AppState>,
) -> Result<m1::ClipPage, String> {
    state.history.list(request).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn get_clip_detail(
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<m1::ClipDetail, String> {
    state
        .history
        .detail(&clip_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn capture_clipboard(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = state.history.settings().await.map_err(|e| e.to_string())?;
    let mut adapter = SystemClipboardAdapter::new();
    let snapshot = adapter.capture().map_err(|e| e.to_string())?;
    match state.history.capture(snapshot, &settings).await {
        Ok((id, duplicate)) => {
            let _ = app.emit(
                if duplicate {
                    "clip-updated"
                } else {
                    "clip-captured"
                },
                &id,
            );
            Ok(id)
        }
        Err(error) => {
            let _ = app.emit("capture-rejected", error.to_string());
            Err(error.to_string())
        }
    }
}
#[tauri::command]
async fn copy_clip_original(clip_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let detail = state
        .history
        .detail(&clip_id)
        .await
        .map_err(|e| e.to_string())?;
    SystemClipboardAdapter::new()
        .write(&detail.representations)
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_clip(
    app: tauri::AppHandle,
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .delete(&clip_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clip-deleted", clip_id);
    Ok(())
}
#[tauri::command]
async fn set_clip_pinned(
    app: tauri::AppHandle,
    clip_id: String,
    value: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .set_flag(&clip_id, "is_pinned", value)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clip-updated", clip_id);
    Ok(())
}
#[tauri::command]
async fn set_clip_favorite(
    app: tauri::AppHandle,
    clip_id: String,
    value: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .set_flag(&clip_id, "is_favorite", value)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clip-updated", clip_id);
    Ok(())
}
#[tauri::command]
async fn update_clip_note(
    app: tauri::AppHandle,
    clip_id: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .note(&clip_id, note)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clip-updated", clip_id);
    Ok(())
}
#[tauri::command]
async fn list_tags(state: State<'_, AppState>) -> Result<Vec<m1::Tag>, String> {
    state.history.tags().await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn create_tag(
    name: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<m1::Tag, String> {
    state
        .history
        .create_tag(name, color)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_tag(tag_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .history
        .delete_tag(&tag_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn add_clip_tag(
    clip_id: String,
    tag_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .tag_clip(&clip_id, &tag_id, true)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn remove_clip_tag(
    clip_id: String,
    tag_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .tag_clip(&clip_id, &tag_id, false)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn get_capture_settings(state: State<'_, AppState>) -> Result<CaptureSettings, String> {
    state.history.settings().await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn update_capture_settings(
    settings: CaptureSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .update_settings(&settings)
        .await
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let roots =
                AppRoots::from_app(app.handle()).expect("Failed to resolve ClipsX storage roots");
            let schema_state = tauri::async_runtime::block_on(foundation::prepare(&roots))
                .expect("Failed to prepare the ClipsX v2 foundation");
            let history = tauri::async_runtime::block_on(HistoryRepository::connect(
                &roots.database(),
                roots.clipboard_data(),
            ))
            .expect("Failed to open ClipsX history");
            app.manage(AppState {
                roots,
                schema_state,
                history,
            });
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_status,
            factory_reset,
            restart_app,
            list_clips,
            get_clip_detail,
            capture_clipboard,
            copy_clip_original,
            delete_clip,
            set_clip_pinned,
            set_clip_favorite,
            update_clip_note,
            list_tags,
            create_tag,
            delete_tag,
            add_clip_tag,
            remove_clip_tag,
            get_capture_settings,
            update_capture_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipsX");
}
