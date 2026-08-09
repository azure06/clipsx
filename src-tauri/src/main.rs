#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod contracts;
mod contributions;
mod foundation;
mod history;

use clipboard::{capture_coherent, is_self_write_token, ClipboardAdapter, SystemClipboardAdapter};
use contracts::{FactoryResetResult, StartupStatus};
use foundation::{AppRoots, SchemaState};
use history::{CaptureSettings, HistoryRepository, ListRequest};
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
) -> Result<history::ClipPage, String> {
    state.history.list(request).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn get_clip_detail(
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<history::ClipDetail, String> {
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
    let snapshot = capture_coherent(&mut adapter).map_err(|e| e.to_string())?;
    match state.history.capture(snapshot, &settings).await {
        Ok((id, duplicate)) => {
            let history = state.history.clone();
            let event_app = app.clone();
            let detect_id = id.clone();
            tauri::async_runtime::spawn(async move {
                match contributions::detect_clip(&history, &detect_id).await {
                    Ok(_) => {
                        let _ = event_app.emit("clip-facets-updated", detect_id);
                    }
                    Err(error) => {
                        let _ = event_app.emit("detection-job-failed", error.to_string());
                    }
                }
            });
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
    let representations = state
        .history
        .reconstruction(&clip_id)
        .await
        .map_err(|e| e.to_string())?;
    SystemClipboardAdapter::new()
        .write(&representations)
        .map(|_| ())
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
async fn list_tags(state: State<'_, AppState>) -> Result<Vec<history::Tag>, String> {
    state.history.tags().await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn create_tag(
    name: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<history::Tag, String> {
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

#[tauri::command]
async fn get_clip_views(
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<contributions::ClipViewSet, String> {
    contributions::views(&state.history, &clip_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn render_clip_view(
    clip_id: String,
    renderer_id: String,
    source_id: String,
    state: State<'_, AppState>,
) -> Result<contracts::RenderModel, String> {
    contributions::render(&state.history, &clip_id, &renderer_id, &source_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn list_renderer_contributions() -> Vec<contributions::RendererDescriptor> {
    contributions::renderers()
}
#[tauri::command]
async fn get_renderer_preferences(
    state: State<'_, AppState>,
) -> Result<contributions::RendererPreferences, String> {
    contributions::preferences(&state.history)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn update_renderer_preferences(
    app: tauri::AppHandle,
    preferences: contributions::RendererPreferences,
    state: State<'_, AppState>,
) -> Result<(), String> {
    contributions::update_preferences(&state.history, &preferences)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("renderer-preferences-updated", ());
    Ok(())
}
#[tauri::command]
async fn redetect_clip(
    app: tauri::AppHandle,
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    contributions::detect_clip(&state.history, &clip_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clip-facets-updated", clip_id);
    Ok(())
}
#[tauri::command]
async fn redetect_history(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let mut count = 0;
    let mut cursor = None;
    loop {
        let page = state
            .history
            .list(ListRequest {
                cursor,
                limit: Some(100),
                scope: Some("all".into()),
                tag_id: None,
            })
            .await
            .map_err(|e| e.to_string())?;
        for clip in page.items {
            contributions::detect_clip(&state.history, &clip.id)
                .await
                .map_err(|e| e.to_string())?;
            count += 1;
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    let _ = app.emit("clip-facets-updated", ());
    Ok(count)
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("clipsx-asset", |context, request| {
            let id = request.uri().path().trim_start_matches('/');
            let state = context.app_handle().state::<AppState>();
            match tauri::async_runtime::block_on(state.history.asset(id)) {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Cache-Control", "private, max-age=31536000, immutable")
                    .header("X-Content-Type-Options", "nosniff")
                    .body(bytes)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain")
                    .body(b"asset not found".to_vec())
                    .unwrap(),
            }
        })
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
            tauri::async_runtime::block_on(contributions::initialize(&history))
                .expect("Failed to initialize ClipsX facet registry");
            let redetect_history = history.clone();
            let redetect_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match contributions::redetect_outdated(&redetect_history).await {
                    Ok(count) if count > 0 => {
                        let _ = redetect_app.emit("clip-facets-updated", ());
                    }
                    Err(error) => {
                        let _ = redetect_app.emit("detection-job-failed", error.to_string());
                    }
                    _ => {}
                }
            });
            let monitor_history = history.clone();
            let monitor_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut adapter = SystemClipboardAdapter::new();
                let mut last_token = adapter.snapshot_token().unwrap_or_default();
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(350));
                loop {
                    interval.tick().await;
                    let token = match adapter.snapshot_token() {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if token == last_token || is_self_write_token(token) {
                        last_token = token;
                        continue;
                    }
                    last_token = token;
                    let snapshot = match capture_coherent(&mut adapter) {
                        Ok(value) => value,
                        Err(error) => {
                            let _ = monitor_app.emit("capture-rejected", error.to_string());
                            continue;
                        }
                    };
                    let settings = match monitor_history.settings().await {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    match monitor_history.capture(snapshot, &settings).await {
                        Ok((id, duplicate)) => {
                            let _ = monitor_app.emit(
                                if duplicate {
                                    "clip-updated"
                                } else {
                                    "clip-captured"
                                },
                                &id,
                            );
                            let detection_history = monitor_history.clone();
                            let detection_app = monitor_app.clone();
                            tauri::async_runtime::spawn(async move {
                                match contributions::detect_clip(&detection_history, &id).await {
                                    Ok(_) => {
                                        let _ = detection_app.emit("clip-facets-updated", id);
                                    }
                                    Err(error) => {
                                        let _ = detection_app
                                            .emit("detection-job-failed", error.to_string());
                                    }
                                }
                            });
                        }
                        Err(error) => {
                            let _ = monitor_app.emit("capture-rejected", error.to_string());
                        }
                    }
                }
            });
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
            update_capture_settings,
            get_clip_views,
            render_clip_view,
            list_renderer_contributions,
            get_renderer_preferences,
            update_renderer_preferences,
            redetect_clip,
            redetect_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipsX");
}
