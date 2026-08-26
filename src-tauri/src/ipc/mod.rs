//! Stable Tauri command surface and desktop runtime wiring.

use crate::app::{
    host,
    state::{AppState, HostState, StartupState},
    window_chrome,
};
use crate::clipboard::contract::ClipboardAdapter;
use crate::clipboard::{
    capture_coherent, consume_self_write_token, is_self_write_snapshot, SystemClipboardAdapter,
};
use crate::contracts::{self, FactoryResetResult, StartupStatus};
use crate::contributions::transformer as transformers;
use crate::extensions::{BridgeOutcome, BridgeRequest, ExtensionService};
use crate::foundation::AppRoots;
use crate::history::{CaptureSettings, HistoryRepository, ListRequest};
use crate::search::semantic as embeddings;
use crate::{
    artifacts, contributions, foundation, history,
    output::{self, paste},
    search,
};
use anyhow::Context;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn is_extension_webview_label(label: &str) -> bool {
    label.starts_with("extension-")
}

fn is_extension_asset_navigation(url: &url::Url, token: &str) -> bool {
    let path_prefix = format!("/{token}/");
    (url.scheme() == "clipsx-extension"
        && url.host_str() == Some("localhost")
        && url.path().starts_with(&path_prefix))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("clipsx-extension.localhost")
            && url.path().starts_with(&path_prefix))
}

fn is_extension_bridge_close_navigation(url: &url::Url, token: &str) -> bool {
    (url.scheme() == "clipsx-extension-bridge"
        && url.host_str() == Some(token)
        && url.path() == "/close")
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("clipsx-extension-bridge.localhost")
            && url.path() == format!("/{token}/close"))
}

fn route_webview_invokes<R, F, G>(
    application_handler: F,
    extension_handler: G,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
where
    R: tauri::Runtime,
    F: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
    G: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| {
        if is_extension_webview_label(invoke.message.webview_ref().label()) {
            extension_handler(invoke)
        } else {
            application_handler(invoke)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreUtility {
    id: String,
    kind: String,
    label: String,
    version: String,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum ContextActionRunResponse {
    Output {
        preview: Box<transformers::TransformPreview>,
        disposition: String,
    },
    OpenHttpsUrl {
        url: String,
    },
    Notification {
        level: String,
        message: String,
    },
    OpenDialog,
    NativeAction,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactUpdate {
    clip_id: String,
    source_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionViewState {
    token: String,
    label: String,
    state: &'static str,
    message: Option<String>,
}

async fn emit_clip_artifact_updates(
    app: &tauri::AppHandle,
    repo: &HistoryRepository,
    clip_id: &str,
) {
    let Ok(detail) = repo.detail(clip_id).await else {
        return;
    };
    for representation in detail.representations.iter().filter(|representation| {
        representation
            .canonical_mime_type
            .as_deref()
            .is_some_and(|mime| mime.starts_with("image/"))
    }) {
        let _ = app.emit(
            "clip-artifacts-updated",
            ArtifactUpdate {
                clip_id: clip_id.to_string(),
                source_id: representation.id.clone(),
            },
        );
    }
}

const AUTH_SERVICE: &str = "com.infiniti.clipsx";
const LOCAL_AUTH_CALLBACK_EVENT: &str = "auth-callback-url";
const LOCAL_AUTH_CALLBACK_PATH: &str = "/auth/desktop/callback";

fn auth_storage_entry(key: &str) -> Result<keyring::Entry, String> {
    match key {
        "sb-clipsx-auth-token" | "sb-clipsx-auth-token-code-verifier" => {
            keyring::Entry::new(AUTH_SERVICE, key).map_err(|error| error.to_string())
        }
        _ => Err("unsupported credential key".to_string()),
    }
}

#[tauri::command]
fn auth_storage_get(key: String) -> Result<Option<String>, String> {
    match auth_storage_entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn auth_storage_set(key: String, value: String) -> Result<(), String> {
    auth_storage_entry(&key)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn auth_storage_remove(key: String) -> Result<(), String> {
    match auth_storage_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn detect_with_extensions(
    history: &HistoryRepository,
    extensions: &ExtensionService,
    clip_id: &str,
) -> anyhow::Result<()> {
    contributions::detect_clip(history, clip_id).await?;
    extensions.detect_clip(history, clip_id).await?;
    extensions
        .refresh_compact_presentations(history, clip_id)
        .await?;
    Ok(())
}

fn wake_embedding_worker(app: tauri::AppHandle, history: HistoryRepository) {
    crate::app::workers::wake_text_index(&app, history);
}

async fn refresh_search_for_clip(
    app: &tauri::AppHandle,
    history: &HistoryRepository,
    clip_id: &str,
) -> anyhow::Result<()> {
    search::upsert_projection(history, clip_id).await?;
    embeddings::enqueue_clip(history, clip_id).await?;
    wake_embedding_worker(app.clone(), history.clone());
    Ok(())
}

fn refresh_ocr_dependents(app: tauri::AppHandle, history: HistoryRepository) {
    tauri::async_runtime::spawn(async move {
        let Ok(clip_ids) = artifacts::ocr_clip_ids(&history).await else {
            return;
        };
        for clip_id in clip_ids {
            emit_clip_artifact_updates(&app, &history, &clip_id).await;
            let _ = search::upsert_projection(&history, &clip_id).await;
            let _ = embeddings::enqueue_clip(&history, &clip_id).await;
        }
        wake_embedding_worker(app, history);
    });
}

fn source_is_excluded(snapshot: &history::CapturedSnapshot, excluded_apps: &[String]) -> bool {
    let candidates = [
        snapshot.source_app_id.as_deref(),
        snapshot.source_app_name.as_deref(),
    ];
    candidates.iter().flatten().any(|candidate| {
        excluded_apps
            .iter()
            .any(|excluded| excluded.eq_ignore_ascii_case(candidate.trim()))
    })
}

fn apply_capture_filters(
    snapshot: &mut history::CapturedSnapshot,
    filters: &history::CaptureFilters,
) {
    snapshot.representations.retain(|representation| {
        let native = representation.native_type.as_deref().unwrap_or_default();
        if let Some(capability) =
            crate::clipboard::capabilities::resolve(&representation.platform, None, native)
        {
            return match capability.settings_gate.as_deref() {
                Some("images") => filters.images,
                Some("files") => filters.files,
                Some("rich_text") => filters.rich_text,
                Some("office_and_documents") => filters.office_and_documents,
                _ => true,
            };
        }
        let mime = representation
            .canonical_mime_type
            .as_deref()
            .unwrap_or_default();
        (!matches!(&representation.payload, history::CapturedPayload::Files(_)) || filters.files)
            && (!mime.starts_with("image/") || filters.images)
            && (!matches!(mime, "text/html" | "text/rtf" | "application/rtf") || filters.rich_text)
            && (mime != "application/pdf" || filters.office_and_documents)
    });
    for observation in &mut snapshot.format_observations {
        let Some(capability_id) = observation.capability_id.as_deref() else {
            continue;
        };
        let Some(capability) = crate::clipboard::capabilities::matrix().by_id(capability_id) else {
            continue;
        };
        let enabled = match capability.settings_gate.as_deref() {
            Some("images") => filters.images,
            Some("files") => filters.files,
            Some("rich_text") => filters.rich_text,
            Some("office_and_documents") => filters.office_and_documents,
            _ => true,
        };
        if !enabled && observation.decision == "captured" {
            observation.decision = "disabled".into();
            observation.reason = "disabled_by_capture_setting".into();
        }
    }
}

fn apply_representation_size_limit(snapshot: &mut history::CapturedSnapshot, limit: Option<u64>) {
    let Some(limit) = limit else { return };
    let mut removed = std::collections::BTreeSet::new();
    snapshot.representations.retain(|representation| {
        let size = match &representation.payload {
            history::CapturedPayload::Text(value) => value.len() as u64,
            history::CapturedPayload::Binary(value) => value.len() as u64,
            history::CapturedPayload::Files(values) => {
                values.iter().map(|value| value.len() as u64).sum()
            }
        };
        if size > limit {
            removed.insert(
                representation
                    .native_type
                    .clone()
                    .unwrap_or_else(|| representation.format_key.clone()),
            );
            false
        } else {
            true
        }
    });
    for observation in &mut snapshot.format_observations {
        if removed.contains(&observation.native_identifier) && observation.decision == "captured" {
            observation.decision = "too_large".into();
            observation.reason = "representation_size_limit".into();
        }
    }
}

#[tauri::command]
fn get_startup_status(state: State<'_, StartupState>) -> StartupStatus {
    foundation::startup_status(state.schema_state)
}

#[tauri::command]
fn factory_reset(
    confirmation: String,
    state: State<'_, StartupState>,
) -> Result<FactoryResetResult, String> {
    foundation::factory_reset(&state.roots, &confirmation).map_err(|error| error.to_string())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

#[tauri::command]
fn show_main_window_command(app: tauri::AppHandle) -> Result<(), String> {
    host::show_main_window(&app)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayLabels {
    open: String,
    settings: String,
    quit: String,
}

#[tauri::command]
fn set_tray_labels(labels: TrayLabels, state: State<'_, HostState>) -> Result<(), String> {
    state
        .tray_open_item
        .set_text(labels.open)
        .map_err(|error| error.to_string())?;
    state
        .tray_settings_item
        .set_text(labels.settings)
        .map_err(|error| error.to_string())?;
    state
        .tray_quit_item
        .set_text(labels.quit)
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseInfo {
    updater_configured: bool,
}

#[tauri::command]
fn get_release_info(state: State<'_, HostState>) -> ReleaseInfo {
    ReleaseInfo {
        updater_configured: state.updater_configured,
    }
}

fn parse_local_auth_callback_request_line(
    request_line: &str,
    port: u16,
) -> Result<Option<String>, String> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || target.is_empty() {
        return Ok(None);
    }
    let url = url::Url::parse(&format!("http://127.0.0.1:{port}{target}"))
        .map_err(|error| format!("Unable to parse local auth callback URL: {error}"))?;
    if url.path() != LOCAL_AUTH_CALLBACK_PATH {
        return Ok(None);
    }
    Ok(Some(url.to_string()))
}

fn local_auth_callback_response(status_line: &str, body: &str) -> String {
    format!(
        "{status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn serve_local_auth_callback(listener: TcpListener, port: u16, app: tauri::AppHandle) {
    let Ok(accept_result) = tokio::time::timeout(Duration::from_secs(300), listener.accept()).await
    else {
        eprintln!("[AUTH] Local auth callback listener timed out.");
        return;
    };
    let Ok((mut stream, _)) = accept_result else {
        eprintln!("[AUTH] Local auth callback listener failed to accept a connection.");
        return;
    };
    let mut buffer = [0_u8; 8 * 1024];
    let Ok(bytes_read) = stream.read(&mut buffer).await else {
        eprintln!("[AUTH] Local auth callback listener failed to read the request.");
        return;
    };
    if bytes_read == 0 {
        return;
    }
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let request_line = request.lines().next().unwrap_or_default();
    let response = match parse_local_auth_callback_request_line(request_line, port) {
        Ok(Some(callback_url)) => {
            if app.emit(LOCAL_AUTH_CALLBACK_EVENT, callback_url).is_err() {
                local_auth_callback_response(
                    "HTTP/1.1 500 Internal Server Error",
                    "<!doctype html><title>ClipsX Sign-in</title><p>ClipsX could not finish sign-in. Return to the app and try again.</p>",
                )
            } else {
                let _ = host::show_main_window(&app);
                local_auth_callback_response(
                    "HTTP/1.1 200 OK",
                    "<!doctype html><title>ClipsX Sign-in</title><p>ClipsX received the sign-in callback. You can return to the app.</p><script>window.close()</script>",
                )
            }
        }
        Ok(None) => local_auth_callback_response(
            "HTTP/1.1 404 Not Found",
            "<!doctype html><title>Not Found</title><p>This callback URL is not used by ClipsX.</p>",
        ),
        Err(error) => {
            eprintln!("[AUTH] Failed to parse local auth callback request: {error}");
            local_auth_callback_response(
                "HTTP/1.1 400 Bad Request",
                "<!doctype html><title>Bad Request</title><p>ClipsX could not read the sign-in callback.</p>",
            )
        }
    };
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[tauri::command]
async fn start_local_auth_callback_listener(app: tauri::AppHandle) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Unable to start a local auth callback listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Unable to read the local auth callback address: {error}"))?
        .port();
    tauri::async_runtime::spawn(serve_local_auth_callback(listener, port, app));
    Ok(format!("http://127.0.0.1:{port}{LOCAL_AUTH_CALLBACK_PATH}"))
}

#[tauri::command]
#[allow(deprecated)]
fn open_external_url(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let parsed = url::Url::parse(url.trim()).map_err(|_| "invalid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only HTTP and HTTPS URLs are supported".into());
    }
    app.shell()
        .open(parsed.as_str(), None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(deprecated)]
fn compose_email(address: String, app: tauri::AppHandle) -> Result<(), String> {
    let address = address.trim();
    if address.contains(['\r', '\n']) || !address.contains('@') || address.contains(' ') {
        return Err("invalid email address".into());
    }
    app.shell()
        .open(format!("mailto:{address}"), None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(deprecated)]
fn start_phone_action(number: String, message: bool, app: tauri::AppHandle) -> Result<(), String> {
    let number = number.trim();
    if number.is_empty()
        || !number.chars().all(|character| {
            character.is_ascii_digit() || matches!(character, '+' | '-' | '(' | ')' | ' ' | '.')
        })
    {
        return Err("invalid phone number".into());
    }
    let scheme = if message { "sms" } else { "tel" };
    app.shell()
        .open(format!("{scheme}:{number}"), None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(deprecated)]
async fn open_clip_file(
    clip_id: String,
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let detail = state
        .history
        .detail(&clip_id)
        .await
        .map_err(|error| error.to_string())?;
    let allowed = detail.representations.iter().any(|representation| {
        representation
            .file_references
            .iter()
            .any(|reference| reference == &path)
    });
    if !allowed {
        return Err("file is not part of this clip".into());
    }
    app.shell()
        .open(path, None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_clip_file_preview(
    clip_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let detail = state
        .history
        .detail(&clip_id)
        .await
        .map_err(|error| error.to_string())?;
    let allowed = detail.representations.iter().any(|representation| {
        representation
            .file_references
            .iter()
            .any(|reference| reference == &path)
    });
    if !allowed {
        return Err("file is not part of this clip".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|_| "preview file is unavailable")?;
    if !metadata.is_file() || metadata.len() > 4 * 1024 * 1024 {
        return Err("preview file exceeds its 4 MiB limit".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "preview file is unavailable")?;
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return Err("file is not a supported raster preview".into());
    };
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

#[tauri::command]
#[allow(deprecated)]
async fn open_detected_path(
    clip_id: String,
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let allowed = contributions::facets(&state.history, &clip_id)
        .await
        .map_err(|error| error.to_string())?
        .iter()
        .any(|facet| {
            facet.id == "core.file.path"
                && facet
                    .payload
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    == Some(path.as_str())
        });
    if !allowed {
        return Err("path is not a validated facet of this clip".into());
    }
    app.shell()
        .open(path, None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(deprecated)]
async fn open_clip_text_in_editor(
    clip_id: String,
    extension: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if extension.is_empty()
        || extension.len() > 12
        || !extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("invalid editor file extension".into());
    }
    let detail = state
        .history
        .detail(&clip_id)
        .await
        .map_err(|error| error.to_string())?;
    let text = detail
        .representations
        .iter()
        .find(|representation| representation.canonical_mime_type.as_deref() == Some("text/plain"))
        .and_then(|representation| representation.text_value.as_deref())
        .or_else(|| {
            detail
                .representations
                .iter()
                .find_map(|representation| representation.text_value.as_deref())
        })
        .ok_or_else(|| "clip has no text representation".to_string())?;
    let directory = state.roots.data.join("editor_previews");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{clip_id}.{extension}"));
    std::fs::write(&path, text.as_bytes()).map_err(|error| error.to_string())?;
    app.shell()
        .open(path.to_string_lossy(), None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_extensions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::extensions::ExtensionSummary>, String> {
    state
        .extensions
        .list(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_extension_registry(
    state: State<'_, AppState>,
) -> Result<crate::extensions::RegistryIndex, String> {
    state
        .extensions
        .registry()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_extension_catalog(
    state: State<'_, AppState>,
) -> Result<crate::extensions::ExtensionCatalog, String> {
    state
        .extensions
        .catalog(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_extension_package_detail(
    package_id: String,
    state: State<'_, AppState>,
) -> Result<crate::extensions::ExtensionPackageDetail, String> {
    state
        .extensions
        .package_detail(&state.history, &package_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_extension_updates(
    force: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<crate::extensions::ExtensionCatalog, String> {
    let catalog = state
        .extensions
        .check_for_updates(&state.history, force)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-catalog-updated", ());
    Ok(catalog)
}

#[tauri::command]
async fn get_extension_auto_updates_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    state
        .extensions
        .auto_update_enabled(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_auto_updates_enabled(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .set_auto_update_enabled(&state.history, enabled)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_update_preference(
    package_id: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .set_update_preference(&state.history, &package_id, &mode)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_extension_registry(
    state: State<'_, AppState>,
) -> Result<crate::extensions::RegistryIndex, String> {
    state
        .extensions
        .refresh_registry()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_registry_extension(
    package_id: String,
    version: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<crate::extensions::ExtensionSummary, String> {
    close_extension_webviews(&app);
    let installed = state
        .extensions
        .install_registry(&state.history, &package_id, &version)
        .await
        .map_err(|error| error.to_string())?;
    state
        .extensions
        .redetect_history(&state.history)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-catalog-updated", ());
    Ok(installed)
}

#[tauri::command]
async fn install_local_extension(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<crate::extensions::ExtensionSummary, String> {
    close_extension_webviews(&app);
    let installed = state
        .extensions
        .install_local(&state.history, std::path::Path::new(&path))
        .await
        .map_err(|error| error.to_string())?;
    state
        .extensions
        .redetect_history(&state.history)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-catalog-updated", ());
    Ok(installed)
}

#[tauri::command]
async fn inspect_local_extension(
    path: String,
    state: State<'_, AppState>,
) -> Result<crate::extensions::ExtensionSummary, String> {
    state
        .extensions
        .inspect_local(&state.history, std::path::Path::new(&path))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_enabled(
    package_id: String,
    enabled: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state
        .extensions
        .set_enabled(&state.history, &package_id, enabled)
        .await
        .map_err(|error| error.to_string())?;
    if enabled {
        state
            .extensions
            .redetect_history(&state.history)
            .await
            .map_err(|error| error.to_string())?;
    } else {
        state
            .extensions
            .refresh_compact_history(&state.history)
            .await
            .map_err(|error| error.to_string())?;
    }
    if !enabled {
        close_extension_webviews(&app);
    }
    let _ = app.emit("extension-catalog-updated", ());
    Ok(())
}

#[tauri::command]
async fn recover_extension(
    package_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state
        .extensions
        .recover(&state.history, &package_id)
        .await
        .map_err(|error| error.to_string())?;
    state
        .extensions
        .redetect_history(&state.history)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-runtime-state-updated", ());
    let _ = app.emit("extension-catalog-updated", ());
    Ok(())
}

#[tauri::command]
async fn uninstall_extension(
    package_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    close_extension_webviews(&app);
    state
        .extensions
        .uninstall(&state.history, &package_id)
        .await
        .map_err(|error| error.to_string())?;
    state
        .extensions
        .refresh_compact_history(&state.history)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-catalog-updated", ());
    Ok(())
}

fn close_extension_webviews(app: &tauri::AppHandle) {
    for (label, webview) in app.webviews() {
        if label.starts_with("extension-") {
            let _ = webview.close();
        }
    }
}

#[tauri::command]
async fn get_extension_developer_mode(state: State<'_, AppState>) -> Result<bool, String> {
    state
        .extensions
        .developer_mode(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_developer_mode(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .set_developer_mode(&state.history, enabled)
        .await
        .map_err(|error| error.to_string())
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
    let app_settings = state
        .history
        .app_settings()
        .await
        .map_err(|e| e.to_string())?;
    let mut adapter = SystemClipboardAdapter::new();
    let mut snapshot = capture_coherent(&mut adapter).map_err(|e| e.to_string())?;
    if source_is_excluded(&snapshot, &app_settings.excluded_apps) {
        return Err("Clipboard source is excluded by capture settings".into());
    }
    apply_capture_filters(&mut snapshot, &app_settings.capture_filters);
    apply_representation_size_limit(&mut snapshot, app_settings.capture.max_representation_bytes);
    if snapshot.representations.is_empty() {
        return Err(
            "Every representation in this clipboard snapshot is disabled by capture filters".into(),
        );
    }
    match state.history.capture(snapshot, &app_settings.capture).await {
        Ok((id, duplicate)) => {
            crate::app::workers::wake_managed_files(&app, state.history.clone());
            let history = state.history.clone();
            let extensions = state.extensions.clone();
            let event_app = app.clone();
            let detect_id = id.clone();
            tauri::async_runtime::spawn(async move {
                match detect_with_extensions(&history, &extensions, &detect_id).await {
                    Ok(_) => {
                        let _ = event_app.emit("clip-facets-updated", detect_id);
                    }
                    Err(error) => {
                        let _ = event_app.emit("detection-job-failed", error.to_string());
                    }
                }
            });
            let history_for_artifacts = state.history.clone();
            let artifact_id = id.clone();
            let artifact_app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = artifacts::produce_for_clip(&history_for_artifacts, &artifact_id).await;
                emit_clip_artifact_updates(&artifact_app, &history_for_artifacts, &artifact_id)
                    .await;
                let _ = search::upsert_projection(&history_for_artifacts, &artifact_id).await;
                let _ = embeddings::enqueue_clip(&history_for_artifacts, &artifact_id).await;
                crate::app::workers::wake_ocr(&artifact_app, history_for_artifacts.clone());
                wake_embedding_worker(artifact_app, history_for_artifacts);
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
async fn list_transformer_contributions(
    clip_id: String,
    source_id: String,
    presentation_kind: String,
    state: State<'_, AppState>,
) -> Result<Vec<transformers::TransformerDescriptor>, String> {
    let mut descriptors = state
        .transforms
        .list_source(&state.history, &clip_id, &source_id, &presentation_kind)
        .await
        .map_err(|error| error.to_string())?;
    let (source, _) = state
        .history
        .source_representation(&clip_id, &source_id)
        .await
        .map_err(|error| error.to_string())?;
    for descriptor in state
        .extensions
        .transformer_descriptors_for(&state.history, &source)
        .await
        .map_err(|error| error.to_string())?
    {
        if !descriptors
            .iter()
            .any(|existing| existing.id == descriptor.id)
        {
            descriptors.push(descriptor);
        }
    }
    descriptors.retain(|descriptor| descriptor.expose_in_menu);
    Ok(descriptors)
}

#[tauri::command]
async fn create_transform_preview(
    clip_id: String,
    transformer_id: String,
    source_id: String,
    parameters: serde_json::Value,
    invocation_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<transformers::TransformPreview, String> {
    let (source, _) = state
        .history
        .source_representation(&clip_id, &source_id)
        .await
        .map_err(|error| error.to_string())?;
    if let Some((version, outputs)) = state
        .extensions
        .transform(
            &state.history,
            &transformer_id,
            source,
            parameters.clone(),
            None,
            invocation_token
                .as_deref()
                .map(|token| (clip_id.as_str(), source_id.as_str(), token)),
        )
        .await
        .map_err(|error| error.to_string())?
    {
        return state
            .transforms
            .cache_external(
                clip_id,
                transformer_id,
                version,
                source_id,
                parameters,
                outputs,
            )
            .map_err(|error| error.to_string());
    }
    state
        .transforms
        .preview(
            &state.history,
            &clip_id,
            &transformer_id,
            &source_id,
            parameters,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_context_actions(
    clip_id: String,
    source_id: String,
    facet_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::extensions::ContextActionDescriptor>, String> {
    state
        .extensions
        .context_actions(&state.history, &clip_id, &source_id, facet_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_extension_actions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::extensions::ContextActionDescriptor>, String> {
    state
        .extensions
        .action_catalog(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn run_context_action(
    app: tauri::AppHandle,
    clip_id: String,
    source_id: String,
    facet_id: Option<String>,
    action_id: String,
    parameters: serde_json::Value,
    invocation_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<ContextActionRunResponse, String> {
    match state
        .extensions
        .run_action(
            &state.history,
            &action_id,
            &clip_id,
            &source_id,
            facet_id.as_deref(),
            parameters.clone(),
            invocation_token.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())?
    {
        crate::extensions::ActionOutcome::Output {
            outputs,
            disposition,
            action_id,
            version,
        } => {
            let preview = state
                .transforms
                .cache_external(clip_id, action_id, version, source_id, parameters, outputs)
                .map_err(|error| error.to_string())?;
            Ok(ContextActionRunResponse::Output {
                preview: Box::new(preview),
                disposition: match disposition {
                    crate::extensions::ActionDisposition::Preview => "preview",
                    crate::extensions::ActionDisposition::Copy => "copy",
                    crate::extensions::ActionDisposition::Paste => "paste",
                    crate::extensions::ActionDisposition::SaveAsClip => "save_as_clip",
                }
                .into(),
            })
        }
        crate::extensions::ActionOutcome::OpenHttpsUrl(url) => {
            open_external_url(url.clone(), app)?;
            Ok(ContextActionRunResponse::OpenHttpsUrl { url })
        }
        crate::extensions::ActionOutcome::Notification { level, message } => {
            let _ = app.emit(
                "extension-action-notification",
                serde_json::json!({ "level": level, "message": message }),
            );
            Ok(ContextActionRunResponse::Notification { level, message })
        }
        crate::extensions::ActionOutcome::OpenDialog => Ok(ContextActionRunResponse::OpenDialog),
        crate::extensions::ActionOutcome::ComposeEmail(address) => {
            compose_email(address, app)?;
            Ok(ContextActionRunResponse::NativeAction)
        }
        crate::extensions::ActionOutcome::DialPhone(number) => {
            start_phone_action(number, false, app)?;
            Ok(ContextActionRunResponse::NativeAction)
        }
    }
}

#[tauri::command]
async fn grant_extension_action_permissions(
    action_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .grant_action_permissions(&state.history, &action_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn issue_extension_action_invocation(
    action_id: String,
    clip_id: String,
    source_id: String,
    facet_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<crate::extensions::ActionInvocation, String> {
    state
        .extensions
        .issue_action_invocation(
            &state.history,
            &action_id,
            &clip_id,
            &source_id,
            facet_id.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn grant_extension_transformer_permissions(
    transformer_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .grant_transformer_permissions(&state.history, &transformer_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn issue_extension_transformer_invocation(
    transformer_id: String,
    clip_id: String,
    source_id: String,
    state: State<'_, AppState>,
) -> Result<crate::extensions::ActionInvocation, String> {
    state
        .extensions
        .issue_transformer_invocation(&state.history, &transformer_id, &clip_id, &source_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_extension_package_settings(
    package_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    state
        .extensions
        .package_settings(&state.history, &package_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_package_setting(
    package_id: String,
    setting_id: String,
    value: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .set_package_setting(&state.history, &package_id, &setting_id, value)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_extension_credential_status(
    package_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::extensions::CredentialStatus>, String> {
    state
        .extensions
        .credential_status(&state.history, &package_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_credential(
    package_id: String,
    credential_id: String,
    value: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .set_credential(
            &state.history,
            &package_id,
            &credential_id,
            value.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn open_extension_custom_view(
    app: tauri::AppHandle,
    renderer_id: String,
    clip_id: String,
    source_id: String,
    facet_id: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    surface: String,
    theme: String,
    locale: String,
    state: State<'_, AppState>,
) -> Result<crate::extensions::CustomViewSession, String> {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width < 100.0
        || height < 80.0
        || width > 10_000.0
        || height > 10_000.0
    {
        return Err("extension custom view bounds are invalid".into());
    }
    let surface = match surface.as_str() {
        "detail" => crate::extensions::UiSurface::Detail,
        "dialog" => crate::extensions::UiSurface::Dialog,
        _ => return Err("unsupported extension custom view surface".into()),
    };
    let session = state
        .extensions
        .begin_custom_view(
            &state.history,
            &renderer_id,
            &clip_id,
            &source_id,
            facet_id.as_deref(),
            surface,
            &theme,
            &locale,
        )
        .await
        .map_err(|error| error.to_string())?;
    let url = url::Url::parse(&session.entry_url).map_err(|error| error.to_string())?;
    let allowed_token = session.token.clone();
    let bridge_token = session.token.clone();
    let bridge_label = session.label.clone();
    let bridge_app = app.clone();
    let initialization_script = state
        .extensions
        .custom_view_initialization_script(&session.token)
        .map_err(|error| error.to_string())?;
    let builder = tauri::webview::WebviewBuilder::new(
        session.label.clone(),
        tauri::WebviewUrl::External(url),
    )
    // Wry focuses child WebViews by default on Windows. A preview detail view
    // must not take history focus merely by loading; dialogs focus after ready.
    .focused(false)
    .initialization_script(initialization_script)
    .incognito(true)
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .devtools(cfg!(debug_assertions))
    .on_navigation(move |url| {
        if is_extension_bridge_close_navigation(url, &bridge_token) {
            if let Some(webview) = bridge_app.get_webview(&bridge_label) {
                let _ = webview.close();
            }
            if let Some(state) = bridge_app.try_state::<AppState>() {
                state.extensions.end_custom_view(&bridge_token);
            }
            if let Some(main) = bridge_app.get_webview("main") {
                let _ = main.set_focus();
            }
            return false;
        }
        is_extension_asset_navigation(url, &allowed_token)
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .on_download(|_, _| false);
    let parent = app
        .get_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let child = parent
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|error| error.to_string())?;
    child.hide().map_err(|error| error.to_string())?;
    Ok(session)
}

#[tauri::command]
async fn close_extension_custom_view(
    app: tauri::AppHandle,
    label: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !label.starts_with("extension-") {
        return Err("invalid extension custom view label".into());
    }
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    state.extensions.end_custom_view(&token);
    if let Some(main) = app.get_webview("main") {
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn sync_extension_custom_view(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: Option<bool>,
) -> Result<(), String> {
    if !label.starts_with("extension-")
        || !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width < 100.0
        || height < 80.0
    {
        return Err("extension custom view bounds are invalid".into());
    }
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "extension custom view is unavailable".to_string())?;
    webview
        .set_position(tauri::LogicalPosition::new(x, y))
        .and_then(|_| webview.set_size(tauri::LogicalSize::new(width, height)))
        .and_then(|_| match visible {
            Some(true) => webview.show(),
            Some(false) => webview.hide(),
            None => Ok(()),
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(deprecated)]
async fn extension_bridge(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    token: String,
    request: BridgeRequest,
    state: State<'_, AppState>,
    host_state: State<'_, HostState>,
) -> Result<serde_json::Value, String> {
    let outcome = state
        .extensions
        .bridge_request(&state.history, webview.label(), &token, request)
        .await
        .map_err(|error| error.to_string())?;
    match outcome {
        BridgeOutcome::ViewReady { focus } => {
            webview.show().map_err(|error| error.to_string())?;
            if focus {
                webview.set_focus().map_err(|error| error.to_string())?;
            }
            app.emit_to(
                "main",
                "extension-custom-view-state",
                ExtensionViewState {
                    token,
                    label: webview.label().to_string(),
                    state: "ready",
                    message: None,
                },
            )
            .map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "ready": true }))
        }
        BridgeOutcome::ViewFailed(message) => {
            let label = webview.label().to_string();
            webview.close().map_err(|error| error.to_string())?;
            state.extensions.end_custom_view(&token);
            if let Some(main) = app.get_webview("main") {
                let _ = main.set_focus();
            }
            app.emit_to(
                "main",
                "extension-custom-view-state",
                ExtensionViewState {
                    token,
                    label,
                    state: "failed",
                    message: Some(message),
                },
            )
            .map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "closed": true }))
        }
        BridgeOutcome::Https(response) => {
            serde_json::to_value(response).map_err(|error| error.to_string())
        }
        BridgeOutcome::OpenExternal(url) => {
            app.shell()
                .open(&url, None)
                .map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "opened": true }))
        }
        BridgeOutcome::GenerationText(text) => Ok(serde_json::json!({ "text": text })),
        BridgeOutcome::Output {
            outputs,
            disposition,
            action_id,
            version,
            clip_id,
            source_id,
            facet_id,
        } => {
            let preview = state
                .transforms
                .cache_external(
                    clip_id,
                    action_id,
                    version,
                    source_id,
                    serde_json::json!({ "facetId": facet_id }),
                    outputs,
                )
                .map_err(|error| error.to_string())?;
            let mut saved_clip_id = None;
            match disposition {
                crate::extensions::ActionDisposition::Preview => {}
                crate::extensions::ActionDisposition::SaveAsClip => {
                    saved_clip_id =
                        Some(save_transform_result_impl(app, &preview.result_id, &state).await?);
                }
                crate::extensions::ActionDisposition::Copy
                | crate::extensions::ActionDisposition::Paste => {
                    let disposition = if disposition == crate::extensions::ActionDisposition::Copy {
                        output::ClipboardOutputDisposition::Copy
                    } else {
                        output::ClipboardOutputDisposition::Paste
                    };
                    execute_clipboard_output_impl(
                        app,
                        output::ClipboardOutputRequest {
                            disposition,
                            source: output::ClipboardOutputSource::Transformed {
                                result_id: preview.result_id.clone(),
                            },
                        },
                        &state,
                        &host_state,
                    )
                    .await?;
                }
            }
            Ok(serde_json::json!({
                "resultId": preview.result_id,
                "savedClipId": saved_clip_id,
            }))
        }
    }
}

#[tauri::command]
async fn set_extension_action_pinned(
    action_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .extensions
        .set_action_pinned(&state.history, &action_id, pinned)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_extension_action_shortcut(
    action_id: String,
    accelerator: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(value) = accelerator.as_deref() {
        let normalized = value.to_ascii_lowercase();
        if !normalized.contains('+')
            || !["cmd", "ctrl", "alt", "shift", "super", "meta"]
                .iter()
                .any(|modifier| normalized.split('+').any(|part| part.trim() == *modifier))
        {
            return Err("action shortcuts require at least one modifier".into());
        }
        value
            .parse::<Shortcut>()
            .map_err(|_| "action shortcut is not a valid accelerator".to_string())?;
        let key = normalized_accelerator(value);
        let mut reserved = vec![
            normalized_accelerator("Ctrl+C"),
            normalized_accelerator("Cmd+C"),
            normalized_accelerator("Ctrl+F"),
            normalized_accelerator("Cmd+F"),
            normalized_accelerator("Ctrl+P"),
            normalized_accelerator("Cmd+P"),
            normalized_accelerator("Ctrl+Shift+O"),
            normalized_accelerator("Cmd+Shift+O"),
        ];
        for digit in '1'..='9' {
            reserved.push(normalized_accelerator(&format!("Ctrl+{digit}")));
            reserved.push(normalized_accelerator(&format!("Cmd+{digit}")));
        }
        let settings = state
            .history
            .app_settings()
            .await
            .map_err(|error| error.to_string())?;
        reserved.push(normalized_accelerator(&settings.global_shortcut));
        if reserved.contains(&key) {
            return Err("action shortcut conflicts with a ClipsX command".into());
        }
    }
    state
        .extensions
        .set_action_shortcut(&state.history, &action_id, accelerator.as_deref())
        .await
        .map_err(|error| error.to_string())
}

fn normalized_accelerator(value: &str) -> String {
    let mut parts = value
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts.sort();
    parts.join("+")
}

#[tauri::command]
async fn execute_clipboard_output(
    app: tauri::AppHandle,
    request: output::ClipboardOutputRequest,
    state: State<'_, AppState>,
    host_state: State<'_, HostState>,
) -> Result<(), String> {
    execute_clipboard_output_impl(app, request, &state, &host_state).await
}

async fn execute_clipboard_output_impl(
    app: tauri::AppHandle,
    request: output::ClipboardOutputRequest,
    state: &AppState,
    host_state: &HostState,
) -> Result<(), String> {
    if let Err(error) =
        output::write_source(&request.source, &state.history, &state.transforms).await
    {
        let message = error.to_string();
        if request.disposition == output::ClipboardOutputDisposition::Paste {
            let _ = app.emit("paste-failed", &message);
        }
        return Err(message);
    }
    if request.disposition == output::ClipboardOutputDisposition::Copy {
        return Ok(());
    }
    let focus_target = host_state.take_paste_target();
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.hide() {
            let message = error.to_string();
            let _ = app.emit("paste-failed", &message);
            return Err(message);
        }
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let paste_result =
        match tokio::task::spawn_blocking(move || paste::simulate_paste(focus_target)).await {
            Ok(result) => result,
            Err(error) => {
                let message = error.to_string();
                let _ = app.emit("paste-failed", &message);
                return Err(message);
            }
        };
    if let Err(error) = paste_result {
        let message = error.to_string();
        let _ = app.emit("paste-failed", &message);
        return Err(message);
    }
    let _ = app.emit("paste-completed", ());
    Ok(())
}

#[tauri::command]
async fn save_transform_result(
    app: tauri::AppHandle,
    result_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    save_transform_result_impl(app, &result_id, &state).await
}

async fn save_transform_result_impl(
    app: tauri::AppHandle,
    result_id: &str,
    state: &AppState,
) -> Result<String, String> {
    let (preview, source_clip_id, parameter_sha256) = state
        .transforms
        .saved_metadata(result_id)
        .map_err(|error| error.to_string())?;
    let snapshot = history::CapturedSnapshot {
        token: 0,
        source_app_name: Some("ClipsX".into()),
        source_app_id: Some("clipsx.transform".into()),
        format_observations: Vec::new(),
        representations: state
            .transforms
            .transformed(result_id)
            .map_err(|error| error.to_string())?,
    };
    let settings = state
        .history
        .settings()
        .await
        .map_err(|error| error.to_string())?;
    let clip_id = state
        .history
        .capture_forced(
            snapshot,
            &settings,
            &history::TransformProvenance {
                source_clip_id,
                source_representation_id: preview.source_id,
                transformer_id: preview.transformer_id,
                transformer_version: preview.transformer_version,
                parameter_sha256,
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    let history = state.history.clone();
    let extensions = state.extensions.clone();
    let detect_id = clip_id.clone();
    let detect_app = app.clone();
    tauri::async_runtime::spawn(async move {
        if detect_with_extensions(&history, &extensions, &detect_id)
            .await
            .is_ok()
        {
            let _ = detect_app.emit("clip-facets-updated", detect_id.clone());
        }
        let _ = search::upsert_projection(&history, &detect_id).await;
    });
    let _ = app.emit("transform-result-saved", &clip_id);
    let _ = app.emit("clip-captured", &clip_id);
    Ok(clip_id)
}

#[tauri::command]
async fn get_transform_preferences(
    state: State<'_, AppState>,
) -> Result<transformers::TransformPreferences, String> {
    transformers::preferences(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_transform_preferences(
    preferences: transformers::TransformPreferences,
    state: State<'_, AppState>,
) -> Result<(), String> {
    transformers::update_preferences(&state.history, &preferences)
        .await
        .map_err(|error| error.to_string())
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
    crate::app::workers::wake_managed_files(&app, state.history.clone());
    let _ = app.emit("clip-deleted", clip_id);
    Ok(())
}
#[tauri::command]
async fn clear_history(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<u64, String> {
    let ids = state
        .history
        .clear_history()
        .await
        .map_err(|e| e.to_string())?;
    crate::app::workers::wake_managed_files(&app, state.history.clone());
    for id in &ids {
        let _ = app.emit("clip-deleted", id);
    }
    Ok(ids.len() as u64)
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
    refresh_search_for_clip(&app, &state.history, &clip_id)
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
async fn delete_tag(
    app: tauri::AppHandle,
    tag_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let clips = state
        .history
        .clips_for_tag(&tag_id)
        .await
        .map_err(|e| e.to_string())?;
    state
        .history
        .delete_tag(&tag_id)
        .await
        .map_err(|e| e.to_string())?;
    for clip_id in clips {
        refresh_search_for_clip(&app, &state.history, &clip_id)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
async fn add_clip_tag(
    app: tauri::AppHandle,
    clip_id: String,
    tag_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .tag_clip(&clip_id, &tag_id, true)
        .await
        .map_err(|e| e.to_string())?;
    refresh_search_for_clip(&app, &state.history, &clip_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn remove_clip_tag(
    app: tauri::AppHandle,
    clip_id: String,
    tag_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .history
        .tag_clip(&clip_id, &tag_id, false)
        .await
        .map_err(|e| e.to_string())?;
    refresh_search_for_clip(&app, &state.history, &clip_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn get_capture_settings(state: State<'_, AppState>) -> Result<CaptureSettings, String> {
    state.history.settings().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_app_settings(state: State<'_, AppState>) -> Result<history::AppSettings, String> {
    state
        .history
        .app_settings()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_sync_status(state: State<'_, AppState>) -> Result<crate::sync::SyncStatus, String> {
    crate::sync::status(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_sync_enabled(
    user_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<crate::sync::SyncStatus, String> {
    crate::sync::set_enabled(&state.history, &user_id, enabled)
        .await
        .map_err(|error| error.to_string())?;
    crate::sync::status(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn prepare_sync_batch(state: State<'_, AppState>) -> Result<crate::sync::SyncBatch, String> {
    crate::sync::batch(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn apply_sync_response(
    app: tauri::AppHandle,
    response: crate::sync::SyncServerResponse,
    state: State<'_, AppState>,
) -> Result<crate::sync::SyncStatus, String> {
    let previous_ocr = artifacts::ocr_settings(&state.history)
        .await
        .map_err(|error| error.to_string())?;
    let status = crate::sync::apply(&state.history, response)
        .await
        .map_err(|error| error.to_string())?;
    artifacts::reconcile_ocr_settings(&state.history, &previous_ocr)
        .await
        .map_err(|error| error.to_string())?;
    crate::app::workers::wake_ocr(&app, state.history.clone());
    refresh_ocr_dependents(app.clone(), state.history.clone());
    let _ = app.emit("ocr-status-changed", ());
    Ok(status)
}

#[tauri::command]
async fn record_sync_error(message: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::sync::record_error(&state.history, &message)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_app_settings(
    settings: history::AppSettings,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<history::AppSettings, String> {
    state
        .history
        .update_app_settings(&settings)
        .await
        .map_err(|e| e.to_string())?;
    let effective = state
        .history
        .app_settings()
        .await
        .map_err(|e| e.to_string())?;
    if let (Some(window), Some(host_state)) =
        (app.get_webview_window("main"), app.try_state::<HostState>())
    {
        host_state
            .window_behavior
            .apply_settings(&window, &effective);
    }
    let _ = app.emit("app-settings-updated", ());
    Ok(effective)
}

#[tauri::command]
fn register_global_shortcut(shortcut: String, app: tauri::AppHandle) -> Result<(), String> {
    let shortcut = shortcut
        .parse::<Shortcut>()
        .map_err(|error| error.to_string())?;
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|error| error.to_string())?;
    manager
        .register(shortcut)
        .map_err(|error| error.to_string())
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
    contributions::views(&state.history, &state.extensions, &clip_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn render_clip_view(
    clip_id: String,
    renderer_id: String,
    source_id: String,
    facet_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<contracts::RenderModel, String> {
    contributions::render(
        &state.history,
        &state.extensions,
        &clip_id,
        &renderer_id,
        &source_id,
        facet_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn retry_clip_ocr(
    app: tauri::AppHandle,
    clip_id: String,
    source_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    artifacts::retry_ocr(&state.history, &clip_id, &source_id)
        .await
        .map_err(|error| error.to_string())?;
    crate::app::workers::wake_ocr(&app, state.history.clone());
    let _ = app.emit(
        "clip-artifacts-updated",
        ArtifactUpdate { clip_id, source_id },
    );
    Ok(())
}

#[tauri::command]
async fn get_ocr_runtime_status(
    state: State<'_, AppState>,
) -> Result<artifacts::OcrRuntimeStatus, String> {
    artifacts::ocr_runtime_status(&state.history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_ocr_settings(
    settings: artifacts::OcrSettings,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<artifacts::OcrRuntimeStatus, String> {
    artifacts::update_ocr_settings(&state.history, &settings)
        .await
        .map_err(|error| error.to_string())?;
    crate::app::workers::wake_ocr(&app, state.history.clone());
    refresh_ocr_dependents(app.clone(), state.history.clone());
    let _ = app.emit("ocr-status-changed", ());
    artifacts::ocr_runtime_status(&state.history)
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn list_renderer_contributions(
    state: State<'_, AppState>,
) -> Result<Vec<contributions::RendererDescriptor>, String> {
    let mut renderers = contributions::renderers();
    if let Ok(mut extensions) = state.extensions.renderer_descriptors(&state.history).await {
        renderers.append(&mut extensions);
    }
    Ok(renderers)
}

#[tauri::command]
fn list_core_utilities() -> Vec<CoreUtility> {
    let mut utilities: Vec<_> = contributions::detector_descriptors()
        .into_iter()
        .map(|item| CoreUtility {
            id: item.id,
            kind: "Detector".into(),
            label: item.display_name,
            version: item.version,
        })
        .collect();
    utilities.extend(
        contributions::renderers()
            .into_iter()
            .map(|item| CoreUtility {
                id: item.id,
                kind: "Renderer".into(),
                label: item.display_name,
                version: item.version,
            }),
    );
    utilities.extend(
        transformers::descriptors()
            .into_iter()
            .map(|item| CoreUtility {
                id: item.id,
                kind: "Transformer".into(),
                label: item.label,
                version: item.version,
            }),
    );
    utilities
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
    state
        .extensions
        .refresh_compact_history(&state.history)
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
    detect_with_extensions(&state.history, &state.extensions, &clip_id)
        .await
        .map_err(|e| e.to_string())?;
    refresh_search_for_clip(&app, &state.history, &clip_id)
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
            detect_with_extensions(&state.history, &state.extensions, &clip.id)
                .await
                .map_err(|e| e.to_string())?;
            refresh_search_for_clip(&app, &state.history, &clip.id)
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

#[tauri::command]
async fn search_clips(
    request: search::SearchRequest,
    state: State<'_, AppState>,
) -> Result<search::SearchPage, String> {
    let settings = search::get_settings(&state.history.pool)
        .await
        .map_err(|e| e.to_string())?;
    search::search(&state.history, &request, &settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn probe_ollama_endpoint(endpoint: String) -> embeddings::OllamaEndpointStatus {
    embeddings::probe_endpoint(endpoint).await
}
#[tauri::command]
async fn list_ollama_models(
    endpoint: String,
) -> Result<Vec<embeddings::OllamaModelDescriptor>, String> {
    embeddings::list_models(endpoint)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn probe_ollama_model(
    endpoint: String,
    model: String,
) -> Result<embeddings::EmbeddingProviderDescriptor, String> {
    embeddings::probe_model(endpoint, model)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn configure_text_embedding_provider(
    app: tauri::AppHandle,
    endpoint: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<embeddings::ProviderStatus, String> {
    let status = embeddings::configure(&state.history, endpoint, model)
        .await
        .map_err(|e| e.to_string())?;
    let mut search_settings = search::get_settings(&state.history.pool)
        .await
        .map_err(|e| e.to_string())?;
    if !search_settings
        .enabled_source_ids
        .iter()
        .any(|id| id == search::SEMANTIC_TEXT_SOURCE_ID)
    {
        search_settings
            .enabled_source_ids
            .push(search::SEMANTIC_TEXT_SOURCE_ID.into());
        search::update_settings(&state.history.pool, &search_settings)
            .await
            .map_err(|e| e.to_string())?;
    }
    wake_embedding_worker(app.clone(), state.history.clone());
    let _ = app.emit("embedding-provider-status-changed", ());
    Ok(status)
}
#[tauri::command]
async fn disable_text_embedding_provider(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::disable(&state.history)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("embedding-provider-status-changed", ());
    Ok(())
}
#[tauri::command]
async fn get_text_embedding_status(
    state: State<'_, AppState>,
) -> Result<embeddings::ProviderStatus, String> {
    embeddings::status(&state.history)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn list_failed_text_embedding_jobs(
    state: State<'_, AppState>,
) -> Result<Vec<embeddings::FailedEmbeddingJob>, String> {
    embeddings::failed_jobs(&state.history, 5)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn configure_text_generation_provider(
    endpoint: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<crate::providers::generation::GenerationProviderStatus, String> {
    crate::providers::generation::configure(&state.history, endpoint, model)
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn disable_text_generation_provider(state: State<'_, AppState>) -> Result<(), String> {
    crate::providers::generation::disable(&state.history)
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn get_text_generation_status(
    state: State<'_, AppState>,
) -> Result<crate::providers::generation::GenerationProviderStatus, String> {
    crate::providers::generation::status(&state.history)
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn reindex_text_embeddings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::reindex(&state.history)
        .await
        .map_err(|e| e.to_string())?;
    wake_embedding_worker(app, state.history.clone());
    Ok(())
}
#[tauri::command]
async fn index_missing_text_embeddings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::index_missing(&state.history)
        .await
        .map_err(|e| e.to_string())?;
    wake_embedding_worker(app, state.history.clone());
    Ok(())
}

#[tauri::command]
async fn retry_text_embedding_provider(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::retry_failed(&state.history)
        .await
        .map_err(|e| e.to_string())?;
    wake_embedding_worker(app, state.history.clone());
    Ok(())
}
#[tauri::command]
async fn clear_text_embedding_space(
    app: tauri::AppHandle,
    space_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::clear_space(&state.history, &space_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("embedding-space-changed", ());
    Ok(())
}

#[tauri::command]
async fn get_search_settings(state: State<'_, AppState>) -> Result<search::SearchSettings, String> {
    search::get_settings(&state.history.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_search_sources(
    state: State<'_, AppState>,
) -> Result<Vec<search::SearchSourceDescriptor>, String> {
    search::list_sources(&state.history)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_search_settings(
    settings: search::SearchSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    search::update_settings(&state.history.pool, &settings)
        .await
        .map_err(|e| e.to_string())
}

fn updater_configured() -> bool {
    option_env!("TAURI_UPDATER_PUBLIC_KEY")
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || serde_json::from_str::<serde_json::Value>(include_str!("../../tauri.conf.json"))
            .ok()
            .and_then(|config| {
                config
                    .get("plugins")?
                    .get("updater")?
                    .get("pubkey")?
                    .as_str()
                    .map(|value| !value.trim().is_empty())
            })
            .unwrap_or(false)
}

fn quit_app(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let should_clear = tauri::async_runtime::block_on(state.history.app_settings())
            .map(|settings| settings.clear_on_exit)
            .unwrap_or(false);
        if should_clear {
            if let Err(error) = tauri::async_runtime::block_on(state.history.clear_history()) {
                eprintln!("[EXIT] Failed to clear clipboard history: {error}");
            }
        }
    }
    app.exit(0);
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = host::show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ));
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_decorum::init());
    builder
}

pub(crate) fn run() {
    app_builder()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = host::toggle_main_window(app);
                    }
                })
                .build(),
        )
        .register_uri_scheme_protocol("clipsx-artifact", |context, request| {
            let id = request.uri().path().trim_start_matches('/');
            let Some(state) = context.app_handle().try_state::<AppState>() else {
                return tauri::http::Response::builder()
                    .status(503)
                    .header("Content-Type", "text/plain")
                    .body(b"application recovery required".to_vec())
                    .unwrap();
            };
            match tauri::async_runtime::block_on(artifacts::artifact_binary(&state.history, id)) {
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
                    .body(b"artifact not found".to_vec())
                    .unwrap(),
            }
        })
        .register_uri_scheme_protocol("clipsx-asset", |context, request| {
            let id = request.uri().path().trim_start_matches('/');
            let Some(state) = context.app_handle().try_state::<AppState>() else {
                return tauri::http::Response::builder()
                    .status(503)
                    .header("Content-Type", "text/plain")
                    .body(b"application recovery required".to_vec())
                    .unwrap();
            };
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
        .register_uri_scheme_protocol("clipsx-extension", |context, request| {
            let path = request.uri().path().trim_start_matches('/');
            let mut parts = path.splitn(2, '/');
            let token = parts.next().unwrap_or_default();
            let asset_path = parts.next().unwrap_or_default();
            let response = context
                .app_handle()
                .try_state::<AppState>()
                .and_then(|state| state.extensions.custom_view_asset(token, asset_path).ok());
            match response {
                Some((bytes, mime)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Cache-Control", "no-store")
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Referrer-Policy", "no-referrer")
                    .header(
                        "Content-Security-Policy",
                        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
                    )
                    .body(bytes)
                    .unwrap(),
                None => tauri::http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain")
                    .header("Cache-Control", "no-store")
                    .body(b"extension asset unavailable".to_vec())
                    .unwrap(),
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

            if let Some(window) = app.get_webview_window("main") {
                window_chrome::configure(&window)?;
            }

            let open_item = MenuItem::with_id(app, "open", "Open Clips", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &settings_item, &quit_item])?;
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        let _ = host::show_main_window(app);
                    }
                    "settings" => {
                        if host::show_main_window(app).is_ok() {
                            let _ = app.emit("open-settings", ());
                        }
                    }
                    "quit" => quit_app(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let _ = host::show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder.build(app)?;
            app.manage(HostState {
                updater_configured: updater_configured(),
                tray_open_item: open_item,
                tray_settings_item: settings_item,
                tray_quit_item: quit_item,
                paste_target: std::sync::Mutex::new(None),
                window_behavior: std::sync::Arc::new(Default::default()),
            });

            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            app.deep_link().register_all()?;
            let deep_link_app = app.handle().clone();
            app.deep_link().on_open_url(move |_| {
                let _ = host::show_main_window(&deep_link_app);
            });

            let roots =
                AppRoots::from_app(app.handle()).expect("Failed to resolve ClipsX storage roots");
            crate::clipboard::capabilities::validate_embedded()
                .context("embedded clipboard capability policy is invalid")?;
            let schema_state = tauri::async_runtime::block_on(foundation::prepare(&roots))
                .expect("Failed to prepare the ClipsX v2 foundation");
            app.manage(StartupState {
                roots: roots.clone(),
                schema_state,
            });
            if schema_state == foundation::SchemaState::Ready {
                let history = tauri::async_runtime::block_on(HistoryRepository::connect(
                    &roots.database(),
                    roots.clipboard_data(),
                ))
                .expect("Failed to open ClipsX history");
                if let Ok(settings) = tauri::async_runtime::block_on(history.app_settings()) {
                    if let Ok(shortcut) = settings.global_shortcut.parse::<Shortcut>() {
                        let _ = app.global_shortcut().register(shortcut);
                    }
                    if let (Some(window), Some(host_state)) =
                        (app.get_webview_window("main"), app.try_state::<HostState>())
                    {
                        host_state
                            .window_behavior
                            .apply_settings(&window, &settings);
                    }
                }
                let extensions = ExtensionService::new(&roots)
                    .expect("Failed to initialize ClipsX extension storage");
                tauri::async_runtime::block_on(contributions::initialize(&history))
                    .expect("Failed to initialize ClipsX facet registry");
                app.manage(AppState {
                    roots: roots.clone(),
                    history: history.clone(),
                    transforms: transformers::TransformService::default(),
                    extensions: extensions.clone(),
                    workers: crate::app::workers::BackgroundWorkers::default(),
                });
                // Materialize the host-owned artifact registry during startup.
                let _ = artifacts::registered_producers();
                let _ = tauri::async_runtime::block_on(crate::providers::provider_capabilities());
                // Rebuild any stale FTS projections from previous sessions.
                let fts_history = history.clone();
                let fts_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = search::rebuild_stale_projections(&fts_history).await;
                    let _ = embeddings::recover_interrupted(&fts_history).await;
                    let _ = embeddings::ensure_current_chunker(&fts_history).await;
                    let _ = artifacts::recover_ocr_queue(&fts_history).await;
                    crate::app::workers::wake_ocr(&fts_app, fts_history.clone());
                    wake_embedding_worker(fts_app.clone(), fts_history.clone());
                    crate::app::workers::wake_managed_files(&fts_app, fts_history);
                });
                let redetect_history = history.clone();
                let redetect_extensions = extensions.clone();
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
                let extension_history = history.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = redetect_extensions
                        .redetect_history(&extension_history)
                        .await;
                });
                let auto_clear_history = history.clone();
                let auto_clear_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
                    loop {
                        interval.tick().await;
                        let Ok(settings) = auto_clear_history.app_settings().await else {
                            continue;
                        };
                        let Some(minutes) = settings.auto_clear_minutes.filter(|value| *value > 0)
                        else {
                            continue;
                        };
                        let cutoff = history::now_ms()
                            .saturating_sub(i64::from(minutes).saturating_mul(60_000));
                        if let Ok(ids) = auto_clear_history.auto_clear_sensitive(cutoff).await {
                            for id in ids {
                                let _ = auto_clear_app.emit("clip-deleted", id);
                            }
                            crate::app::workers::wake_managed_files(
                                &auto_clear_app,
                                auto_clear_history.clone(),
                            );
                        }
                    }
                });
                let monitor_history = history.clone();
                let monitor_extensions = extensions.clone();
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
                        if token == last_token {
                            last_token = token;
                            continue;
                        }
                        last_token = token;
                        if consume_self_write_token(token) {
                            continue;
                        }
                        let mut snapshot = match capture_coherent(&mut adapter) {
                            Ok(value) => value,
                            Err(error) => {
                                let _ = monitor_app.emit("capture-rejected", error.to_string());
                                continue;
                            }
                        };
                        if is_self_write_snapshot(&snapshot) {
                            continue;
                        }
                        let app_settings = match monitor_history.app_settings().await {
                            Ok(value) => value,
                            Err(_) => continue,
                        };
                        if source_is_excluded(&snapshot, &app_settings.excluded_apps) {
                            continue;
                        }
                        apply_capture_filters(&mut snapshot, &app_settings.capture_filters);
                        apply_representation_size_limit(
                            &mut snapshot,
                            app_settings.capture.max_representation_bytes,
                        );
                        if snapshot.representations.is_empty() {
                            continue;
                        }
                        let settings = app_settings.capture;
                        match monitor_history.capture(snapshot, &settings).await {
                            Ok((id, duplicate)) => {
                                crate::app::workers::wake_managed_files(
                                    &monitor_app,
                                    monitor_history.clone(),
                                );
                                let _ = monitor_app.emit(
                                    if duplicate {
                                        "clip-updated"
                                    } else {
                                        "clip-captured"
                                    },
                                    &id,
                                );
                                let detection_history = monitor_history.clone();
                                let detection_extensions = monitor_extensions.clone();
                                let detection_app = monitor_app.clone();
                                tauri::async_runtime::spawn(async move {
                                    match detect_with_extensions(
                                        &detection_history,
                                        &detection_extensions,
                                        &id,
                                    )
                                    .await
                                    {
                                        Ok(_) => {
                                            let _ = detection_app
                                                .emit("clip-facets-updated", id.clone());
                                        }
                                        Err(error) => {
                                            let _ = detection_app
                                                .emit("detection-job-failed", error.to_string());
                                        }
                                    }
                                    let _ =
                                        artifacts::produce_for_clip(&detection_history, &id).await;
                                    emit_clip_artifact_updates(
                                        &detection_app,
                                        &detection_history,
                                        &id,
                                    )
                                    .await;
                                    let _ =
                                        search::upsert_projection(&detection_history, &id).await;
                                    let _ = embeddings::enqueue_clip(&detection_history, &id).await;
                                    crate::app::workers::wake_ocr(
                                        &detection_app,
                                        detection_history.clone(),
                                    );
                                    wake_embedding_worker(detection_app, detection_history);
                                });
                            }
                            Err(error) => {
                                let _ = monitor_app.emit("capture-rejected", error.to_string());
                            }
                        }
                    }
                });
            }
            if !std::env::args().any(|argument| argument == "--hidden") {
                let _ = host::show_main_window(app.handle());
            }
            Ok(())
        })
        .invoke_handler(route_webview_invokes(tauri::generate_handler![
            show_main_window_command,
            set_tray_labels,
            get_release_info,
            start_local_auth_callback_listener,
            get_startup_status,
            auth_storage_get,
            auth_storage_set,
            auth_storage_remove,
            list_extensions,
            get_extension_registry,
            get_extension_catalog,
            get_extension_package_detail,
            check_extension_updates,
            get_extension_auto_updates_enabled,
            set_extension_auto_updates_enabled,
            set_extension_update_preference,
            refresh_extension_registry,
            install_registry_extension,
            install_local_extension,
            inspect_local_extension,
            set_extension_enabled,
            recover_extension,
            uninstall_extension,
            get_extension_developer_mode,
            set_extension_developer_mode,
            factory_reset,
            restart_app,
            open_external_url,
            compose_email,
            start_phone_action,
            open_clip_file,
            get_clip_file_preview,
            open_detected_path,
            open_clip_text_in_editor,
            list_clips,
            get_clip_detail,
            capture_clipboard,
            list_transformer_contributions,
            create_transform_preview,
            list_context_actions,
            list_extension_actions,
            run_context_action,
            grant_extension_action_permissions,
            issue_extension_action_invocation,
            grant_extension_transformer_permissions,
            issue_extension_transformer_invocation,
            get_extension_package_settings,
            set_extension_package_setting,
            get_extension_credential_status,
            set_extension_credential,
            open_extension_custom_view,
            close_extension_custom_view,
            sync_extension_custom_view,
            set_extension_action_pinned,
            set_extension_action_shortcut,
            execute_clipboard_output,
            save_transform_result,
            get_transform_preferences,
            update_transform_preferences,
            delete_clip,
            clear_history,
            set_clip_pinned,
            set_clip_favorite,
            update_clip_note,
            list_tags,
            create_tag,
            delete_tag,
            add_clip_tag,
            remove_clip_tag,
            get_capture_settings,
            get_app_settings,
            update_app_settings,
            get_sync_status,
            set_sync_enabled,
            prepare_sync_batch,
            apply_sync_response,
            record_sync_error,
            register_global_shortcut,
            update_capture_settings,
            get_clip_views,
            render_clip_view,
            retry_clip_ocr,
            get_ocr_runtime_status,
            update_ocr_settings,
            list_renderer_contributions,
            list_core_utilities,
            get_renderer_preferences,
            update_renderer_preferences,
            redetect_clip,
            redetect_history,
            search_clips,
            get_search_settings,
            update_search_settings,
            list_search_sources,
            probe_ollama_endpoint,
            list_ollama_models,
            probe_ollama_model,
            configure_text_embedding_provider,
            disable_text_embedding_provider,
            get_text_embedding_status,
            list_failed_text_embedding_jobs,
            configure_text_generation_provider,
            disable_text_generation_provider,
            get_text_generation_status,
            retry_text_embedding_provider,
            reindex_text_embeddings,
            index_missing_text_embeddings,
            clear_text_embedding_space
        ], tauri::generate_handler![extension_bridge]))
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let Some(host_state) = window.app_handle().try_state::<HostState>() {
                match event {
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                        host_state.window_behavior.mark_native_interaction();
                    }
                    tauri::WindowEvent::Focused(true) => {
                        host_state.window_behavior.mark_focused();
                    }
                    tauri::WindowEvent::Focused(false) => {
                        host_state
                            .window_behavior
                            .schedule_blur_hide(window.clone());
                    }
                    _ => {}
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ClipsX");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeSet, fs, path::Path};

    fn collect_frontend_sources(path: &Path, output: &mut Vec<String>) {
        for entry in fs::read_dir(path).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                collect_frontend_sources(&path, output);
                continue;
            }
            let name = path.file_name().unwrap().to_string_lossy();
            if name.contains(".test.") || name.contains(".spec.") {
                continue;
            }
            if matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("ts" | "tsx")
            ) {
                output.push(fs::read_to_string(path).unwrap());
            }
        }
    }

    fn literal_invocations(source: &str) -> Vec<String> {
        let mut commands = Vec::new();
        let mut remainder = source;
        while let Some(index) = remainder.find("invoke") {
            remainder = &remainder[index + "invoke".len()..];
            let Some(open) = remainder.find('(') else {
                break;
            };
            if remainder[..open].contains(['\n', ';']) {
                continue;
            }
            let arguments = remainder[open + 1..].trim_start();
            let Some(quote) = arguments
                .chars()
                .next()
                .filter(|value| matches!(value, '\'' | '"'))
            else {
                continue;
            };
            let quoted = &arguments[quote.len_utf8()..];
            if let Some(end) = quoted.find(quote) {
                commands.push(quoted[..end].to_string());
            }
            remainder = arguments;
        }
        commands
    }

    #[test]
    fn action_shortcut_normalization_is_order_and_case_insensitive() {
        assert_eq!(
            normalized_accelerator("Ctrl+Shift+O"),
            normalized_accelerator(" shift + CTRL + o ")
        );
    }

    #[test]
    fn every_frontend_invoke_has_a_registered_handler() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut sources = Vec::new();
        collect_frontend_sources(&manifest.join("../src"), &mut sources);
        let invoked = sources
            .iter()
            .flat_map(|source| literal_invocations(source))
            .collect::<BTreeSet<_>>();
        let ipc_source = include_str!("mod.rs");
        let handler = ipc_source
            .split_once(".invoke_handler(route_webview_invokes(tauri::generate_handler![")
            .and_then(|(_, value)| value.split_once("])"))
            .map(|(value, _)| value)
            .expect("invoke handler block must be present");
        let registered = handler
            .split(|value: char| !(value.is_ascii_alphanumeric() || value == '_'))
            .filter(|value| !value.is_empty())
            .collect::<BTreeSet<_>>();
        let registered_plugin_commands = BTreeSet::from(["plugin:decorum|show_snap_overlay"]);
        let missing = invoked
            .iter()
            .filter(|command| {
                !registered.contains(command.as_str())
                    && !registered_plugin_commands.contains(command.as_str())
            })
            .cloned()
            .collect::<Vec<_>>();
        assert!(
            missing.is_empty(),
            "frontend invokes commands missing from generate_handler!: {missing:?}"
        );
    }

    #[test]
    fn extension_child_labels_are_reserved_from_application_commands() {
        assert!(is_extension_webview_label("extension-0198"));
        assert!(!is_extension_webview_label("main"));
        let source = include_str!("mod.rs");
        assert!(source.contains(".on_download(|_, _| false)"));
        assert!(source.contains("child.hide()"));
        assert!(source.contains(".focused(false)"));
        assert!(source.contains(".initialization_script(initialization_script)"));
        assert!(source.contains("BridgeOutcome::ViewReady"));
        assert!(source.contains("], tauri::generate_handler![extension_bridge]))"));

        let capability: serde_json::Value = serde_json::from_str(include_str!(
            "../../capabilities/extension-custom-views.json"
        ))
        .unwrap();
        assert_eq!(capability["webviews"], serde_json::json!(["extension-*"]));
        assert_eq!(capability["local"], serde_json::json!(true));
        assert!(capability.get("remote").is_none());
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["allow-extension-bridge"])
        );

        let token = "session-token";
        assert!(is_extension_asset_navigation(
            &url::Url::parse("clipsx-extension://localhost/session-token/ui/index.html").unwrap(),
            token
        ));
        assert!(is_extension_asset_navigation(
            &url::Url::parse("http://clipsx-extension.localhost/session-token/ui/index.html")
                .unwrap(),
            token
        ));
        assert!(is_extension_bridge_close_navigation(
            &url::Url::parse("clipsx-extension-bridge://session-token/close").unwrap(),
            token
        ));
        assert!(is_extension_bridge_close_navigation(
            &url::Url::parse("http://clipsx-extension-bridge.localhost/session-token/close")
                .unwrap(),
            token
        ));
        assert!(!is_extension_asset_navigation(
            &url::Url::parse("http://clipsx-extension.localhost/other-token/ui/index.html")
                .unwrap(),
            token
        ));

        let main_capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        assert!(main_capability["permissions"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("main-app-commands")));
        let main_permissions = include_str!("../../permissions/main-app-commands.toml");
        assert!(main_permissions.contains("\"allow-get-ocr-runtime-status\""));
        assert!(main_permissions.contains("\"allow-update-ocr-settings\""));
    }

    #[test]
    fn frontend_clipboard_output_cannot_bypass_the_unified_bridge() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut sources = Vec::new();
        collect_frontend_sources(&manifest.join("../src"), &mut sources);
        let frontend = sources.join("\n");

        assert!(
            !frontend.contains("navigator.clipboard.writeText"),
            "desktop clipboard writes must be owned by the Rust output boundary"
        );
        for retired in [
            "copy_clip_output",
            "paste_clip_output",
            "copy_text_value",
            "copy_clip_original",
        ] {
            assert!(
                !frontend.contains(retired),
                "frontend still references retired clipboard command {retired}"
            );
        }
    }

    #[test]
    fn main_window_config_preserves_native_rounded_translucent_chrome() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];

        assert_eq!(window["label"], "main");
        assert_eq!(window["transparent"], true);
        assert_eq!(window["shadow"], true);
        assert_eq!(
            window["windowEffects"]["effects"],
            serde_json::json!(["acrylic", "underWindowBackground"])
        );
    }

    #[test]
    fn windows_snap_layout_is_scoped_to_the_main_webview() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(config["app"]["withGlobalTauri"], false);

        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/windows.json")).unwrap();
        assert_eq!(capability["webviews"], serde_json::json!(["main"]));
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["decorum:allow-show-snap-overlay"])
        );
    }

    #[test]
    fn local_auth_callback_accepts_only_the_owned_get_path() {
        let accepted = parse_local_auth_callback_request_line(
            "GET /auth/desktop/callback?code=abc HTTP/1.1",
            43123,
        )
        .unwrap();
        assert_eq!(
            accepted.as_deref(),
            Some("http://127.0.0.1:43123/auth/desktop/callback?code=abc")
        );
        assert_eq!(
            parse_local_auth_callback_request_line("GET /other HTTP/1.1", 43123).unwrap(),
            None
        );
        assert_eq!(
            parse_local_auth_callback_request_line("POST /auth/desktop/callback HTTP/1.1", 43123)
                .unwrap(),
            None
        );
    }
}
