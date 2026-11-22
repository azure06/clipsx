use super::{configuration, contracts::AiModelPurpose};
use crate::{
    failure::FailureCode,
    history::HistoryRepository,
    providers::{
        error::ProviderError,
        ollama::{client::OllamaClient, setup},
    },
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

static SETUP: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    runtime: Runtime,
    installed_models: Vec<String>,
    starting_chat: Option<&'static str>,
    candidates: &'static [setup::Candidate],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum Runtime {
    Running,
    Stopped,
    Missing,
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalPlan {
    chat: Option<String>,
    embedding: Option<String>,
    decision: Option<String>,
    privacy: bool,
}

impl LocalPlan {
    fn candidates(&self, downloads: &[String]) -> Result<Vec<setup::Candidate>> {
        let mut models = Vec::new();
        for (purpose, id) in [
            (AiModelPurpose::Chat, &self.chat),
            (AiModelPurpose::Embedding, &self.embedding),
            (AiModelPurpose::Decision, &self.decision),
        ] {
            if let Some(id) = id {
                let model = setup::CANDIDATES
                    .iter()
                    .find(|model| model.id == id && model.purpose == purpose)
                    .ok_or(ProviderError::ModelUnavailable)?;
                models.push(*model);
            }
        }
        if (self.privacy && self.decision.is_none())
            || downloads.len() > models.len()
            || downloads
                .iter()
                .any(|id| !models.iter().any(|m| m.id == id))
        {
            return Err(FailureCode::InvalidInput.failure().into());
        }
        Ok(models)
    }
}

pub async fn probe(repo: &HistoryRepository) -> Result<LocalStatus> {
    let client = OllamaClient::new(setup::ENDPOINT)?;
    let (runtime, installed_models) = match client
        .get_bounded("api/version", Duration::from_secs(2), 4096)
        .await
    {
        Ok(value) if value["version"].is_string() => {
            (Runtime::Running, setup::installed(&client).await?)
        }
        Err(ProviderError::Unavailable(_) | ProviderError::Timeout) => (
            if installed_path().is_some() {
                Runtime::Stopped
            } else {
                Runtime::Missing
            },
            Vec::new(),
        ),
        Ok(_) => return Err(FailureCode::InvalidResponse.failure().into()),
        Err(error) => return Err(error.into()),
    };
    let config = configuration::export(repo).await?;
    let has_chat = config.presets.iter().any(|preset| {
        Some(&preset.id) == config.selections.default_chat.as_ref()
            && config
                .connections
                .iter()
                .any(|c| c.id == preset.connection_id && c.enabled)
    });
    Ok(LocalStatus {
        runtime,
        installed_models,
        starting_chat: (!has_chat).then(|| starting_chat(memory_bytes())),
        candidates: setup::CANDIDATES,
    })
}

fn starting_chat(ram: Option<u64>) -> &'static str {
    if ram.is_some_and(|bytes| bytes >= 15 * 1024 * 1024 * 1024) {
        setup::BALANCED_CHAT
    } else {
        setup::SMALL_CHAT
    }
}

pub fn open() -> Result<()> {
    let path = installed_path().ok_or_else(|| FailureCode::ConnectionUnavailable.failure())?;
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/usr/bin/open");
        command.arg(path);
        command
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = Command::new(path);
    #[cfg(target_os = "linux")]
    command.arg("serve");
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| FailureCode::ConnectionUnavailable.failure())?;
    // Reap the launcher or daemon after it exits. The app does not own its lifetime.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

pub async fn finish(
    repo: &HistoryRepository,
    plan: LocalPlan,
    downloads: Vec<String>,
    progress: impl Fn(setup::Progress) + Sync,
) -> Result<LocalPlan> {
    let models = plan.candidates(&downloads)?;
    if models.is_empty() {
        return Ok(plan);
    }
    let _guard = SETUP
        .try_lock()
        .map_err(|_| FailureCode::ResourceLimit.failure())?;
    let client = OllamaClient::new(setup::ENDPOINT)?;
    apply(repo, &client, &plan, models, &downloads, &progress).await?;
    Ok(plan)
}

async fn apply(
    repo: &HistoryRepository,
    client: &OllamaClient,
    plan: &LocalPlan,
    models: Vec<setup::Candidate>,
    downloads: &[String],
    progress: &(impl Fn(setup::Progress) + Sync),
) -> Result<()> {
    let mut prepared = Vec::with_capacity(models.len());
    for model in models {
        progress(setup::Progress {
            stage: setup::Stage::Verifying,
            downloaded_bytes: 0,
            model: Some(model.id),
        });
        let download = downloads.iter().any(|id| id == model.id);
        let capabilities = setup::prepare(client, model, download, progress).await?;
        prepared.push((model, capabilities));
    }
    configuration::save_local_models(
        repo,
        client.endpoint().as_str(),
        prepared,
        plan.privacy,
        progress,
    )
    .await
}

#[cfg(target_os = "windows")]
fn installed_path() -> Option<PathBuf> {
    let path =
        PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(r"Programs\Ollama\ollama app.exe");
    path.is_file().then_some(path)
}

#[cfg(target_os = "macos")]
fn installed_path() -> Option<PathBuf> {
    [
        Some(PathBuf::from("/Applications/Ollama.app")),
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Applications/Ollama.app")),
    ]
    .into_iter()
    .flatten()
    .find(|path| path.join("Contents/MacOS").is_dir())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn installed_path() -> Option<PathBuf> {
    ["/usr/local/bin/ollama", "/usr/bin/ollama"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn memory_bytes() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // The API fills this initialized structure and uses dwLength to validate its layout.
    unsafe { GlobalMemoryStatusEx(&mut status).ok()? };
    Some(status.ullTotalPhys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Bytes,
        extract::State,
        routing::{get, post},
        Router,
    };
    use serde_json::{json, Value};
    use std::sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    };

    #[test]
    fn local_setup_defaults_to_the_smaller_download_when_memory_is_unknown_or_low() {
        assert_eq!(starting_chat(None), setup::SMALL_CHAT);
        assert_eq!(starting_chat(Some(8 << 30)), setup::SMALL_CHAT);
        assert_eq!(starting_chat(Some(16 << 30)), setup::BALANCED_CHAT);
    }

    #[test]
    fn local_setup_rejects_models_outside_the_catalog_or_selected_role() {
        for id in ["custom:latest", "embeddinggemma:latest"] {
            let plan = LocalPlan {
                chat: Some(id.into()),
                ..LocalPlan::default()
            };
            assert!(plan.candidates(&[id.into()]).is_err());
        }
        assert!(LocalPlan::default()
            .candidates(&[setup::SMALL_CHAT.into()])
            .is_err());
        let plan = LocalPlan {
            privacy: true,
            ..LocalPlan::default()
        };
        assert!(plan.candidates(&[]).is_err());
    }

    #[tokio::test]
    async fn local_setup_applies_only_selected_roles_after_every_check_passes() {
        const EMBEDDING: &str = "embeddinggemma:latest";
        const DECISION: &str = "d1:3b";
        let embedding_revision = Arc::new(AtomicU8::new(0));
        let server = Router::new()
            .route(
                "/api/tags",
                get(|State(revision): State<Arc<AtomicU8>>| async move {
                    json!({"models": [
                        {"name": EMBEDDING, "digest": format!("embedding-digest-{}", revision.load(Ordering::Relaxed))},
                        {"name": DECISION, "digest": "decision-digest"}
                    ]})
                    .to_string()
                }),
            )
            .route(
                "/api/show",
                post(|body: Bytes| async move {
                    let value: Value = serde_json::from_slice(&body).unwrap();
                    let capability = if value["model"] == EMBEDDING {
                        "embedding"
                    } else {
                        "decision"
                    };
                    json!({"capabilities": [capability]}).to_string()
                }),
            )
            .route(
                "/api/embed",
                post(
                    |State(revision): State<Arc<AtomicU8>>, body: Bytes| async move {
                        let body: Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(body["input"][0], "clipsx embedding capability probe");
                        if revision.load(Ordering::Relaxed) > 0 {
                            json!({"embeddings": [[1.0, 0.0, 0.0]]})
                        } else {
                            json!({"embeddings": []})
                        }
                        .to_string()
                    },
                ),
            )
            .route(
                "/v1/systemone",
                post(|body: Bytes| async move {
                    let body: Value = serde_json::from_slice(&body).unwrap();
                    assert_eq!(
                        body["state"]["clipboard_text"],
                        "A meeting is scheduled for Tuesday at 10 AM."
                    );
                    assert_eq!(body["questions"]["sample"]["type"], "noul");
                    json!({"answers": {"sample": {"type": "noul", "noul": 0.9}}}).to_string()
                }),
            )
            .with_state(Arc::clone(&embedding_revision));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client =
            OllamaClient::new(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, server).await.unwrap() });
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let chat = *setup::CANDIDATES
            .iter()
            .find(|model| model.id == setup::SMALL_CHAT)
            .unwrap();
        configuration::save_local_models(
            &repo,
            client.endpoint().as_str(),
            vec![(chat, configuration::unknown_capabilities())],
            false,
            &|_| {},
        )
        .await
        .unwrap();
        let before = configuration::export(&repo).await.unwrap();
        let mut plan = LocalPlan {
            embedding: Some(EMBEDDING.into()),
            decision: Some(DECISION.into()),
            ..LocalPlan::default()
        };
        let models = plan.candidates(&[]).unwrap();
        assert!(apply(&repo, &client, &plan, models.clone(), &[], &|_| {})
            .await
            .is_err());
        let after_failure = configuration::export(&repo).await.unwrap();
        assert_eq!(after_failure.presets.len(), 1);
        assert!(after_failure.selections.active_embedding.is_none());
        assert!(after_failure.selections.default_decision.is_none());

        embedding_revision.store(1, Ordering::Relaxed);
        apply(&repo, &client, &plan, models.clone(), &[], &|_| {})
            .await
            .unwrap();
        assert!(configuration::export(&repo)
            .await
            .unwrap()
            .selections
            .privacy_decision
            .is_none());
        let previous_space = crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .pending_space_id
            .unwrap();
        embedding_revision.store(2, Ordering::Relaxed);
        plan.privacy = true;
        apply(&repo, &client, &plan, models, &[], &|_| {})
            .await
            .unwrap();
        let config = configuration::export(&repo).await.unwrap();
        assert_eq!(config.connections.len(), 1);
        assert_eq!(config.presets.len(), 3);
        assert_eq!(
            config.selections.default_chat,
            before.selections.default_chat
        );
        assert!(config.selections.active_embedding.is_some());
        assert!(config.selections.default_decision.is_some());
        assert_eq!(
            config.selections.privacy_decision,
            config.selections.default_decision
        );
        let replacement_space = crate::search::semantic::status(&repo)
            .await
            .unwrap()
            .pending_space_id
            .unwrap();
        assert_ne!(previous_space, replacement_space);
        let revision: String =
            sqlx::query_scalar("SELECT model_revision FROM search_embedding_spaces WHERE id=?")
                .bind(replacement_space)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(revision, "embedding-digest-2");
        let answers = crate::ai::decision::predicates(
            &repo,
            config.selections.privacy_decision.as_deref().unwrap(),
            "A meeting is scheduled for Tuesday at 10 AM.",
            &std::collections::BTreeMap::from([(
                "sample".into(),
                "Is this text about a meeting?".into(),
            )]),
        )
        .await
        .unwrap();
        assert_eq!(answers["sample"], 0.9);
        server.abort();
    }
}

#[cfg(target_os = "macos")]
fn memory_bytes() -> Option<u64> {
    let output = Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    std::str::from_utf8(&output.stdout)
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn memory_bytes() -> Option<u64> {
    std::fs::read_to_string("/proc/meminfo")
        .ok()?
        .lines()
        .find_map(|line| {
            line.strip_prefix("MemTotal:")?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?
                .checked_mul(1024)
        })
}
