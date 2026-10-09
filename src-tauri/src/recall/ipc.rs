//! Thin, main-webview-only adapters around the shared clipboard service.
use super::{
    contracts::*,
    service::{public_failure, ClipboardService},
};
use crate::{
    app::state::AppState,
    failure::{FailureCode, OperationFailure},
};
use tauri::State;

fn service(
    webview: &tauri::Webview,
    state: &AppState,
) -> Result<ClipboardService, OperationFailure> {
    if webview.label() != "main" {
        return Err(FailureCode::PermissionRequired.failure());
    }
    Ok(ClipboardService::new(state.history.clone()))
}

#[tauri::command]
pub async fn assistant_clipboard_status(
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<ClipboardStatus, OperationFailure> {
    service(&webview, &state)?
        .status()
        .await
        .map_err(public_failure)
}
#[tauri::command]
pub async fn assistant_clipboard_filters(
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<ClipboardFilters, OperationFailure> {
    service(&webview, &state)?
        .filters()
        .await
        .map_err(public_failure)
}
#[tauri::command]
pub async fn assistant_search_clips(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    request: ClipSearchRequest,
) -> Result<ClipSearchResult, OperationFailure> {
    service(&webview, &state)?
        .search(request)
        .await
        .map_err(public_failure)
}
#[tauri::command]
pub async fn assistant_read_clip(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    request: ClipReadRequest,
) -> Result<ClipReadResult, OperationFailure> {
    service(&webview, &state)?
        .read(request)
        .await
        .map_err(public_failure)
}
#[tauri::command]
pub async fn assistant_read_clip_image(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    request: ClipImageRequest,
) -> Result<ClipImageResult, OperationFailure> {
    service(&webview, &state)?
        .image(request)
        .await
        .map_err(public_failure)
}
