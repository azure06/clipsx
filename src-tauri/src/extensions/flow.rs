//! Durable, linear operation continuation. The guest chooses the next step;
//! the host alone performs effects and journals each request before dispatch.

use crate::failure::{FailureCode, OperationFailure};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use sqlx::Row;

use crate::history::{now_ms, HistoryRepository};

use super::{
    broker::{self, BrokerHttpRequest},
    runtime::{
        self, OperationComplete, OperationProgress, RuntimeBrokerContext, StepCall, StepKind,
    },
    ExtensionRepresentation, ExtensionRuntime,
};

#[derive(Debug)]
pub(crate) struct GuestExecutionError(pub OperationFailure);

impl std::fmt::Display for GuestExecutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(&self.0, formatter)
    }
}

impl std::error::Error for GuestExecutionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelStepRequest {
    messages: Vec<crate::providers::contracts::generation::GenerationMessage>,
    max_output_tokens: u32,
}

fn kind_name(kind: StepKind) -> &'static str {
    match kind {
        StepKind::Read => "read",
        StepKind::ModelCall => "model_call",
        StepKind::Write => "write",
    }
}

async fn active(repo: &HistoryRepository, job_id: &str, claim: i64) -> Result<()> {
    let valid: Option<i64> = sqlx::query_scalar("SELECT 1 FROM extension_jobs j JOIN clip_items c ON c.id=j.source_clip_id JOIN clip_representations r ON r.id=j.source_representation_id LEFT JOIN clip_text_values t ON t.representation_id=r.id LEFT JOIN clip_binary_files b ON b.id=r.binary_file_id JOIN extension_installs i ON i.package_id=j.package_id JOIN extension_runtime_state s ON s.extension_id=i.id LEFT JOIN extension_package_revisions p ON p.package_id=j.package_id WHERE j.id=? AND j.claim_generation=? AND j.status='running' AND c.lifecycle_state='ready' AND r.lifecycle_state='ready' AND COALESCE(t.sha256,b.sha256)=j.input_sha256 AND i.sha256=j.package_sha256 AND i.enabled=1 AND s.status='ready' AND (j.automation_rule_id IS NULL OR EXISTS(SELECT 1 FROM extension_automation_rules a WHERE a.package_id=j.package_id AND a.rule_id=j.automation_rule_id AND a.enabled=1 AND (a.app_platform IS NULL OR (a.app_platform=j.app_platform AND a.app_id=j.app_id)))) AND j.grant_revision=COALESCE(p.grant_revision,0) AND j.state_revision=COALESCE(p.state_revision,0) AND j.provider_revision=COALESCE((SELECT updated_at FROM config_device_values WHERE key='providers.generation.text.active'),0)")
        .bind(job_id).bind(claim).fetch_optional(&repo.pool).await?;
    if valid.is_none() {
        return Err(FailureCode::StaleContext.failure().into());
    }
    Ok(())
}

async fn execute_step(
    context: &RuntimeBrokerContext,
    step: &StepCall,
    idempotency_key: &str,
) -> Result<String> {
    match step.kind {
        StepKind::Read | StepKind::Write => {
            let request: BrokerHttpRequest =
                serde_json::from_str(&step.request_json).context("invalid HTTPS step request")?;
            if step.kind == StepKind::Read && !matches!(request.method.as_str(), "GET" | "HEAD") {
                bail!("read step must use GET or HEAD");
            }
            if step.kind == StepKind::Write && matches!(request.method.as_str(), "GET" | "HEAD") {
                bail!("write step must change the remote resource");
            }
            let parsed = url::Url::parse(&request.url)?;
            let permissions = if step.kind == StepKind::Write {
                &context.write_permissions
            } else {
                &context.http_permissions
            };
            let permission = permissions
                .iter()
                .find(|item| {
                    url::Url::parse(&item.origin)
                        .is_ok_and(|origin| origin.origin() == parsed.origin())
                })
                .context("HTTPS step origin is not declared")?;
            let grant_kind = if step.kind == StepKind::Write {
                "external_write"
            } else {
                "http"
            };
            runtime::require_live_grant(context, grant_kind, &permission.origin).await?;
            let mut injected = context
                .injected_headers
                .get(&permission.origin)
                .cloned()
                .unwrap_or_default();
            if step.kind == StepKind::Write {
                if let Some(header) = &permission.idempotency_header {
                    injected.insert(header.clone(), idempotency_key.to_owned());
                }
            }
            let response = broker::https(permission, request, injected).await?;
            if context.protected_secrets.iter().any(|secret| {
                !secret.is_empty()
                    && response
                        .body
                        .windows(secret.len())
                        .any(|part| part == secret)
            }) {
                bail!("HTTPS response reflected a protected credential");
            }
            Ok(serde_json::json!({
                "status": response.status,
                "contentType": response.content_type,
                "bodyBase64": BASE64.encode(response.body),
            })
            .to_string())
        }
        StepKind::ModelCall => {
            if !context.generation_allowed {
                return Err(FailureCode::PermissionRequired.failure().into());
            }
            runtime::require_live_grant(context, "provider", "generation.text").await?;
            let request: ModelStepRequest = serde_json::from_str(&step.request_json)
                .map_err(|_| FailureCode::InvalidParameters.failure())?;
            if request.messages.is_empty()
                || request.messages.len() > 16
                || !(1..=4096).contains(&request.max_output_tokens)
            {
                return Err(FailureCode::InvalidParameters.failure().into());
            }
            if request
                .messages
                .iter()
                .map(|message| message.content.len())
                .sum::<usize>()
                > 1024 * 1024
            {
                return Err(FailureCode::InputLimit.failure().into());
            }
            let response = crate::providers::generation::generate_stream(
                &context.repo,
                request.messages,
                request.max_output_tokens,
                &context.generation_cancellation,
                &|_| Ok(()),
            )
            .await
            .map_err(|error| OperationFailure::from_error(&error))?;
            let reason = match response.completion_reason {
                crate::providers::contracts::generation::GenerationCompletionReason::Stop => "stop",
                crate::providers::contracts::generation::GenerationCompletionReason::Length => {
                    "length"
                }
                crate::providers::contracts::generation::GenerationCompletionReason::Other(_) => {
                    "other"
                }
            };
            Ok(
                serde_json::json!({ "text": response.text, "completionReason": reason })
                    .to_string(),
            )
        }
    }
}

async fn finish_step(
    repo: &HistoryRepository,
    job_id: &str,
    claim: i64,
    ordinal: i64,
    response: &str,
) -> Result<()> {
    if response.len() > 1024 * 1024 {
        bail!("operation step response exceeds host limit");
    }
    let mut tx = repo.pool.begin().await?;
    let changed = sqlx::query("UPDATE extension_job_steps SET response_json=?,status='completed',updated_at=? WHERE job_id=? AND ordinal=? AND status='sending' AND dispatch_claim=?")
        .bind(response).bind(now_ms()).bind(job_id).bind(ordinal).bind(claim).execute(&mut *tx).await?.rows_affected();
    if changed != 1 {
        bail!("operation step claim expired");
    }
    tx.commit().await?;
    Ok(())
}

async fn send_step(
    repo: &HistoryRepository,
    job_id: &str,
    claim: i64,
    ordinal: i64,
    step: &StepCall,
    key: &str,
    context: &RuntimeBrokerContext,
) -> Result<String> {
    active(repo, job_id, claim).await?;
    // Reject requests before recording a dispatch: invalid requests were never sent.
    if matches!(step.kind, StepKind::Read | StepKind::Write) {
        let request: BrokerHttpRequest = serde_json::from_str(&step.request_json)?;
        let url = url::Url::parse(&request.url)?;
        let permissions = if step.kind == StepKind::Write {
            &context.write_permissions
        } else {
            &context.http_permissions
        };
        let permission = permissions
            .iter()
            .find(|permission| {
                url::Url::parse(&permission.origin)
                    .is_ok_and(|origin| origin.origin() == url.origin())
            })
            .context("HTTPS step origin is not declared")?;
        broker::validate_request(permission, &request, &url)?;
        runtime::require_live_grant(
            context,
            if step.kind == StepKind::Write {
                "external_write"
            } else {
                "http"
            },
            &permission.origin,
        )
        .await?;
    }
    let changed = sqlx::query("UPDATE extension_job_steps SET status='sending',dispatch_claim=?,updated_at=? WHERE job_id=? AND ordinal=? AND status IN ('prepared','sending') AND EXISTS(SELECT 1 FROM extension_jobs WHERE id=? AND claim_generation=? AND status='running')")
        .bind(claim).bind(now_ms()).bind(job_id).bind(ordinal).bind(job_id).bind(claim).execute(&repo.pool).await?.rows_affected();
    if changed != 1 {
        bail!("operation step is no longer sendable");
    }
    let response = match execute_step(context, step, key).await {
        Ok(value) => value,
        Err(error) => {
            if step.kind == StepKind::Write {
                let idempotent = serde_json::from_str::<BrokerHttpRequest>(&step.request_json)
                    .ok()
                    .and_then(|request| url::Url::parse(&request.url).ok())
                    .is_some_and(|url| {
                        context.write_permissions.iter().any(|permission| {
                            permission.idempotency_header.is_some()
                                && url::Url::parse(&permission.origin)
                                    .is_ok_and(|origin| origin.origin() == url.origin())
                        })
                    });
                if !idempotent {
                    mark_unknown(repo, job_id, claim, ordinal).await?;
                }
            }
            return Err(error);
        }
    };
    if let Err(error) = finish_step(repo, job_id, claim, ordinal, &response).await {
        if step.kind == StepKind::Write {
            mark_unknown(repo, job_id, claim, ordinal).await?;
        }
        return Err(error);
    }
    active(repo, job_id, claim).await?;
    Ok(response)
}

async fn mark_unknown(
    repo: &HistoryRepository,
    job_id: &str,
    claim: i64,
    ordinal: i64,
) -> Result<()> {
    let mut tx = repo.pool.begin().await?;
    sqlx::query("UPDATE extension_job_steps SET status='unknown',updated_at=? WHERE job_id=? AND ordinal=? AND status='sending' AND dispatch_claim<=?")
        .bind(now_ms()).bind(job_id).bind(ordinal).bind(claim).execute(&mut *tx).await?;
    sqlx::query("UPDATE extension_jobs SET status='waiting_write_review',reason_code='write_outcome_unknown',updated_at=? WHERE id=? AND claim_generation=? AND status='running'")
        .bind(now_ms()).bind(job_id).bind(claim).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run(
    repo: &HistoryRepository,
    runtime: &ExtensionRuntime,
    job_id: &str,
    claim: i64,
    sha256: &str,
    contribution_id: &str,
    input: ExtensionRepresentation,
    context_json: String,
    parameters_json: String,
    broker: RuntimeBrokerContext,
) -> Result<OperationComplete> {
    let cancellation = broker.generation_cancellation.clone();
    let execution = run_inner(
        repo,
        runtime,
        job_id,
        claim,
        sha256,
        contribution_id,
        input,
        context_json,
        parameters_json,
        broker,
    );
    let (result, interrupted) = tokio::select! {
        result = tokio::time::timeout(std::time::Duration::from_secs(125), execution) => match result {
            Ok(result) => (result, false),
            Err(_) => (Err(FailureCode::ExtensionTimeout.failure().into()), true),
        },
        _ = cancellation.cancelled() => (Err(FailureCode::ProviderCancelled.failure().into()), true),
    };
    if interrupted {
        // Dropping an in-flight request cannot establish whether the remote write landed.
        let ordinals: Vec<i64> = sqlx::query_scalar("SELECT ordinal FROM extension_job_steps WHERE job_id=? AND kind='write' AND status='sending' AND dispatch_claim=?")
            .bind(job_id).bind(claim).fetch_all(&repo.pool).await?;
        for ordinal in ordinals {
            mark_unknown(repo, job_id, claim, ordinal).await?;
        }
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn run_inner(
    repo: &HistoryRepository,
    runtime: &ExtensionRuntime,
    job_id: &str,
    claim: i64,
    sha256: &str,
    contribution_id: &str,
    input: ExtensionRepresentation,
    context_json: String,
    parameters_json: String,
    broker: RuntimeBrokerContext,
) -> Result<OperationComplete> {
    let mut ordinal = 0_i64;
    let mut state = "{}".to_string();
    let mut previous: Option<String> = None;
    let mut previous_was_model = false;
    loop {
        active(repo, job_id, claim).await?;
        if broker.generation_cancellation.is_cancelled() {
            return Err(FailureCode::ProviderCancelled.failure().into());
        }
        let existing = sqlx::query("SELECT step_id,kind,request_json,state_json,response_json,idempotency_key,status FROM extension_job_steps WHERE job_id=? AND ordinal=?")
            .bind(job_id).bind(ordinal).fetch_optional(&repo.pool).await?;
        if let Some(row) = existing {
            let status: String = row.get(6);
            let kind: String = row.get(1);
            let step = StepCall {
                id: row.get(0),
                kind: match kind.as_str() {
                    "read" => StepKind::Read,
                    "model_call" => StepKind::ModelCall,
                    "write" => StepKind::Write,
                    _ => bail!("invalid journaled step kind"),
                },
                request_json: row.get(2),
                state_json: row.get(3),
            };
            let key: String = row.get(5);
            let response = match status.as_str() {
                "completed" => row
                    .get::<Option<String>, _>(4)
                    .context("completed step has no response")?,
                "prepared" => send_step(repo, job_id, claim, ordinal, &step, &key, &broker).await?,
                "sending"
                    if step.kind != StepKind::Write
                        || broker.write_permissions.iter().any(|permission| {
                            permission.idempotency_header.is_some()
                                && serde_json::from_str::<BrokerHttpRequest>(&step.request_json)
                                    .is_ok_and(|request| {
                                        url::Url::parse(&request.url).is_ok_and(|url| {
                                            url::Url::parse(&permission.origin)
                                                .is_ok_and(|origin| url.origin() == origin.origin())
                                        })
                                    })
                        }) =>
                {
                    send_step(repo, job_id, claim, ordinal, &step, &key, &broker).await?
                }
                "sending" | "unknown" => {
                    mark_unknown(repo, job_id, claim, ordinal).await?;
                    bail!("external write outcome is unknown");
                }
                _ => bail!("invalid journaled step status"),
            };
            previous_was_model = step.kind == StepKind::ModelCall;
            state = step.state_json;
            previous = Some(response);
            ordinal += 1;
            continue;
        }
        let output_limited = previous_was_model
            && previous
                .as_deref()
                .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
                .is_some_and(|value| value["completionReason"] == "length");
        let progress = runtime
            .advance(
                sha256,
                contribution_id,
                input.clone(),
                context_json.clone(),
                parameters_json.clone(),
                state,
                previous,
            )
            .await
            .map_err(|error| {
                let mut failure = OperationFailure::from_error(&error);
                if output_limited && failure.code == FailureCode::ExtensionFailed {
                    failure = FailureCode::ExtensionFailedAfterOutputLimit.failure();
                }
                GuestExecutionError(failure)
            })?;
        match progress {
            OperationProgress::Complete(value) => return Ok(value),
            OperationProgress::Skip(reason) => {
                if reason.len() > 120 {
                    bail!("operation skip reason exceeds host limit");
                }
                bail!("operation declined after scheduling");
            }
            OperationProgress::Call(step) => {
                if ordinal >= 16
                    || step.id.is_empty()
                    || step.id.len() > 80
                    || step.request_json.len() > 1024 * 1024
                    || step.state_json.len() > 65536
                {
                    bail!("operation step exceeds host limits");
                }
                let _: serde_json::Value = serde_json::from_str(&step.request_json)?;
                let _: serde_json::Value = serde_json::from_str(&step.state_json)?;
                let key = format!("clipsx-{job_id}-{}", step.id);
                let inserted = sqlx::query("INSERT INTO extension_job_steps(job_id,ordinal,step_id,kind,request_json,state_json,idempotency_key,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'prepared',?,? WHERE EXISTS(SELECT 1 FROM extension_jobs WHERE id=? AND claim_generation=? AND status='running')")
                    .bind(job_id).bind(ordinal).bind(&step.id).bind(kind_name(step.kind)).bind(&step.request_json).bind(&step.state_json).bind(&key).bind(now_ms()).bind(now_ms()).bind(job_id).bind(claim).execute(&repo.pool).await?.rows_affected();
                if inserted != 1 {
                    bail!("operation step claim expired");
                }
                let response =
                    send_step(repo, job_id, claim, ordinal, &step, &key, &broker).await?;
                state = step.state_json;
                previous_was_model = step.kind == StepKind::ModelCall;
                previous = Some(response);
                ordinal += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{
        CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
    };

    #[test]
    fn guest_failure_keeps_its_typed_cause() {
        let error = anyhow::Error::new(GuestExecutionError(FailureCode::InvalidInput.failure()))
            .context("private context");
        assert_eq!(
            OperationFailure::from_error(&error).code,
            FailureCode::InvalidInput
        );
        assert_eq!(
            OperationFailure::from_error(&error).recovery,
            crate::failure::Recovery::Stop
        );
    }

    async fn fixture() -> (tempfile::TempDir, HistoryRepository, String, String) {
        let temp = tempfile::tempdir().unwrap();
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
                    source_app_id: None,
                    source_app_name: None,
                    format_observations: vec![],
                    representations: vec![CapturedRepresentation {
                        format_key: "mime:text/plain".into(),
                        canonical_mime_type: Some("text/plain".into()),
                        native_type: None,
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Text("input".into()),
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
        let request = serde_json::from_value(serde_json::json!({ "clipId": clip_id, "sourceId": source_id, "transformerId": "example.tool/run", "parameters": {} })).unwrap();
        let job = super::super::jobs::enqueue(
            &repo,
            request,
            "example.tool",
            &"a".repeat(64),
            "1.0.0",
            0,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE extension_jobs SET status='running',claim_generation=1 WHERE id=?")
            .bind(&job.job_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        (temp, repo, job.job_id, clip_id)
    }

    async fn sending(repo: &HistoryRepository, job: &str, ordinal: i64, kind: &str) {
        sqlx::query("INSERT INTO extension_job_steps(job_id,ordinal,step_id,kind,request_json,state_json,idempotency_key,dispatch_claim,status,created_at,updated_at) VALUES(?,?,?,?,'{}','{}',?,1,'sending',0,0)")
            .bind(job).bind(ordinal).bind(format!("step-{ordinal}")).bind(kind).bind(format!("key-{ordinal}")).execute(&repo.pool).await.unwrap();
    }

    #[tokio::test]
    async fn failures_preserve_reason_across_retries_reopen_and_delivery_review() {
        let (temp, repo, job, _) = fixture().await;
        super::super::jobs::record_failure(
            &repo,
            &job,
            1,
            FailureCode::ConnectionUnavailable.failure(),
        )
        .await
        .unwrap();
        let row: (String, String, i64) = sqlx::query_as(
            "SELECT status,reason_code,transient_retry_count FROM extension_jobs WHERE id=?",
        )
        .bind(&job)
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert_eq!(row, ("pending".into(), "connection_unavailable".into(), 1));
        sqlx::query(
            "UPDATE extension_jobs SET status='running',transient_retry_count=3 WHERE id=?",
        )
        .bind(&job)
        .execute(&repo.pool)
        .await
        .unwrap();
        super::super::jobs::record_failure(
            &repo,
            &job,
            1,
            FailureCode::ConnectionUnavailable.failure(),
        )
        .await
        .unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        let reopened = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let row: (String, String) =
            sqlx::query_as("SELECT status,reason_code FROM extension_jobs WHERE id=?")
                .bind(&job)
                .fetch_one(&reopened.pool)
                .await
                .unwrap();
        assert_eq!(
            row,
            (
                "failed".into(),
                "retry_exhausted:connection_unavailable".into()
            )
        );
        sqlx::query("UPDATE extension_jobs SET status='running' WHERE id=?")
            .bind(&job)
            .execute(&repo.pool)
            .await
            .unwrap();
        super::super::jobs::record_failure(&repo, &job, 1, FailureCode::InputLimit.failure())
            .await
            .unwrap();
        let row: (String, String) =
            sqlx::query_as("SELECT status,reason_code FROM extension_jobs WHERE id=?")
                .bind(&job)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(row, ("failed".into(), "input_limit".into()));
        sqlx::query("UPDATE extension_jobs SET status='waiting_write_review',reason_code='write_outcome_unknown' WHERE id=?").bind(&job).execute(&repo.pool).await.unwrap();
        super::super::jobs::record_failure(&repo, &job, 1, FailureCode::ProviderTimeout.failure())
            .await
            .unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM extension_jobs WHERE id=?")
            .bind(&job)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(status, "waiting_write_review");
    }

    #[tokio::test]
    async fn only_the_authoritative_terminal_transition_owns_a_report() {
        let (_temp, repo, job, _) = fixture().await;
        assert!(!super::super::jobs::record_failure(
            &repo,
            &job,
            1,
            FailureCode::ProviderTimeout.failure()
        )
        .await
        .unwrap());
        sqlx::query(
            "UPDATE extension_jobs SET status='running',transient_retry_count=3 WHERE id=?",
        )
        .bind(&job)
        .execute(&repo.pool)
        .await
        .unwrap();
        assert!(super::super::jobs::record_failure(
            &repo,
            &job,
            1,
            FailureCode::ProviderTimeout.failure()
        )
        .await
        .unwrap());
        assert!(!super::super::jobs::record_failure(
            &repo,
            &job,
            1,
            FailureCode::ProviderTimeout.failure()
        )
        .await
        .unwrap());
        sqlx::query("UPDATE extension_jobs SET status='running',claim_generation=2 WHERE id=?")
            .bind(&job)
            .execute(&repo.pool)
            .await
            .unwrap();
        assert!(!super::super::jobs::record_failure(
            &repo,
            &job,
            1,
            FailureCode::ExtensionTrap.failure()
        )
        .await
        .unwrap());
        assert!(!super::super::jobs::record_failure(
            &repo,
            &job,
            2,
            FailureCode::ProviderCancelled.failure()
        )
        .await
        .unwrap());
        let status: String = sqlx::query_scalar("SELECT status FROM extension_jobs WHERE id=?")
            .bind(&job)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(status, "cancelled");
    }

    #[tokio::test]
    async fn records_known_delivery_even_after_cancellation_and_fences_duplicate_completion() {
        let (_temp, repo, job, _) = fixture().await;
        sending(&repo, &job, 0, "write").await;
        sqlx::query("UPDATE extension_jobs SET status='cancelled',claim_generation=2 WHERE id=?")
            .bind(&job)
            .execute(&repo.pool)
            .await
            .unwrap();
        finish_step(&repo, &job, 1, 0, "{\"recordId\":\"first\"}")
            .await
            .unwrap();
        assert!(finish_step(&repo, &job, 2, 0, "{\"recordId\":\"second\"}")
            .await
            .is_err());
        let saved: String =
            sqlx::query_scalar("SELECT response_json FROM extension_job_steps WHERE job_id=?")
                .bind(&job)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert!(saved.contains("first"));
    }

    #[tokio::test]
    async fn uncertain_write_stays_paused_after_restart() {
        let (_temp, repo, job, _) = fixture().await;
        sending(&repo, &job, 0, "write").await;
        mark_unknown(&repo, &job, 1, 0).await.unwrap();
        super::super::jobs::recover(&repo).await.unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM extension_jobs WHERE id=?")
            .bind(&job)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(status, "waiting_write_review");
        let status: String =
            sqlx::query_scalar("SELECT status FROM extension_job_steps WHERE job_id=?")
                .bind(&job)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(status, "unknown");
    }

    #[tokio::test]
    async fn journals_two_writes_with_processing_between_and_cascades_on_source_delete() {
        let (_temp, repo, job, clip) = fixture().await;
        for (ordinal, kind) in [(0, "write"), (1, "model_call"), (2, "write")] {
            sending(&repo, &job, ordinal, kind).await;
            finish_step(
                &repo,
                &job,
                1,
                ordinal,
                &serde_json::json!({"step":ordinal}).to_string(),
            )
            .await
            .unwrap();
        }
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM extension_job_steps WHERE job_id=? AND status='completed' AND kind='write'").bind(&job).fetch_one(&repo.pool).await.unwrap();
        assert_eq!(count, 2);
        sqlx::query("DELETE FROM clip_items WHERE id=?")
            .bind(&clip)
            .execute(&repo.pool)
            .await
            .unwrap();
        assert!(finish_step(&repo, &job, 1, 2, "{}").await.is_err());
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM extension_job_steps WHERE job_id=?")
                .bind(&job)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
    }
}
