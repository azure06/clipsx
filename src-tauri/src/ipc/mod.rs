//! Stable Tauri command surface and desktop runtime wiring.

use crate::app::state::AppState;
use crate::clipboard::contract::ClipboardAdapter;
use crate::clipboard::{capture_coherent, is_self_write_snapshot, SystemClipboardAdapter};
use crate::contracts::{self, FactoryResetResult, StartupStatus};
use crate::contributions::transformer as transformers;
use crate::extensions::ExtensionService;
use crate::foundation::AppRoots;
use crate::history::{CaptureSettings, HistoryRepository, ListRequest};
use crate::search::semantic as embeddings;
use crate::{artifacts, contributions, foundation, history, output::paste, search};
use tauri::{Emitter, Manager, State};

async fn detect_with_extensions(
    history: &HistoryRepository,
    extensions: &ExtensionService,
    clip_id: &str,
) -> anyhow::Result<()> {
    contributions::detect_clip(history, clip_id).await?;
    extensions.detect_clip(history, clip_id).await?;
    Ok(())
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
    let installed = state
        .extensions
        .install_registry(&state.history, &package_id, &version)
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
    let installed = state
        .extensions
        .install_local(&state.history, std::path::Path::new(&path))
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-catalog-updated", ());
    Ok(installed)
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
    state
        .extensions
        .uninstall(&state.history, &package_id)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("extension-catalog-updated", ());
    Ok(())
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
    let settings = state.history.settings().await.map_err(|e| e.to_string())?;
    let mut adapter = SystemClipboardAdapter::new();
    let snapshot = capture_coherent(&mut adapter).map_err(|e| e.to_string())?;
    match state.history.capture(snapshot, &settings).await {
        Ok((id, duplicate)) => {
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
            tauri::async_runtime::spawn(async move {
                let _ = artifacts::produce_for_clip(&history_for_artifacts, &artifact_id).await;
                let _ = search::upsert_projection(&history_for_artifacts, &artifact_id).await;
                let _ = embeddings::enqueue_clip(&history_for_artifacts, &artifact_id).await;
                let _ = embeddings::index_pending(&history_for_artifacts).await;
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
    copy_policy(transformers::OutputPolicy::Original { clip_id }, &state)
        .await
        .map_err(|e| e.to_string())
}

async fn policy_output(
    policy: &transformers::OutputPolicy,
    state: &AppState,
) -> anyhow::Result<(Vec<history::CapturedRepresentation>, Option<String>)> {
    match policy {
        transformers::OutputPolicy::Original { clip_id } => Ok((
            state.history.reconstruction(clip_id).await?,
            Some(clip_id.clone()),
        )),
        transformers::OutputPolicy::PlainText { clip_id } => Ok((
            state.history.plain_text_reconstruction(clip_id).await?,
            Some(clip_id.clone()),
        )),
        transformers::OutputPolicy::Transformed { result_id } => {
            let (_, source_clip_id, _) = state.transforms.saved_metadata(result_id)?;
            Ok((
                state.transforms.transformed(result_id)?,
                Some(source_clip_id),
            ))
        }
    }
}

async fn copy_policy(policy: transformers::OutputPolicy, state: &AppState) -> anyhow::Result<()> {
    let (representations, source_clip) = policy_output(&policy, state).await?;
    SystemClipboardAdapter::new().write(&representations)?;
    if let Some(id) = source_clip {
        state.history.touch(&id).await?;
    }
    Ok(())
}

#[tauri::command]
async fn list_transformer_contributions(
    clip_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<transformers::TransformerDescriptor>, String> {
    let mut descriptors = state
        .transforms
        .list(&state.history, &clip_id)
        .await
        .map_err(|error| error.to_string())?;
    let detail = state
        .history
        .detail(&clip_id)
        .await
        .map_err(|error| error.to_string())?;
    for representation in detail.representations {
        let (source, _) = state
            .history
            .source_representation(&clip_id, &representation.id)
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
    }
    Ok(descriptors)
}

#[tauri::command]
async fn create_transform_preview(
    clip_id: String,
    transformer_id: String,
    source_id: String,
    parameters: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<transformers::TransformPreview, String> {
    let (source, _) = state
        .history
        .source_representation(&clip_id, &source_id)
        .await
        .map_err(|error| error.to_string())?;
    if let Some((version, outputs)) = state
        .extensions
        .transform(&state.history, &transformer_id, source, parameters.clone())
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
async fn copy_clip_output(
    policy: transformers::OutputPolicy,
    state: State<'_, AppState>,
) -> Result<(), String> {
    copy_policy(policy, &state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn paste_clip_output(
    app: tauri::AppHandle,
    policy: transformers::OutputPolicy,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Err(error) = copy_policy(policy, &state).await {
        let message = error.to_string();
        let _ = app.emit("paste-failed", &message);
        return Err(message);
    }
    // Capture focus before hiding so we know which application to restore.
    let focus_target = paste::capture_focus();
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.hide() {
            let message = error.to_string();
            let _ = app.emit("paste-failed", &message);
            return Err(message);
        }
    }
    // Keep the focus target on this thread: Windows HWND handles are not Send.
    std::thread::sleep(std::time::Duration::from_millis(150));
    if let Err(error) = paste::simulate_paste(focus_target) {
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
    let (preview, source_clip_id, parameter_sha256) = state
        .transforms
        .saved_metadata(&result_id)
        .map_err(|error| error.to_string())?;
    let snapshot = history::CapturedSnapshot {
        token: 0,
        source_app_name: Some("ClipsX".into()),
        source_app_id: Some("clipsx.transform".into()),
        representations: state
            .transforms
            .transformed(&result_id)
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
    detect_with_extensions(&state.history, &state.extensions, &clip_id)
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
    let history = state.history.clone();
    let event_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match embeddings::index_pending(&history).await {
                Ok(0) => break,
                Ok(_) => {
                    let _ = event_app.emit("embedding-index-progress", ());
                }
                Err(error) => {
                    let _ = event_app.emit("embedding-index-failed", error.to_string());
                    break;
                }
            }
        }
        let _ = event_app.emit("embedding-space-changed", ());
    });
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
async fn reindex_text_embeddings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::reindex(&state.history)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("embedding-index-progress", ());
    Ok(())
}
#[tauri::command]
async fn clear_text_embedding_space(
    space_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    embeddings::clear_space(&state.history, &space_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_search_settings(state: State<'_, AppState>) -> Result<search::SearchSettings, String> {
    search::get_settings(&state.history.pool)
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

pub(crate) fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("clipsx-artifact", |context, request| {
            let id = request.uri().path().trim_start_matches('/');
            let state = context.app_handle().state::<AppState>();
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
            if schema_state != foundation::SchemaState::Ready {
                let status = foundation::startup_status(schema_state);
                return Err(std::io::Error::new(std::io::ErrorKind::Other, status.message).into());
            }
            let history = tauri::async_runtime::block_on(HistoryRepository::connect(
                &roots.database(),
                roots.clipboard_data(),
            ))
            .expect("Failed to open ClipsX history");
            let extensions = ExtensionService::new(&roots)
                .expect("Failed to initialize ClipsX extension storage");
            tauri::async_runtime::block_on(contributions::initialize(&history))
                .expect("Failed to initialize ClipsX facet registry");
            // Materialize the host-owned artifact registry during startup.
            let _ = artifacts::registered_producers();
            let _ = crate::providers::provider_capabilities();
            // Rebuild any stale FTS projections from previous sessions.
            let fts_history = history.clone();
            tauri::async_runtime::spawn(async move {
                let _ = search::rebuild_stale_projections(&fts_history).await;
                let _ = embeddings::index_pending(&fts_history).await;
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
                    let snapshot = match capture_coherent(&mut adapter) {
                        Ok(value) => value,
                        Err(error) => {
                            let _ = monitor_app.emit("capture-rejected", error.to_string());
                            continue;
                        }
                    };
                    if is_self_write_snapshot(&snapshot) {
                        continue;
                    }
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
                                        let _ =
                                            detection_app.emit("clip-facets-updated", id.clone());
                                    }
                                    Err(error) => {
                                        let _ = detection_app
                                            .emit("detection-job-failed", error.to_string());
                                    }
                                }
                                let _ = artifacts::produce_for_clip(&detection_history, &id).await;
                                let _ = search::upsert_projection(&detection_history, &id).await;
                                let _ = embeddings::enqueue_clip(&detection_history, &id).await;
                                let _ = embeddings::index_pending(&detection_history).await;
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
                transforms: transformers::TransformService::default(),
                extensions,
            });
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_status,
            list_extensions,
            get_extension_registry,
            refresh_extension_registry,
            install_registry_extension,
            install_local_extension,
            set_extension_enabled,
            recover_extension,
            uninstall_extension,
            get_extension_developer_mode,
            set_extension_developer_mode,
            factory_reset,
            restart_app,
            list_clips,
            get_clip_detail,
            capture_clipboard,
            copy_clip_original,
            list_transformer_contributions,
            create_transform_preview,
            copy_clip_output,
            paste_clip_output,
            save_transform_result,
            get_transform_preferences,
            update_transform_preferences,
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
            redetect_history,
            search_clips,
            get_search_settings,
            update_search_settings,
            probe_ollama_endpoint,
            list_ollama_models,
            probe_ollama_model,
            configure_text_embedding_provider,
            disable_text_embedding_provider,
            get_text_embedding_status,
            reindex_text_embeddings,
            clear_text_embedding_space
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipsX");
}
