use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::foundation::ManagedFileStore;
use crate::history::{
    new_id, now_ms, safe_relative, CapturedPayload, CapturedRepresentation, HistoryRepository,
};

use super::{runtime::GenerationFailure, ExtensionService};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceApplication {
    pub platform: String,
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationRule {
    pub id: String,
    pub activation_id: String,
    pub application: SourceApplication,
    pub enabled: bool,
    pub parameters: serde_json::Value,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueExtensionJob {
    pub clip_id: String,
    pub source_id: String,
    pub transformer_id: String,
    #[serde(default)]
    pub parameters: serde_json::Value,
    pub request_id: Option<String>,
    pub invocation_token: Option<String>,
    #[serde(skip)]
    pub capture_application: Option<SourceApplication>,
    #[serde(default)]
    pub regenerate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionJobResult {
    pub job_id: String,
    pub reused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionJobSummary {
    pub job_id: String,
    pub clip_id: String,
    pub source_id: String,
    pub package_id: String,
    pub transformer_id: String,
    pub transformer_version: String,
    pub status: String,
    pub reason_code: Option<String>,
    pub parameters: serde_json::Value,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub output_text: Option<String>,
    pub source_text: Option<String>,
    pub output_mime_type: Option<String>,
}

pub(crate) struct DurableExecution {
    pub outputs: Vec<CapturedRepresentation>,
    pub state_writes: std::collections::BTreeMap<String, Option<String>>,
}

fn canonical_json(value: &serde_json::Value) -> String {
    fn normalized(value: &serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => serde_json::Value::Object(
                map.iter()
                    .map(|(key, value)| (key.clone(), normalized(value)))
                    .collect(),
            ),
            serde_json::Value::Array(values) => {
                serde_json::Value::Array(values.iter().map(normalized).collect())
            }
            value => value.clone(),
        }
    }
    serde_json::to_string(&normalized(value)).expect("JSON value is serializable")
}

fn digest(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

pub(crate) async fn enqueue(
    repo: &HistoryRepository,
    request: EnqueueExtensionJob,
    package_id: &str,
    package_sha256: &str,
    contribution_version: &str,
    lifetime: &str,
    priority: i64,
) -> Result<ExtensionJobResult> {
    if !request.parameters.is_object() {
        bail!("extension parameters must be an object");
    }
    if request
        .request_id
        .as_deref()
        .is_some_and(|id| id.is_empty() || id.len() > 120)
    {
        bail!("extension request ID is invalid");
    }
    let row = sqlx::query("SELECT t.sha256,c.source_app_platform,c.source_app_id,c.source_app_name FROM clip_representations r JOIN clip_text_values t ON t.representation_id=r.id JOIN clip_items c ON c.id=r.clip_id WHERE c.id=? AND r.id=? AND c.lifecycle_state='ready' AND r.lifecycle_state='ready'")
        .bind(&request.clip_id).bind(&request.source_id).fetch_optional(&repo.pool).await?
        .context("extension job source is unavailable")?;
    let input_sha: String = row.get(0);
    let app_platform: Option<String> = request
        .capture_application
        .as_ref()
        .map(|app| app.platform.clone())
        .or_else(|| row.get(1));
    let app_id: Option<String> = request
        .capture_application
        .as_ref()
        .map(|app| app.id.clone())
        .or_else(|| row.get(2));
    let app_name: Option<String> = request
        .capture_application
        .as_ref()
        .map(|app| app.display_name.clone())
        .or_else(|| row.get(3));
    let parameters_json = canonical_json(&request.parameters);
    let parameter_sha = digest(&[&parameters_json]);
    let settings_revision = revision(repo, package_id, "configuration_revision").await?;
    let grant_revision = revision(repo, package_id, "grant_revision").await?;
    let state_revision = revision(repo, package_id, "state_revision").await?;
    let provider_revision = provider_revision(repo).await?;
    let app_key = format!(
        "{}:{}",
        app_platform.as_deref().unwrap_or(""),
        app_id.as_deref().unwrap_or("")
    );
    let dedupe = digest(&[
        &request.clip_id,
        &request.source_id,
        &input_sha,
        package_sha256,
        &request.transformer_id,
        contribution_version,
        &parameters_json,
        &app_key,
        &settings_revision.to_string(),
        &grant_revision.to_string(),
        &state_revision.to_string(),
        &provider_revision.to_string(),
    ]);
    if let Some(request_id) = request.request_id.as_deref() {
        if let Some(id) =
            sqlx::query_scalar::<_, String>("SELECT id FROM extension_jobs WHERE request_id=?")
                .bind(request_id)
                .fetch_optional(&repo.pool)
                .await?
        {
            return Ok(ExtensionJobResult {
                job_id: id,
                reused: true,
            });
        }
    }
    if !request.regenerate {
        if let Some(id) = sqlx::query_scalar::<_, String>("SELECT id FROM extension_jobs WHERE dedupe_key=? AND regeneration_nonce IS NULL AND status IN ('pending','running','waiting_provider','completed') ORDER BY created_at DESC LIMIT 1")
            .bind(&dedupe).fetch_optional(&repo.pool).await? {
            return Ok(ExtensionJobResult { job_id: id, reused: true });
        }
    }
    let outstanding: i64 = sqlx::query_scalar("SELECT count(*) FROM extension_jobs WHERE status IN ('pending','running','waiting_provider')").fetch_one(&repo.pool).await?;
    if outstanding >= 1000 {
        bail!("extension job queue is full");
    }
    let package_outstanding: i64 = sqlx::query_scalar("SELECT count(*) FROM extension_jobs WHERE package_id=? AND status IN ('pending','running','waiting_provider')").bind(package_id).fetch_one(&repo.pool).await?;
    if package_outstanding >= 100 {
        bail!("extension package job queue is full");
    }
    let completed: i64 = sqlx::query_scalar("SELECT count(*) FROM extension_jobs WHERE source_clip_id=? AND package_id=? AND status='completed'").bind(&request.clip_id).bind(package_id).fetch_one(&repo.pool).await?;
    if completed >= 20 {
        bail!("source clip already has 20 retained results from this package");
    }
    let id = new_id();
    let now = now_ms();
    let nonce = request.regenerate.then(new_id);
    sqlx::query("INSERT INTO extension_jobs(id,request_id,source_clip_id,source_representation_id,package_id,contribution_id,contribution_version,package_sha256,input_sha256,parameters_json,parameter_sha256,app_platform,app_id,app_display_name,settings_revision,grant_revision,state_revision,provider_revision,priority,result_lifetime,dedupe_key,regeneration_nonce,status,requested_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)")
        .bind(&id).bind(request.request_id).bind(&request.clip_id).bind(&request.source_id)
        .bind(package_id).bind(&request.transformer_id).bind(contribution_version).bind(package_sha256)
        .bind(input_sha).bind(parameters_json).bind(parameter_sha).bind(app_platform).bind(app_id).bind(app_name)
        .bind(settings_revision).bind(grant_revision).bind(state_revision).bind(provider_revision).bind(priority).bind(lifetime)
        .bind(dedupe).bind(nonce).bind(now).bind(now).bind(now).execute(&repo.pool).await?;
    Ok(ExtensionJobResult {
        job_id: id,
        reused: false,
    })
}

async fn revision(repo: &HistoryRepository, package_id: &str, column: &str) -> Result<i64> {
    let value =
        match column {
            "configuration_revision" => sqlx::query_scalar(
                "SELECT configuration_revision FROM extension_package_revisions WHERE package_id=?",
            )
            .bind(package_id)
            .fetch_optional(&repo.pool)
            .await?,
            "state_revision" => {
                sqlx::query_scalar(
                    "SELECT state_revision FROM extension_package_revisions WHERE package_id=?",
                )
                .bind(package_id)
                .fetch_optional(&repo.pool)
                .await?
            }
            "grant_revision" => {
                sqlx::query_scalar(
                    "SELECT grant_revision FROM extension_package_revisions WHERE package_id=?",
                )
                .bind(package_id)
                .fetch_optional(&repo.pool)
                .await?
            }
            _ => bail!("unsupported extension revision"),
        };
    Ok(value.unwrap_or(0))
}

async fn provider_revision(repo: &HistoryRepository) -> Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT updated_at FROM config_device_values WHERE key='providers.generation.text.active'",
    )
    .fetch_optional(&repo.pool)
    .await?
    .unwrap_or(0))
}

pub(crate) async fn recover(repo: &HistoryRepository) -> Result<()> {
    let now = now_ms();
    sqlx::query("UPDATE extension_jobs SET status=CASE WHEN interruption_count >= 2 THEN 'failed' ELSE 'pending' END, interruption_count=interruption_count+1, reason_code=CASE WHEN interruption_count >= 2 THEN 'interrupted_too_often' ELSE 'restart_recovery' END, started_at=NULL, updated_at=? WHERE status='running'")
        .bind(now).execute(&repo.pool).await?;
    cleanup_expired(repo).await?;
    Ok(())
}

async fn cleanup_expired(repo: &HistoryRepository) -> Result<()> {
    let now = now_ms();
    let terminal_cutoff = now - 7 * 24 * 60 * 60 * 1000;
    let temporary_cutoff = now - 15 * 60 * 1000;
    let mut tx = repo.pool.begin().await?;
    sqlx::query("DELETE FROM artifact_records WHERE id IN (SELECT artifact_id FROM extension_result_outputs WHERE job_id IN (SELECT id FROM extension_jobs WHERE (status IN ('failed','cancelled') AND completed_at<?) OR (status='completed' AND result_lifetime='temporary' AND completed_at<?)))")
        .bind(terminal_cutoff)
        .bind(temporary_cutoff)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM extension_jobs WHERE (status IN ('failed','cancelled') AND completed_at<?) OR (status='completed' AND result_lifetime='temporary' AND completed_at<?)")
        .bind(terminal_cutoff)
        .bind(temporary_cutoff)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM extension_activation_events WHERE status<>'pending' AND updated_at<?")
        .bind(terminal_cutoff)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn run_next(
    repo: &HistoryRepository,
    extensions: &ExtensionService,
) -> Result<Option<(String, String)>> {
    cleanup_expired(repo).await?;
    let mut tx = repo.pool.begin().await?;
    let row = sqlx::query("SELECT id,source_clip_id,source_representation_id,package_id,contribution_id,package_sha256,input_sha256,parameters_json,claim_generation,priority FROM extension_jobs WHERE status IN ('pending','waiting_provider') AND (retry_at IS NULL OR retry_at<=?) ORDER BY priority ASC,requested_at,id LIMIT 1")
        .bind(now_ms()).fetch_optional(&mut *tx).await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let job_id: String = row.get(0);
    let clip_id: String = row.get(1);
    let source_id: String = row.get(2);
    let package_id: String = row.get(3);
    let contribution_id: String = row.get(4);
    let package_sha: String = row.get(5);
    let input_sha: String = row.get(6);
    let parameters_json: String = row.get(7);
    let claim: i64 = row.get::<i64, _>(8) + 1;
    let background = row.get::<i64, _>(9) == 1;
    let now = now_ms();
    let changed = sqlx::query("UPDATE extension_jobs SET status='running',claim_generation=?,attempt_count=attempt_count+1,started_at=?,updated_at=?,reason_code=NULL WHERE id=? AND status IN ('pending','waiting_provider')")
        .bind(claim).bind(now).bind(now).bind(&job_id).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    if changed == 0 {
        return Ok(None);
    }
    let actual_sha: Option<String> = sqlx::query_scalar("SELECT t.sha256 FROM clip_text_values t JOIN clip_representations r ON r.id=t.representation_id WHERE r.id=? AND r.clip_id=? AND r.lifecycle_state='ready'")
        .bind(&source_id).bind(&clip_id).fetch_optional(&repo.pool).await?;
    if actual_sha.as_deref() != Some(&input_sha) {
        finish(repo, &job_id, claim, "cancelled", Some("stale_source")).await?;
        return Ok(Some((job_id, clip_id)));
    }
    let parameters: serde_json::Value = serde_json::from_str(&parameters_json)?;
    let cancellation = crate::providers::contracts::generation::GenerationCancellation::default();
    let watcher_cancel = cancellation.clone();
    let watcher_repo = repo.clone();
    let watcher_job = job_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = watcher_cancel.cancelled() => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(250)) => {}
            }
            let active: Option<i64> = sqlx::query_scalar("SELECT j.claim_generation FROM extension_jobs j LEFT JOIN extension_package_revisions p ON p.package_id=j.package_id JOIN extension_installs i ON i.package_id=j.package_id WHERE j.id=? AND j.status='running' AND i.enabled=1 AND i.sha256=j.package_sha256 AND j.settings_revision=COALESCE(p.configuration_revision,0) AND j.grant_revision=COALESCE(p.grant_revision,0) AND j.state_revision=COALESCE(p.state_revision,0) AND j.provider_revision=COALESCE((SELECT updated_at FROM config_device_values WHERE key='providers.generation.text.active'),0)")
                .bind(&watcher_job).fetch_optional(&watcher_repo.pool).await.unwrap_or(None);
            if active != Some(claim) {
                watcher_cancel.cancel();
                break;
            }
        }
    });
    let execution = extensions
        .execute_durable_transform(
            repo,
            &job_id,
            &package_id,
            &package_sha,
            &contribution_id,
            &source_id,
            parameters,
            background,
            cancellation.clone(),
        )
        .await;
    cancellation.cancel();
    match execution {
        Ok(execution) => {
            persist_outputs(repo, &job_id, claim, &clip_id, &source_id, execution).await?
        }
        Err(error) => match error
            .downcast_ref::<super::runtime::GenerationFailureError>()
            .map(|failure| failure.0)
        {
            Some(GenerationFailure::WaitingProvider) => {
                sqlx::query("UPDATE extension_jobs SET status='waiting_provider',reason_code='provider_unavailable',retry_at=?,updated_at=? WHERE id=? AND claim_generation=? AND status='running'")
                    .bind(now_ms()+60_000).bind(now_ms()).bind(&job_id).bind(claim).execute(&repo.pool).await?;
            }
            Some(GenerationFailure::Transient) => {
                let retries: i64 = sqlx::query_scalar(
                    "SELECT transient_retry_count FROM extension_jobs WHERE id=?",
                )
                .bind(&job_id)
                .fetch_one(&repo.pool)
                .await?;
                if let Some(delay) = [5_000_i64, 15_000, 60_000].get(retries as usize) {
                    sqlx::query("UPDATE extension_jobs SET status='pending',transient_retry_count=transient_retry_count+1,reason_code='provider_retry',retry_at=?,updated_at=? WHERE id=? AND claim_generation=? AND status='running'")
                        .bind(now_ms()+*delay).bind(now_ms()).bind(&job_id).bind(claim).execute(&repo.pool).await?;
                } else {
                    finish(
                        repo,
                        &job_id,
                        claim,
                        "failed",
                        Some("provider_retries_exhausted"),
                    )
                    .await?;
                }
            }
            Some(GenerationFailure::Cancelled) => {
                finish(
                    repo,
                    &job_id,
                    claim,
                    "cancelled",
                    Some("provider_cancelled"),
                )
                .await?;
            }
            Some(GenerationFailure::Terminal) => {
                finish(repo, &job_id, claim, "failed", Some("provider_rejected")).await?;
            }
            None => finish(repo, &job_id, claim, "failed", Some("execution_failed")).await?,
        },
    }
    Ok(Some((job_id, clip_id)))
}

async fn persist_outputs(
    repo: &HistoryRepository,
    job_id: &str,
    claim: i64,
    clip_id: &str,
    source_id: &str,
    execution: DurableExecution,
) -> Result<()> {
    let DurableExecution {
        outputs,
        state_writes,
    } = execution;
    if outputs.is_empty() || outputs.len() > 8 {
        bail!("durable extension output count is invalid");
    }
    let now = now_ms();
    let mut tx = repo.pool.begin().await?;
    let active: Option<String> = sqlx::query_scalar("SELECT j.status FROM extension_jobs j JOIN clip_items c ON c.id=j.source_clip_id JOIN clip_representations r ON r.id=j.source_representation_id JOIN clip_text_values t ON t.representation_id=r.id JOIN extension_installs i ON i.package_id=j.package_id JOIN extension_runtime_state s ON s.extension_id=i.id LEFT JOIN extension_package_revisions p ON p.package_id=j.package_id WHERE j.id=? AND j.claim_generation=? AND c.lifecycle_state='ready' AND r.lifecycle_state='ready' AND t.sha256=j.input_sha256 AND i.sha256=j.package_sha256 AND i.enabled=1 AND s.status='ready' AND j.settings_revision=COALESCE(p.configuration_revision,0) AND j.grant_revision=COALESCE(p.grant_revision,0) AND j.state_revision=COALESCE(p.state_revision,0) AND j.provider_revision=COALESCE((SELECT updated_at FROM config_device_values WHERE key='providers.generation.text.active'),0)")
            .bind(job_id)
            .bind(claim)
            .fetch_optional(&mut *tx)
            .await?;
    if active.as_deref() != Some("running") {
        sqlx::query("UPDATE extension_jobs SET status='cancelled',reason_code='stale_context',completed_at=?,updated_at=?,claim_generation=claim_generation+1 WHERE id=? AND claim_generation=? AND status='running'")
            .bind(now).bind(now).bind(job_id).bind(claim).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(());
    }
    for (ordinal, output) in outputs.into_iter().enumerate() {
        let artifact_id = new_id();
        sqlx::query("INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) SELECT ?,source_clip_id,'extension_output',package_id||'/'||contribution_id,contribution_version,parameter_sha256,input_sha256,'ready',?,? FROM extension_jobs WHERE id=?")
            .bind(&artifact_id).bind(now).bind(now).bind(job_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256) SELECT ?,0,?,input_sha256 FROM extension_jobs WHERE id=?")
            .bind(&artifact_id).bind(source_id).bind(job_id).execute(&mut *tx).await?;
        match output.payload {
            CapturedPayload::Text(text) => {
                let byte_length = text.len();
                let sha = digest(&[&text]);
                sqlx::query("INSERT INTO artifact_text_values(artifact_id,text_value,utf8_byte_length,sha256) VALUES(?,?,?,?)")
                    .bind(&artifact_id).bind(text).bind(byte_length as i64).bind(sha).execute(&mut *tx).await?;
            }
            CapturedPayload::Binary(bytes) => {
                let store = ManagedFileStore::new(repo.managed_root.clone())?;
                let staged = store.stage("derived", &bytes)?;
                let relative = staged.relative_path.to_string_lossy().replace('\\', "/");
                let sha = staged.sha256.clone();
                let byte_length = staged.byte_length as i64;
                store.commit(staged)?;
                sqlx::query("INSERT INTO artifact_binary_files(id,artifact_id,sha256,byte_length,relative_path,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?)")
                    .bind(new_id()).bind(&artifact_id).bind(sha).bind(byte_length).bind(relative).bind(now).bind(now).execute(&mut *tx).await?;
            }
            CapturedPayload::Files(_) => {
                bail!("file-list output cannot be attached to an extension job")
            }
        }
        sqlx::query("INSERT INTO extension_result_outputs(job_id,ordinal,artifact_id,format_key,mime_type) VALUES(?,?,?,?,?)")
            .bind(job_id).bind(ordinal as i64).bind(artifact_id).bind(output.format_key)
            .bind(output.canonical_mime_type.unwrap_or_else(|| "text/plain".into())).execute(&mut *tx).await?;
    }
    if !state_writes.is_empty() {
        let package_id: String =
            sqlx::query_scalar("SELECT package_id FROM extension_jobs WHERE id=?")
                .bind(job_id)
                .fetch_one(&mut *tx)
                .await?;
        sqlx::query("INSERT INTO extension_package_revisions(package_id,state_revision,updated_at) VALUES(?,1,?) ON CONFLICT(package_id) DO UPDATE SET state_revision=state_revision+1,updated_at=excluded.updated_at")
            .bind(&package_id).bind(now).execute(&mut *tx).await?;
        let revision: i64 = sqlx::query_scalar(
            "SELECT state_revision FROM extension_package_revisions WHERE package_id=?",
        )
        .bind(&package_id)
        .fetch_one(&mut *tx)
        .await?;
        for (key, value) in state_writes {
            if let Some(value) = value {
                sqlx::query("INSERT INTO extension_package_state(package_id,state_key,value_json,byte_length,revision,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(package_id,state_key) DO UPDATE SET value_json=excluded.value_json,byte_length=excluded.byte_length,revision=excluded.revision,updated_at=excluded.updated_at")
                    .bind(&package_id).bind(&key).bind(&value).bind(value.len() as i64).bind(revision).bind(now).execute(&mut *tx).await?;
            } else {
                sqlx::query(
                    "DELETE FROM extension_package_state WHERE package_id=? AND state_key=?",
                )
                .bind(&package_id)
                .bind(&key)
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    sqlx::query("UPDATE extension_jobs SET status='completed',completed_at=?,updated_at=?,reason_code=NULL WHERE id=? AND claim_generation=? AND status='running'")
        .bind(now).bind(now).bind(job_id).bind(claim).execute(&mut *tx).await?;
    tx.commit().await?;
    let _ = clip_id;
    Ok(())
}

async fn finish(
    repo: &HistoryRepository,
    id: &str,
    claim: i64,
    status: &str,
    reason: Option<&str>,
) -> Result<()> {
    sqlx::query("UPDATE extension_jobs SET status=?,reason_code=?,completed_at=?,updated_at=? WHERE id=? AND claim_generation=? AND status='running'")
        .bind(status).bind(reason).bind(now_ms()).bind(now_ms()).bind(id).bind(claim).execute(&repo.pool).await?;
    Ok(())
}

pub(crate) async fn list(
    repo: &HistoryRepository,
    clip_id: &str,
) -> Result<Vec<ExtensionJobSummary>> {
    let rows = sqlx::query("SELECT j.id,j.source_clip_id,j.source_representation_id,j.package_id,j.contribution_id,j.contribution_version,j.status,j.reason_code,j.parameters_json,j.created_at,j.completed_at,t.text_value,o.mime_type,src.text_value FROM extension_jobs j LEFT JOIN extension_result_outputs o ON o.job_id=j.id AND o.ordinal=0 LEFT JOIN artifact_text_values t ON t.artifact_id=o.artifact_id LEFT JOIN clip_text_values src ON src.representation_id=j.source_representation_id WHERE j.source_clip_id=? ORDER BY j.created_at DESC,j.id DESC")
        .bind(clip_id).fetch_all(&repo.pool).await?;
    rows.into_iter()
        .map(|row| {
            Ok(ExtensionJobSummary {
                job_id: row.get(0),
                clip_id: row.get(1),
                source_id: row.get(2),
                package_id: row.get(3),
                transformer_id: row.get(4),
                transformer_version: row.get(5),
                status: row.get(6),
                reason_code: row.get(7),
                parameters: serde_json::from_str(&row.get::<String, _>(8))?,
                created_at: row.get(9),
                completed_at: row.get(10),
                output_text: row.get(11),
                output_mime_type: row.get(12),
                source_text: row.get(13),
            })
        })
        .collect()
}

pub(crate) async fn cancel(repo: &HistoryRepository, job_id: &str) -> Result<()> {
    sqlx::query("UPDATE extension_jobs SET status='cancelled',reason_code='user_cancelled',completed_at=?,updated_at=?,claim_generation=claim_generation+1 WHERE id=? AND status IN ('pending','running','waiting_provider')")
        .bind(now_ms()).bind(now_ms()).bind(job_id).execute(&repo.pool).await?;
    Ok(())
}

pub(crate) async fn delete(repo: &HistoryRepository, job_id: &str) -> Result<()> {
    let mut tx = repo.pool.begin().await?;
    sqlx::query("DELETE FROM artifact_records WHERE id IN (SELECT artifact_id FROM extension_result_outputs WHERE job_id=?)").bind(job_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM extension_jobs WHERE id=?")
        .bind(job_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn output(
    repo: &HistoryRepository,
    job_id: &str,
) -> Result<Vec<CapturedRepresentation>> {
    let rows=sqlx::query("SELECT o.format_key,o.mime_type,t.text_value,b.relative_path,b.sha256 FROM extension_result_outputs o LEFT JOIN artifact_text_values t ON t.artifact_id=o.artifact_id LEFT JOIN artifact_binary_files b ON b.artifact_id=o.artifact_id AND b.lifecycle_state='ready' JOIN extension_jobs j ON j.id=o.job_id WHERE o.job_id=? AND j.status='completed' ORDER BY o.ordinal")
        .bind(job_id).fetch_all(&repo.pool).await?;
    if rows.is_empty() {
        bail!("extension result is unavailable");
    }
    rows.into_iter()
        .map(|row| -> Result<CapturedRepresentation> {
            let payload = if let Some(text) = row.get::<Option<String>, _>(2) {
                CapturedPayload::Text(text)
            } else {
                let relative: String = row
                    .get::<Option<String>, _>(3)
                    .context("extension binary output is unavailable")?;
                if !safe_relative(&relative) {
                    bail!("extension binary output path is invalid");
                }
                let bytes = std::fs::read(repo.managed_root.join(&relative))?;
                let expected: String = row.get(4);
                if format!("{:x}", Sha256::digest(&bytes)) != expected {
                    bail!("extension binary output hash mismatch");
                }
                CapturedPayload::Binary(bytes)
            };
            Ok(CapturedRepresentation {
                format_key: row.get(0),
                canonical_mime_type: Some(row.get(1)),
                native_type: None,
                platform: if cfg!(target_os = "windows") {
                    "windows"
                } else if cfg!(target_os = "macos") {
                    "macos"
                } else {
                    "linux_x11"
                }
                .into(),
                capture_priority: 10,
                payload,
            })
        })
        .collect()
}

pub(crate) async fn promote(
    repo: &HistoryRepository,
    job_id: &str,
    request_id: &str,
) -> Result<String> {
    repo.promote_extension_result(job_id, request_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{CaptureSettings, CapturedSnapshot};

    #[tokio::test]
    async fn equivalent_jobs_reuse_output_and_promotion_is_independent() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let (clip_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: Some("Outlook".into()),
                    source_app_id: Some("exe:outlook.exe".into()),
                    format_observations: vec![],
                    representations: vec![CapturedRepresentation {
                        format_key: "mime:text/plain".into(),
                        canonical_mime_type: Some("text/plain".into()),
                        native_type: None,
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Text("original".into()),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let source_id: String =
            sqlx::query_scalar("SELECT id FROM clip_representations WHERE clip_id=?")
                .bind(&clip_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let checksum = "a".repeat(64);
        let now = now_ms();
        sqlx::query("INSERT INTO extension_installs(id,package_id,version,api_version,source,sha256,relative_path,enabled,installed_at,updated_at) VALUES('extension-1','example.rewrite','1.0.0','^3.0','developer',?,'packages/rewrite',1,?,?)")
            .bind(&checksum).bind(now).bind(now).execute(&repo.pool).await.unwrap();
        sqlx::query("INSERT INTO extension_runtime_state(extension_id,status) VALUES('extension-1','ready')")
            .execute(&repo.pool).await.unwrap();
        let request = |request_id: &str| EnqueueExtensionJob {
            clip_id: clip_id.clone(),
            source_id: source_id.clone(),
            transformer_id: "example.rewrite/rewrite".into(),
            parameters: serde_json::json!({"preset":"business"}),
            request_id: Some(request_id.into()),
            regenerate: false,
            invocation_token: None,
            capture_application: None,
        };
        let first = enqueue(
            &repo,
            request("first"),
            "example.rewrite",
            &checksum,
            "1.0.0",
            "source_clip",
            0,
        )
        .await
        .unwrap();
        let second = enqueue(
            &repo,
            request("second"),
            "example.rewrite",
            &checksum,
            "1.0.0",
            "source_clip",
            0,
        )
        .await
        .unwrap();
        assert_eq!(first.job_id, second.job_id);
        assert!(second.reused);
        sqlx::query("UPDATE extension_jobs SET status='running',claim_generation=1 WHERE id=?")
            .bind(&first.job_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        persist_outputs(
            &repo,
            &first.job_id,
            1,
            &clip_id,
            &source_id,
            DurableExecution {
                outputs: vec![CapturedRepresentation {
                    format_key: "mime:text/plain".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 10,
                    payload: CapturedPayload::Text("rewritten".into()),
                }],
                state_writes: [("last_preset".into(), Some("\"business\"".into()))]
                    .into_iter()
                    .collect(),
            },
        )
        .await
        .unwrap();
        let state: String = sqlx::query_scalar("SELECT value_json FROM extension_package_state WHERE package_id='example.rewrite' AND state_key='last_preset'")
            .fetch_one(&repo.pool).await.unwrap();
        assert_eq!(state, "\"business\"");
        let promoted = promote(&repo, &first.job_id, "save-1").await.unwrap();
        assert_eq!(
            promote(&repo, &first.job_id, "save-1").await.unwrap(),
            promoted
        );
        let mut binary_request = request("binary-result");
        binary_request.regenerate = true;
        let binary = enqueue(
            &repo,
            binary_request,
            "example.rewrite",
            &checksum,
            "1.0.0",
            "source_clip",
            0,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE extension_jobs SET status='running',claim_generation=1 WHERE id=?")
            .bind(&binary.job_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        persist_outputs(
            &repo,
            &binary.job_id,
            1,
            &clip_id,
            &source_id,
            DurableExecution {
                outputs: vec![CapturedRepresentation {
                    format_key: "mime:image/png".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 10,
                    payload: CapturedPayload::Binary(vec![137, 80, 78, 71]),
                }],
                state_writes: Default::default(),
            },
        )
        .await
        .unwrap();
        assert!(
            matches!(output(&repo, &binary.job_id).await.unwrap()[0].payload, CapturedPayload::Binary(ref bytes) if bytes == &[137, 80, 78, 71])
        );
        let binary_file_id: String = sqlx::query_scalar("SELECT b.id FROM artifact_binary_files b JOIN extension_result_outputs o ON o.artifact_id=b.artifact_id WHERE o.job_id=?")
            .bind(&binary.job_id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        let (served_bytes, served_mime) = crate::artifacts::artifact_binary(&repo, &binary_file_id)
            .await
            .unwrap();
        assert_eq!(served_bytes, [137, 80, 78, 71]);
        assert_eq!(served_mime, "image/png");
        let promoted_binary = promote(&repo, &binary.job_id, "save-binary").await.unwrap();
        let stored_kind: String =
            sqlx::query_scalar("SELECT storage_kind FROM clip_representations WHERE clip_id=?")
                .bind(&promoted_binary)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(stored_kind, "binary_asset");
        let mut expired_request = request("failed-later");
        expired_request.regenerate = true;
        let expired = enqueue(
            &repo,
            expired_request,
            "example.rewrite",
            &checksum,
            "1.0.0",
            "source_clip",
            0,
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE extension_jobs SET status='failed',completed_at=?,updated_at=? WHERE id=?",
        )
        .bind(now - 8 * 24 * 60 * 60 * 1000_i64)
        .bind(now - 8 * 24 * 60 * 60 * 1000_i64)
        .bind(&expired.job_id)
        .execute(&repo.pool)
        .await
        .unwrap();
        cleanup_expired(&repo).await.unwrap();
        let expired_exists: i64 =
            sqlx::query_scalar("SELECT count(*) FROM extension_jobs WHERE id=?")
                .bind(&expired.job_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(expired_exists, 0);
        assert_eq!(list(&repo, &clip_id).await.unwrap().len(), 2);
        sqlx::query("DELETE FROM clip_items WHERE id=?")
            .bind(&clip_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        assert!(repo.detail(&promoted).await.is_ok());
        assert!(repo.detail(&promoted_binary).await.is_ok());
    }
}
