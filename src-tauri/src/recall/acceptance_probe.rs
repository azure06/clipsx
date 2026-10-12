//! Opt-in native acceptance runner: isolated storage, synthetic clips, no capture or telemetry.
use super::{configuration, contracts::*, service::ClipboardService};
use crate::{app::state::AppState, foundation::AppRoots, history::*};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::State;

struct Probe {
    root: PathBuf,
    phase: String,
    fixture: Value,
}

#[tauri::command]
fn acceptance_probe_info(
    webview: tauri::Webview,
    probe: State<'_, Probe>,
) -> Result<Value, &'static str> {
    if webview.label() != "main" {
        return Err("access_denied");
    }
    Ok(json!({"phase":probe.phase,"fixture":probe.fixture}))
}

#[tauri::command]
async fn acceptance_probe_finish(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    probe: State<'_, Probe>,
    state: State<'_, AppState>,
    mut report: Value,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("access_denied".into());
    }
    if probe.phase == "first" && report["passed"] == true {
        let provenance: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assistant_clip_provenance p WHERE p.clip_id=? AND p.origin='native_assistant' AND p.attribution_source='host_verified' AND EXISTS(SELECT 1 FROM json_each(p.sources_json) WHERE json_extract(value,'$.clipId')=?)) AND (SELECT COUNT(*) FROM assistant_clip_provenance)=1")
            .bind(report["generatedClipId"].as_str().unwrap_or_default())
            .bind(probe.fixture["sourceId"].as_str().unwrap())
            .fetch_one(&state.history.pool).await.map_err(|_| "provenance_check_failed")?;
        if provenance {
            state
                .history
                .delete(probe.fixture["sourceId"].as_str().unwrap())
                .await
                .map_err(|_| "source_cleanup_failed")?;
        } else {
            report = json!({"passed":false,"failure":"generated_provenance_mismatch"});
        }
    }
    std::fs::write(
        probe.root.join(format!("{}.json", probe.phase)),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .map_err(|_| "report_failed")?;
    app.exit(if report["passed"] == true { 0 } else { 1 });
    Ok(())
}

async fn capture(
    repo: &HistoryRepository,
    payload: CapturedPayload,
    mime: &str,
    token: u64,
) -> Result<String> {
    let (id, _) = repo
        .capture(
            CapturedSnapshot {
                token,
                source_app_id: Some("clipsx.acceptance".into()),
                source_app_name: Some("Acceptance fixture".into()),
                format_observations: vec![],
                representations: vec![CapturedRepresentation {
                    format_key: mime.into(),
                    canonical_mime_type: Some(mime.into()),
                    native_type: None,
                    platform: std::env::consts::OS.into(),
                    capture_priority: 0,
                    payload,
                }],
            },
            &CaptureSettings::default(),
        )
        .await?;
    crate::search::upsert_projection(repo, &id).await?;
    Ok(id)
}

pub fn run(root: PathBuf, phase: String, model: String) -> Result<()> {
    if !["first", "restart"].contains(&phase.as_str()) {
        anyhow::bail!("invalid_probe_phase")
    }
    if std::fs::read(root.join("probe.marker"))? != b"ClipsX isolated Recall acceptance\n" {
        anyhow::bail!("invalid_probe_root")
    }
    let roots = AppRoots {
        data: root.join("data"),
        config: root.join("config"),
    };
    let (history, fixture) = tauri::async_runtime::block_on(async {
        anyhow::ensure!(
            crate::foundation::prepare(&roots).await? == crate::foundation::SchemaState::Ready,
            "probe_schema_unavailable"
        );
        let history = HistoryRepository::connect(&roots.database(), roots.clipboard_data()).await?;
        configuration::migrate_legacy(&history).await?;
        super::conversations::recover(&history).await?;
        let fixture = if phase == "first" {
            let connection = AiConnection {
                id: new_id(),
                name: "Local acceptance".into(),
                provider: AiProviderKind::Ollama,
                base_url: "http://127.0.0.1:11434".into(),
                enabled: true,
                options: AiConnectionOptions {
                    organization: None,
                    project: None,
                },
            };
            let preset = AiModelPreset {
                id: new_id(),
                name: "Native acceptance".into(),
                connection_id: connection.id.clone(),
                model_id: model,
                purpose: AiModelPurpose::Chat,
                context_limit: 32768,
                output_limit: 4096,
                options: configuration::default_options(),
                capabilities: configuration::unknown_capabilities(),
            };
            configuration::import(
                &history,
                AiConfiguration {
                    version: 1,
                    connections: vec![connection],
                    presets: vec![preset.clone()],
                    selections: AiSelections {
                        default_chat: Some(preset.id.clone()),
                        active_embedding: None,
                        web_search: None,
                        ..AiSelections::default()
                    },
                },
            )
            .await?;
            let source = capture(
                &history,
                CapturedPayload::Text(
                    "native acceptance evidence: launch code is ORCHID-42.".into(),
                ),
                "text/plain",
                1,
            )
            .await?;
            let mut image = std::io::Cursor::new(Vec::new());
            image::DynamicImage::new_rgb8(2, 2).write_to(&mut image, image::ImageFormat::Png)?;
            let image_id = capture(
                &history,
                CapturedPayload::Binary(image.into_inner()),
                "image/png",
                2,
            )
            .await?;
            let metadata = ClipboardService::new(history.clone())
                .metadata(&image_id)
                .await?;
            let fixture = json!({"presetId":preset.id,"sourceId":source,"imageId":image_id,"imageRepresentationId":metadata.representations[0].id});
            std::fs::write(root.join("fixture.json"), serde_json::to_vec(&fixture)?)?;
            fixture
        } else {
            serde_json::from_slice(&std::fs::read(root.join("fixture.json"))?)?
        };
        Ok::<_, anyhow::Error>((history, fixture))
    })?;
    let extensions =
        crate::extensions::ExtensionService::new(&roots, &root.join("extension-cache"))?;
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(super::transport::Transport::default())
        .manage(super::agent::AgentRuntime::default())
        .manage(AppState {
            roots,
            history,
            extensions,
            workers: Default::default(),
        })
        .manage(Probe {
            root,
            phase,
            fixture,
        })
        .invoke_handler(tauri::generate_handler![
            acceptance_probe_info,
            acceptance_probe_finish,
            super::ipc::assistant_run_begin,
            super::ipc::assistant_model_options,
            super::ipc::assistant_run_finish,
            super::ipc::assistant_run_tool,
            super::ipc::assistant_verify_tools,
            super::ipc::assistant_search_clips,
            super::ipc::assistant_read_clip,
            super::ipc::recall_thread_initialize,
            super::ipc::recall_thread_list,
            super::ipc::recall_thread_load,
            super::ipc::recall_thread_update,
            super::ipc::recall_thread_delete,
            super::ipc::recall_message_append,
            super::ipc::recall_run_start,
            super::ipc::recall_run_checkpoint,
            super::ipc::recall_snapshot_image,
            super::transport::ai_http_start,
            super::transport::ai_http_acknowledge,
            super::transport::ai_http_cancel
        ])
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("recall-acceptance-gate.html".into()),
            )
            .visible(false)
            .build()
            .context("probe_webview_failed")?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                handle.exit(2);
            });
            Ok(())
        })
        .run(context)?;
    Ok(())
}
