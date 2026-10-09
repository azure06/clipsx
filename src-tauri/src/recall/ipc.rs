//! Thin, main-webview-only adapters around the shared clipboard service.
use super::{
    contracts::*,
    service::{public_failure, ClipboardService},
};
use crate::{
    app::state::AppState,
    failure::{FailureCode, OperationFailure},
};
use tauri::{Emitter, State};

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

pub fn action_committed(
    app: &tauri::AppHandle,
    history: &crate::history::HistoryRepository,
    result: &ClipboardActionResult,
) {
    crate::app::workers::wake_text_index(app, history.clone());
    crate::app::workers::wake_managed_files(app, history.clone());
    for clip in &result.clips {
        let _ = app.emit(
            if result.operation == "create" {
                "clip-captured"
            } else {
                "clip-updated"
            },
            &clip.clip_id,
        );
    }
    for id in &result.removed_clip_ids {
        let _ = app.emit("clip-deleted", id);
    }
    let _ = app.emit("assistant-action", result);
}
#[tauri::command]
pub async fn assistant_create_clip(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: CreateClipRequest,
) -> Result<ClipboardActionResult, OperationFailure> {
    let service = service(&webview, &state)?;
    let result = service
        .create(&super::mutations::Actor::native(), request)
        .await
        .map_err(public_failure)?;
    action_committed(&app, &state.history, &result);
    Ok(result)
}
#[tauri::command]
pub async fn assistant_organize_clips(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: OrganizeClipsRequest,
) -> Result<ClipboardActionResult, OperationFailure> {
    let result = service(&webview, &state)?
        .organize(&super::mutations::Actor::native(), request)
        .await
        .map_err(public_failure)?;
    action_committed(&app, &state.history, &result);
    Ok(result)
}
#[tauri::command]
pub async fn assistant_undo_action(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: UndoClipboardRequest,
) -> Result<ClipboardActionResult, OperationFailure> {
    let result = service(&webview, &state)?
        .undo(&super::mutations::Actor::native(), request)
        .await
        .map_err(public_failure)?;
    action_committed(&app, &state.history, &result);
    Ok(result)
}
#[tauri::command]
pub async fn assistant_action_activity(
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<Vec<ClipboardActivity>, OperationFailure> {
    service(&webview, &state)?
        .activity()
        .await
        .map_err(public_failure)
}

#[tauri::command]
pub async fn mcp_integration_status(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    runtime: State<'_, super::mcp::McpRuntime>,
) -> Result<McpIntegrationStatus, OperationFailure> {
    service(&webview, &state)?;
    runtime.status(&state.history).await.map_err(public_failure)
}
#[tauri::command]
pub async fn mcp_configure(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    runtime: State<'_, super::mcp::McpRuntime>,
    app: tauri::AppHandle,
    configuration: McpConfiguration,
) -> Result<McpIntegrationStatus, OperationFailure> {
    service(&webview, &state)?;
    super::mcp::configure(&state.history, configuration)
        .await
        .map_err(public_failure)?;
    runtime
        .reconcile(state.history.clone(), Some(app))
        .await
        .map_err(public_failure)?;
    runtime.status(&state.history).await.map_err(public_failure)
}
#[tauri::command]
pub async fn mcp_list_grants(
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<Vec<McpGrant>, OperationFailure> {
    service(&webview, &state)?;
    super::mcp::grants(&state.history)
        .await
        .map_err(public_failure)
}
#[tauri::command]
pub async fn mcp_issue_grant(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    runtime: State<'_, super::mcp::McpRuntime>,
    name: String,
    can_write: bool,
    rotate_id: Option<String>,
) -> Result<McpGrantSecret, OperationFailure> {
    service(&webview, &state)?;
    let result = super::mcp::issue(&state.history, &name, can_write, rotate_id.as_deref())
        .await
        .map_err(public_failure)?;
    runtime.invalidate(&result.grant.id).await;
    Ok(result)
}
#[tauri::command]
pub async fn mcp_revoke_grant(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    runtime: State<'_, super::mcp::McpRuntime>,
    id: String,
) -> Result<(), OperationFailure> {
    service(&webview, &state)?;
    super::mcp::revoke(&state.history, &id)
        .await
        .map_err(public_failure)?;
    runtime.invalidate(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_test_access(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    runtime: State<'_, super::mcp::McpRuntime>,
    token: String,
) -> Result<u32, OperationFailure> {
    service(&webview, &state)?;
    super::mcp::test_access(&runtime, &state.history, &token)
        .await
        .map_err(public_failure)
}
