//! Artifact scheduling, persistence, and built-in execution host.
use crate::{
    contracts::OcrPresentation,
    foundation::ManagedFileStore,
    history::repository::safe_relative,
    history::{new_id, now_ms, sha256, HistoryRepository},
    providers::{
        contracts::{
            ocr::{OcrProvider, OcrProviderDiagnostics},
            visual_embedding::VisualInput,
        },
        native_ocr::{resolve_language, NativeOcrProvider, NATIVE_OCR_PROVIDER_ID},
    },
};
use anyhow::{bail, Context, Result};
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{path::PathBuf, sync::Arc};

const THUMBNAIL_MAX_EDGE: u32 = 512;
const THUMBNAIL_PRODUCER_ID: &str = "builtin.artifact.thumbnail";
const THUMBNAIL_PRODUCER_VERSION: &str = "1";
const OCR_PRODUCER_ID: &str = "builtin.artifact.ocr";
const OCR_PRODUCER_VERSION: &str = "3";
const OCR_MAX_INPUT_BYTES: usize = 20 * 1024 * 1024;
const OCR_MAX_DIMENSION: u32 = 10_000;
const OCR_MAX_PIXELS: u64 = 40_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrSettings {
    pub enabled: bool,
    pub language: String,
}

impl Default for OcrSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            language: "auto".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrRuntimeStatus {
    pub settings: OcrSettings,
    pub provider: OcrProviderDiagnostics,
    pub selected_language: Option<String>,
    pub pending_jobs: u32,
    pub running_jobs: u32,
    pub failed_jobs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedOcrWork {
    pub clip_id: String,
    pub representation_id: String,
}

/// Stable descriptor for a host-owned derived-data producer. Future extension
/// packages use the same descriptor, but never receive direct database access.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactProducerDescriptor {
    pub id: &'static str,
    pub version: &'static str,
    pub artifact_kind: &'static str,
}

/// The registry is deliberately explicit: artifact scheduling depends on this
/// list rather than a single hard-coded "do everything" implementation.
pub fn registered_producers() -> &'static [ArtifactProducerDescriptor] {
    static PRODUCERS: [ArtifactProducerDescriptor; 2] = [
        ArtifactProducerDescriptor {
            id: THUMBNAIL_PRODUCER_ID,
            version: THUMBNAIL_PRODUCER_VERSION,
            artifact_kind: "thumbnail",
        },
        ArtifactProducerDescriptor {
            id: OCR_PRODUCER_ID,
            version: OCR_PRODUCER_VERSION,
            artifact_kind: "ocr",
        },
    ];
    &PRODUCERS
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Produce thumbnails and persist OCR work for all raster representations in a clip.
pub async fn produce_for_clip(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    let reps = raster_representations(repo, clip_id).await?;
    for (rep_id, binary_id) in reps {
        let _ = produce_thumbnail(repo, clip_id, &rep_id, &binary_id).await;
        if ocr_settings(repo).await?.enabled {
            enqueue_ocr(repo, &rep_id).await?;
        }
    }
    Ok(())
}

pub async fn ocr_settings(repo: &HistoryRepository) -> Result<OcrSettings> {
    let rows = sqlx::query("SELECT key,value_json FROM config_profile_values WHERE key IN ('artifacts.ocr.enabled','artifacts.ocr.language')")
        .fetch_all(&repo.pool)
        .await?;
    let mut settings = OcrSettings::default();
    for row in rows {
        let key: String = row.get(0);
        let value: String = row.get(1);
        match key.as_str() {
            "artifacts.ocr.enabled" => settings.enabled = serde_json::from_str(&value)?,
            "artifacts.ocr.language" => settings.language = serde_json::from_str(&value)?,
            _ => {}
        }
    }
    validate_language_preference(&settings.language)?;
    Ok(settings)
}

pub async fn ocr_runtime_status(repo: &HistoryRepository) -> Result<OcrRuntimeStatus> {
    let settings = ocr_settings(repo).await?;
    let mut provider = NativeOcrProvider::new()
        .diagnostics()
        .await
        .unwrap_or_else(|error| OcrProviderDiagnostics {
            provider_id: NATIVE_OCR_PROVIDER_ID.into(),
            provider_version: "unavailable".into(),
            available: false,
            languages: Vec::new(),
            recovery_code: Some(error.code().into()),
            recovery_message: Some(error.to_string()),
        });
    let selected_language = resolve_language(
        &settings.language,
        &app_language(repo).await?,
        &provider.languages,
    );
    if settings.language != "auto" && selected_language.is_none() {
        provider.recovery_code = Some("ocr_language_missing".into());
        provider.recovery_message = Some(format!(
            "The synchronized OCR language {} is not installed on this device. Install it or choose Automatic.",
            settings.language
        ));
    }
    let rows = sqlx::query("SELECT status,count(*) FROM artifact_jobs WHERE artifact_kind='ocr' AND producer_id=? AND producer_version=? GROUP BY status")
        .bind(OCR_PRODUCER_ID)
        .bind(OCR_PRODUCER_VERSION)
        .fetch_all(&repo.pool)
        .await?;
    let (mut pending_jobs, mut running_jobs, mut failed_jobs) = (0, 0, 0);
    for row in rows {
        let count = row.get::<i64, _>(1).clamp(0, i64::from(u32::MAX)) as u32;
        match row.get::<String, _>(0).as_str() {
            "pending" => pending_jobs = count,
            "running" => running_jobs = count,
            "failed" => failed_jobs = count,
            _ => {}
        }
    }
    Ok(OcrRuntimeStatus {
        settings,
        provider,
        selected_language,
        pending_jobs,
        running_jobs,
        failed_jobs,
    })
}

pub async fn update_ocr_settings(repo: &HistoryRepository, settings: &OcrSettings) -> Result<()> {
    validate_language_preference(&settings.language)?;
    if settings.language != "auto" {
        let diagnostics = NativeOcrProvider::new().diagnostics().await?;
        if diagnostics.available
            && !diagnostics
                .languages
                .iter()
                .any(|language| language.id.eq_ignore_ascii_case(&settings.language))
        {
            bail!("selected OCR language is not installed");
        }
    }
    let previous = ocr_settings(repo).await?;
    let now = now_ms();
    let mut transaction = repo.pool.begin().await?;
    for (key, value) in [
        (
            "artifacts.ocr.enabled",
            serde_json::to_string(&settings.enabled)?,
        ),
        (
            "artifacts.ocr.language",
            serde_json::to_string(&settings.language)?,
        ),
    ] {
        let prior: Option<String> =
            sqlx::query_scalar("SELECT value_json FROM config_profile_values WHERE key=?")
                .bind(key)
                .fetch_optional(&mut *transaction)
                .await?;
        sqlx::query("INSERT INTO config_profile_values(key,value_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
            .bind(key)
            .bind(&value)
            .bind(now)
            .bind(now)
            .execute(&mut *transaction)
            .await?;
        if prior.as_deref() != Some(value.as_str()) {
            HistoryRepository::enqueue_profile_sync(&mut transaction, key, &value, now).await?;
        }
    }
    if previous != *settings {
        sqlx::query("UPDATE artifact_jobs SET status='cancelled',updated_at=?,completed_at=? WHERE artifact_kind='ocr' AND producer_id=? AND status IN ('pending','running')")
            .bind(now)
            .bind(now)
            .bind(OCR_PRODUCER_ID)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("UPDATE artifact_records SET lifecycle_state='invalidated',updated_at=? WHERE producer_id=? AND lifecycle_state='ready'")
            .bind(now)
            .bind(OCR_PRODUCER_ID)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    if settings.enabled && previous != *settings {
        enqueue_all_ocr(repo).await?;
    }
    Ok(())
}

pub async fn recover_ocr_queue(repo: &HistoryRepository) -> Result<()> {
    sqlx::query("UPDATE artifact_jobs SET status='pending',started_at=NULL,updated_at=?,last_error='Recovered after ClipsX restarted' WHERE artifact_kind='ocr' AND producer_id=? AND status='running'")
        .bind(now_ms())
        .bind(OCR_PRODUCER_ID)
        .execute(&repo.pool)
        .await?;
    if ocr_settings(repo).await?.enabled {
        enqueue_all_ocr(repo).await?;
    }
    Ok(())
}

pub async fn reconcile_ocr_settings(
    repo: &HistoryRepository,
    previous: &OcrSettings,
) -> Result<()> {
    let current = ocr_settings(repo).await?;
    if current == *previous {
        return Ok(());
    }
    let now = now_ms();
    let mut transaction = repo.pool.begin().await?;
    sqlx::query("UPDATE artifact_jobs SET status='cancelled',updated_at=?,completed_at=? WHERE artifact_kind='ocr' AND producer_id=? AND status IN ('pending','running')")
        .bind(now)
        .bind(now)
        .bind(OCR_PRODUCER_ID)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE artifact_records SET lifecycle_state='invalidated',updated_at=? WHERE producer_id=? AND lifecycle_state='ready'")
        .bind(now)
        .bind(OCR_PRODUCER_ID)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    if current.enabled {
        enqueue_all_ocr(repo).await?;
    }
    Ok(())
}

pub async fn ocr_clip_ids(repo: &HistoryRepository) -> Result<Vec<String>> {
    sqlx::query_scalar(
        "SELECT DISTINCT clip_id FROM clip_representations WHERE lifecycle_state='ready' \
         AND storage_kind='binary_asset' AND canonical_mime_type LIKE 'image/%'",
    )
    .fetch_all(&repo.pool)
    .await
    .map_err(Into::into)
}

async fn app_language(repo: &HistoryRepository) -> Result<String> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM config_profile_values WHERE key='ui.language'")
            .fetch_optional(&repo.pool)
            .await?;
    Ok(value
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(|| "en".into()))
}

fn validate_language_preference(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 35
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        bail!("OCR language preference is invalid");
    }
    Ok(())
}

pub async fn ocr_presentation(
    repo: &HistoryRepository,
    representation_id: &str,
) -> Result<OcrPresentation> {
    if !ocr_settings(repo).await?.enabled {
        return Ok(OcrPresentation::Disabled);
    }
    let ready: Option<String> = sqlx::query_scalar(
        "SELECT atv.text_value FROM artifact_records ar \
         JOIN artifact_inputs ai ON ai.artifact_id=ar.id \
         JOIN artifact_text_values atv ON atv.artifact_id=ar.id \
         WHERE ai.representation_id=? AND ar.producer_id=? AND ar.producer_version=? \
         AND ar.lifecycle_state='ready' ORDER BY ar.updated_at DESC LIMIT 1",
    )
    .bind(representation_id)
    .bind(OCR_PRODUCER_ID)
    .bind(OCR_PRODUCER_VERSION)
    .fetch_optional(&repo.pool)
    .await?;
    if let Some(text) = ready {
        return Ok(OcrPresentation::Ready { text });
    }
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM artifact_jobs WHERE target_representation_id=? \
         AND producer_id=? AND producer_version=? ORDER BY requested_at DESC,id DESC LIMIT 1",
    )
    .bind(representation_id)
    .bind(OCR_PRODUCER_ID)
    .bind(OCR_PRODUCER_VERSION)
    .fetch_optional(&repo.pool)
    .await?;
    Ok(match status.as_deref() {
        Some("running") => OcrPresentation::Running,
        Some("unsupported") => OcrPresentation::Unsupported,
        Some("failed" | "cancelled") => OcrPresentation::Failed {
            message: "Text recognition failed".into(),
        },
        Some("completed") => OcrPresentation::Ready {
            text: String::new(),
        },
        _ => OcrPresentation::Pending,
    })
}

pub async fn retry_ocr(
    repo: &HistoryRepository,
    clip_id: &str,
    representation_id: &str,
) -> Result<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM clip_representations WHERE id=? AND clip_id=? \
         AND lifecycle_state='ready' AND canonical_mime_type LIKE 'image/%' \
         AND storage_kind='binary_asset')",
    )
    .bind(representation_id)
    .bind(clip_id)
    .fetch_one(&repo.pool)
    .await?;
    if !exists {
        bail!("ready image representation not found");
    }
    let now = now_ms();
    sqlx::query("UPDATE artifact_jobs SET status='cancelled',updated_at=?,completed_at=? WHERE artifact_kind='ocr' AND target_representation_id=? AND producer_id=? AND status IN ('pending','running')")
        .bind(now)
        .bind(now)
        .bind(representation_id)
        .bind(OCR_PRODUCER_ID)
        .execute(&repo.pool)
        .await?;
    enqueue_ocr(repo, representation_id).await
}

/// First ready thumbnail artifact-binary-file id for a clip.
#[allow(dead_code)]
pub async fn thumbnail_artifact_id(repo: &HistoryRepository, clip_id: &str) -> Option<String> {
    sqlx::query_scalar(
        "SELECT ab.id \
         FROM artifact_records ar \
         JOIN artifact_inputs ai ON ai.artifact_id = ar.id \
         JOIN artifact_binary_files ab ON ab.artifact_id = ar.id AND ab.lifecycle_state = 'ready' \
         JOIN clip_representations cr ON cr.id = ai.representation_id \
         WHERE cr.clip_id = ? AND ar.producer_id = ? AND ar.producer_version = ? AND ar.lifecycle_state = 'ready' \
         LIMIT 1",
    )
    .bind(clip_id)
    .bind(THUMBNAIL_PRODUCER_ID)
    .bind(THUMBNAIL_PRODUCER_VERSION)
    .fetch_optional(&repo.pool)
    .await
    .ok()
    .flatten()
}

/// OCR text for a clip's first image, if already produced.
pub async fn ocr_text(repo: &HistoryRepository, clip_id: &str) -> Option<String> {
    sqlx::query_scalar(
        "SELECT atv.text_value \
         FROM artifact_records ar \
         JOIN artifact_inputs ai ON ai.artifact_id = ar.id \
         JOIN artifact_text_values atv ON atv.artifact_id = ar.id \
         JOIN clip_representations cr ON cr.id = ai.representation_id \
         WHERE cr.clip_id = ? AND ar.producer_id = ? AND ar.producer_version = ? AND ar.lifecycle_state = 'ready' \
         LIMIT 1",
    )
    .bind(clip_id)
    .bind(OCR_PRODUCER_ID)
    .bind(OCR_PRODUCER_VERSION)
    .fetch_optional(&repo.pool)
    .await
    .ok()
    .flatten()
}

/// Serve an artifact binary file by its artifact_binary_files row id.
pub async fn artifact_binary(
    repo: &HistoryRepository,
    artifact_file_id: &str,
) -> Result<(Vec<u8>, String)> {
    let row = sqlx::query(
        "SELECT ab.sha256, ab.relative_path \
         FROM artifact_binary_files ab \
         WHERE ab.id = ? AND ab.lifecycle_state = 'ready'",
    )
    .bind(artifact_file_id)
    .fetch_optional(&repo.pool)
    .await?
    .context("artifact binary file not found")?;
    let expected: String = row.get(0);
    let relative: String = row.get(1);
    if !safe_relative(&relative) {
        bail!("invalid artifact path");
    }
    let path = repo.managed_root.join(&relative);
    let bytes = std::fs::read(&path)?;
    if sha256(&bytes) != expected {
        bail!("artifact binary hash mismatch");
    }
    Ok((bytes, "image/png".into()))
}

// ─── Thumbnail ───────────────────────────────────────────────────────────────

async fn produce_thumbnail(
    repo: &HistoryRepository,
    clip_id: &str,
    rep_id: &str,
    binary_id: &str,
) -> Result<()> {
    let param_sha = sha256(
        format!("{THUMBNAIL_PRODUCER_ID}:{THUMBNAIL_PRODUCER_VERSION}:{THUMBNAIL_MAX_EDGE}")
            .as_bytes(),
    );
    let input_sha = binary_sha256_for(repo, binary_id).await?;
    let input_manifest = sha256(format!("{rep_id}:{input_sha}").as_bytes());

    if artifact_exists(repo, THUMBNAIL_PRODUCER_ID, rep_id, &param_sha).await? {
        return Ok(());
    }
    let job_id = claim_job(
        repo,
        "thumbnail",
        rep_id,
        THUMBNAIL_PRODUCER_ID,
        THUMBNAIL_PRODUCER_VERSION,
        &param_sha,
    )
    .await?;

    let (bytes, _) = repo.asset(binary_id).await?;
    match make_thumbnail(&bytes) {
        Ok(png) => {
            let art_sha = sha256(&png);
            let relative = PathBuf::from("managed")
                .join("derived")
                .join(&art_sha[..2])
                .join(&art_sha);
            let store = ManagedFileStore::new(repo.managed_root.clone())?;
            let staged = store.stage("derived", &png)?;
            store.commit(staged)?;

            let art_id = new_id();
            let now = now_ms();
            let mut tx = repo.pool.begin().await?;
            sqlx::query(
                "INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,\
                 parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) \
                 VALUES(?,?,?,?,?,?,?,'pending',?,?)",
            )
            .bind(&art_id)
            .bind(clip_id)
            .bind("thumbnail")
            .bind(THUMBNAIL_PRODUCER_ID)
            .bind(THUMBNAIL_PRODUCER_VERSION)
            .bind(&param_sha)
            .bind(&input_manifest)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256) \
                 VALUES(?,0,?,?)",
            )
            .bind(&art_id)
            .bind(rep_id)
            .bind(&input_sha)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO artifact_binary_files(id,artifact_id,sha256,byte_length,relative_path,\
                 lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?)",
            )
            .bind(new_id())
            .bind(&art_id)
            .bind(&art_sha)
            .bind(png.len() as i64)
            .bind(relative.to_string_lossy().replace('\\', "/"))
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE artifact_records SET lifecycle_state='ready',updated_at=? WHERE id=?",
            )
            .bind(now)
            .bind(&art_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE artifact_jobs SET status='completed',produced_artifact_id=?,completed_at=? \
                 WHERE id=?",
            )
            .bind(&art_id)
            .bind(now)
            .bind(&job_id)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
        }
        Err(_) => {
            set_job_state(repo, &job_id, "unsupported", None).await?;
        }
    }
    Ok(())
}

fn make_thumbnail(bytes: &[u8]) -> Result<Vec<u8>> {
    use image::{imageops::FilterType, GenericImageView};
    let img = image::load_from_memory(bytes).context("unsupported image format")?;
    let (w, h) = img.dimensions();
    let thumb = if w > THUMBNAIL_MAX_EDGE || h > THUMBNAIL_MAX_EDGE {
        img.resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, FilterType::Lanczos3)
    } else {
        img
    };
    let mut out = Vec::new();
    thumb.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)?;
    Ok(out)
}

// ─── OCR ─────────────────────────────────────────────────────────────────────

async fn enqueue_ocr(repo: &HistoryRepository, representation_id: &str) -> Result<()> {
    let parameter_sha =
        sha256(format!("{OCR_PRODUCER_ID}:{OCR_PRODUCER_VERSION}:pending").as_bytes());
    let now = now_ms();
    sqlx::query("INSERT OR IGNORE INTO artifact_jobs(id,artifact_kind,target_representation_id,producer_id,producer_version,parameter_sha256,status,requested_at,created_at,updated_at) VALUES(?,'ocr',?,?,?,?,'pending',?,?,?)")
        .bind(new_id())
        .bind(representation_id)
        .bind(OCR_PRODUCER_ID)
        .bind(OCR_PRODUCER_VERSION)
        .bind(parameter_sha)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(&repo.pool)
        .await?;
    Ok(())
}

async fn enqueue_all_ocr(repo: &HistoryRepository) -> Result<()> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM clip_representations WHERE lifecycle_state='ready' AND storage_kind='binary_asset' AND canonical_mime_type LIKE 'image/%'")
        .fetch_all(&repo.pool)
        .await?;
    for id in ids {
        enqueue_ocr(repo, &id).await?;
    }
    Ok(())
}

pub async fn run_next_ocr(repo: &HistoryRepository) -> Result<Option<CompletedOcrWork>> {
    run_next_ocr_with_provider(repo, &NativeOcrProvider::new()).await
}

async fn run_next_ocr_with_provider(
    repo: &HistoryRepository,
    provider: &dyn OcrProvider,
) -> Result<Option<CompletedOcrWork>> {
    let mut transaction = repo.pool.begin().await?;
    let row = sqlx::query("SELECT j.id,r.clip_id,r.id,r.binary_file_id,r.canonical_mime_type FROM artifact_jobs j JOIN clip_representations r ON r.id=j.target_representation_id WHERE j.artifact_kind='ocr' AND j.producer_id=? AND j.status='pending' ORDER BY j.requested_at,j.id LIMIT 1")
        .bind(OCR_PRODUCER_ID)
        .fetch_optional(&mut *transaction)
        .await?;
    let Some(row) = row else {
        transaction.commit().await?;
        return Ok(None);
    };
    let job_id: String = row.get(0);
    let clip_id: String = row.get(1);
    let representation_id: String = row.get(2);
    let binary_id: String = row.get(3);
    let mime_type: String = row.get(4);
    let now = now_ms();
    let updated = sqlx::query("UPDATE artifact_jobs SET status='running',attempt_count=attempt_count+1,started_at=?,updated_at=?,last_error=NULL WHERE id=? AND status='pending'")
        .bind(now).bind(now).bind(&job_id).execute(&mut *transaction).await?.rows_affected();
    transaction.commit().await?;
    if updated == 0 {
        return Ok(None);
    }
    let completed = CompletedOcrWork {
        clip_id: clip_id.clone(),
        representation_id: representation_id.clone(),
    };

    let settings = ocr_settings(repo).await?;
    if !settings.enabled {
        set_job_state(repo, &job_id, "cancelled", None).await?;
        return Ok(Some(completed));
    }
    let diagnostics = match provider.diagnostics().await {
        Ok(value) if value.available => value,
        Ok(value) => {
            set_job_state(
                repo,
                &job_id,
                "unsupported",
                value.recovery_message.as_deref(),
            )
            .await?;
            return Ok(Some(completed));
        }
        Err(error) => {
            set_job_state(repo, &job_id, "unsupported", Some(&error.to_string())).await?;
            return Ok(Some(completed));
        }
    };
    let Some(language) = resolve_language(
        &settings.language,
        &app_language(repo).await?,
        &diagnostics.languages,
    ) else {
        set_job_state(
            repo,
            &job_id,
            "unsupported",
            Some("No compatible OCR language is installed"),
        )
        .await?;
        return Ok(Some(completed));
    };
    let parameter_sha = sha256(
        format!(
            "{OCR_PRODUCER_ID}:{OCR_PRODUCER_VERSION}:{}:{}",
            diagnostics.provider_version, language
        )
        .as_bytes(),
    );
    sqlx::query("UPDATE artifact_jobs SET parameter_sha256=?,updated_at=? WHERE id=?")
        .bind(&parameter_sha)
        .bind(now_ms())
        .bind(&job_id)
        .execute(&repo.pool)
        .await?;
    if let Some(artifact_id) =
        existing_artifact_id(repo, OCR_PRODUCER_ID, &representation_id, &parameter_sha).await?
    {
        if !complete_job(repo, &job_id, &artifact_id).await? {
            set_job_state(repo, &job_id, "cancelled", None).await?;
        }
        return Ok(Some(completed));
    }
    let (bytes, _) = repo.asset(&binary_id).await?;
    let input_sha = binary_sha256_for(repo, &binary_id).await?;
    let input = match bounded_visual_input(bytes, mime_type, input_sha.clone()) {
        Ok(value) => value,
        Err(error) => {
            set_job_state(repo, &job_id, "failed", Some(&error.to_string())).await?;
            return Ok(Some(completed));
        }
    };
    let text = match provider.recognize(&input, &language).await {
        Ok(value) => value,
        Err(error) => {
            set_job_state(repo, &job_id, "failed", Some(&error.to_string())).await?;
            return Ok(Some(completed));
        }
    };
    if !persist_ocr_result(
        repo,
        OcrPersistence {
            job_id: &job_id,
            clip_id: &clip_id,
            representation_id: &representation_id,
            input_sha: &input_sha,
            parameter_sha: &parameter_sha,
            expected_settings: &settings,
            text: &text,
        },
    )
    .await?
    {
        set_job_state(repo, &job_id, "cancelled", None).await?;
    }
    Ok(Some(completed))
}

fn bounded_visual_input(
    bytes: Vec<u8>,
    mime_type: String,
    input_sha: String,
) -> Result<VisualInput> {
    if bytes.is_empty() || bytes.len() > OCR_MAX_INPUT_BYTES {
        bail!("OCR input must contain between 1 byte and 20 MiB");
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(&bytes));
    reader.set_format(image::guess_format(&bytes).context("unsupported OCR image format")?);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(OCR_MAX_DIMENSION);
    limits.max_image_height = Some(OCR_MAX_DIMENSION);
    limits.max_alloc = Some(OCR_MAX_PIXELS * 4);
    reader.limits(limits);
    let image = reader
        .decode()
        .context("unable to decode bounded OCR image")?;
    let (width, height) = image.dimensions();
    if u64::from(width) * u64::from(height) > OCR_MAX_PIXELS {
        bail!("OCR image exceeds the 40 megapixel limit");
    }
    Ok(VisualInput {
        bytes: Arc::from(bytes),
        mime_type,
        sha256: input_sha,
        width,
        height,
    })
}

struct OcrPersistence<'a> {
    job_id: &'a str,
    clip_id: &'a str,
    representation_id: &'a str,
    input_sha: &'a str,
    parameter_sha: &'a str,
    expected_settings: &'a OcrSettings,
    text: &'a str,
}

async fn persist_ocr_result(repo: &HistoryRepository, result: OcrPersistence<'_>) -> Result<bool> {
    let OcrPersistence {
        job_id,
        clip_id,
        representation_id,
        input_sha,
        parameter_sha,
        expected_settings,
        text,
    } = result;
    let artifact_id = new_id();
    let now = now_ms();
    let input_manifest = sha256(format!("{representation_id}:{input_sha}").as_bytes());
    let mut transaction = repo.pool.begin().await?;
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM artifact_jobs WHERE id=?")
        .bind(job_id)
        .fetch_optional(&mut *transaction)
        .await?;
    let enabled: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='artifacts.ocr.enabled'",
    )
    .fetch_optional(&mut *transaction)
    .await?;
    let language: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='artifacts.ocr.language'",
    )
    .fetch_optional(&mut *transaction)
    .await?;
    let current_settings = OcrSettings {
        enabled: enabled
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or(true),
        language: language
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or_else(|| "auto".into()),
    };
    if status.as_deref() != Some("running") || current_settings != *expected_settings {
        transaction.rollback().await?;
        return Ok(false);
    }
    sqlx::query("INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
        .bind(&artifact_id).bind(clip_id).bind("ocr").bind(OCR_PRODUCER_ID).bind(OCR_PRODUCER_VERSION)
        .bind(parameter_sha).bind(input_manifest).bind(now).bind(now).execute(&mut *transaction).await?;
    sqlx::query("INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256) VALUES(?,0,?,?)")
        .bind(&artifact_id).bind(representation_id).bind(input_sha).execute(&mut *transaction).await?;
    sqlx::query("INSERT INTO artifact_text_values(artifact_id,text_value,utf8_byte_length,sha256) VALUES(?,?,?,?)")
        .bind(&artifact_id).bind(text).bind(text.len() as i64).bind(sha256(text.as_bytes())).execute(&mut *transaction).await?;
    sqlx::query("UPDATE artifact_records SET lifecycle_state='ready',updated_at=? WHERE id=?")
        .bind(now)
        .bind(&artifact_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE artifact_jobs SET status='completed',produced_artifact_id=?,updated_at=?,completed_at=? WHERE id=? AND status='running'")
        .bind(&artifact_id).bind(now).bind(now).bind(job_id).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(true)
}

async fn complete_job(repo: &HistoryRepository, job_id: &str, artifact_id: &str) -> Result<bool> {
    let now = now_ms();
    let changed = sqlx::query("UPDATE artifact_jobs SET status='completed',produced_artifact_id=?,updated_at=?,completed_at=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM artifact_records WHERE id=? AND lifecycle_state='ready')")
        .bind(artifact_id).bind(now).bind(now).bind(job_id).bind(artifact_id).execute(&repo.pool).await?.rows_affected();
    Ok(changed == 1)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async fn raster_representations(
    repo: &HistoryRepository,
    clip_id: &str,
) -> Result<Vec<(String, String)>> {
    let rows = sqlx::query(
        "SELECT r.id, r.binary_file_id \
         FROM clip_representations r \
         JOIN clip_items c ON c.id = r.clip_id \
         WHERE r.clip_id = ? \
           AND r.lifecycle_state = 'ready' \
           AND r.storage_kind = 'binary_asset' \
           AND r.binary_file_id IS NOT NULL \
           AND c.lifecycle_state = 'ready' \
           AND (r.canonical_mime_type LIKE 'image/%' \
                OR r.format_key LIKE '%PNG%' \
                OR r.format_key LIKE '%JPEG%' \
                OR r.format_key LIKE '%BMP%' \
                OR r.format_key LIKE '%GIF%' \
                OR r.format_key LIKE '%TIFF%')",
    )
    .bind(clip_id)
    .fetch_all(&repo.pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let rep_id: String = r.get(0);
            let bin_id: Option<String> = r.get(1);
            bin_id.map(|b| (rep_id, b))
        })
        .collect())
}

async fn binary_sha256_for(repo: &HistoryRepository, binary_id: &str) -> Result<String> {
    sqlx::query_scalar("SELECT sha256 FROM clip_binary_files WHERE id=?")
        .bind(binary_id)
        .fetch_one(&repo.pool)
        .await
        .context("binary file not found")
}

async fn artifact_exists(
    repo: &HistoryRepository,
    producer_id: &str,
    rep_id: &str,
    parameter_sha256: &str,
) -> Result<bool> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(\
         SELECT 1 FROM artifact_records ar \
         JOIN artifact_inputs ai ON ai.artifact_id = ar.id \
         WHERE ar.producer_id = ? \
           AND ai.representation_id = ? \
           AND ar.parameter_sha256 = ? \
           AND ar.lifecycle_state IN ('ready','unsupported'))",
    )
    .bind(producer_id)
    .bind(rep_id)
    .bind(parameter_sha256)
    .fetch_one(&repo.pool)
    .await?;
    Ok(exists)
}

async fn existing_artifact_id(
    repo: &HistoryRepository,
    producer_id: &str,
    rep_id: &str,
    parameter_sha256: &str,
) -> Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT ar.id FROM artifact_records ar JOIN artifact_inputs ai ON ai.artifact_id=ar.id \
         WHERE ar.producer_id=? AND ai.representation_id=? AND ar.parameter_sha256=? \
         AND ar.lifecycle_state='ready' ORDER BY ar.updated_at DESC LIMIT 1",
    )
    .bind(producer_id)
    .bind(rep_id)
    .bind(parameter_sha256)
    .fetch_optional(&repo.pool)
    .await
    .map_err(Into::into)
}

async fn claim_job(
    repo: &HistoryRepository,
    kind: &str,
    rep_id: &str,
    producer_id: &str,
    producer_version: &str,
    parameter_sha256: &str,
) -> Result<String> {
    let job_id = new_id();
    let now = now_ms();
    sqlx::query(
        "INSERT OR IGNORE INTO artifact_jobs(\
         id,artifact_kind,target_representation_id,producer_id,producer_version,\
         parameter_sha256,status,requested_at) \
         VALUES(?,?,?,?,?,?,'running',?)",
    )
    .bind(&job_id)
    .bind(kind)
    .bind(rep_id)
    .bind(producer_id)
    .bind(producer_version)
    .bind(parameter_sha256)
    .bind(now)
    .execute(&repo.pool)
    .await?;
    Ok(job_id)
}

async fn set_job_state(
    repo: &HistoryRepository,
    job_id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<()> {
    let now = now_ms();
    sqlx::query(
        "UPDATE artifact_jobs SET status=?,last_error=?,updated_at=?,completed_at=? WHERE id=?",
    )
    .bind(status)
    .bind(error.map(|value| value.chars().take(512).collect::<String>()))
    .bind(now)
    .bind(now)
    .bind(job_id)
    .execute(&repo.pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{
        CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
    };

    async fn image_fixture() -> (tempfile::TempDir, HistoryRepository, String) {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = crate::foundation::AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            32,
            32,
            image::Rgba([255, 255, 255, 255]),
        ))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
        let (clip_id, _) = repo
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: None,
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![CapturedRepresentation {
                        format_key: "windows:PNG".into(),
                        canonical_mime_type: Some("image/png".into()),
                        native_type: Some("PNG".into()),
                        platform: "windows".into(),
                        capture_priority: 1,
                        payload: CapturedPayload::Binary(png),
                    }],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let representation_id = repo.detail(&clip_id).await.unwrap().representations[0]
            .id
            .clone();
        (temp, repo, representation_id)
    }

    #[tokio::test]
    async fn ocr_presentation_maps_lifecycle_and_validates_retry() {
        let (_temp, repo, representation_id) = image_fixture().await;
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Pending
        );
        sqlx::query("INSERT INTO config_profile_values(key,value_json,updated_at) VALUES('artifacts.ocr.enabled','false',?) ON CONFLICT(key) DO UPDATE SET value_json='false',updated_at=excluded.updated_at")
            .bind(now_ms())
            .execute(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Disabled
        );
        sqlx::query("DELETE FROM config_profile_values WHERE key='artifacts.ocr.enabled'")
            .execute(&repo.pool)
            .await
            .unwrap();
        assert!(retry_ocr(&repo, "wrong-clip", &representation_id)
            .await
            .is_err());
        let now = now_ms();
        sqlx::query("INSERT INTO artifact_jobs(id,artifact_kind,target_representation_id,producer_id,producer_version,parameter_sha256,status,last_error,requested_at,completed_at) VALUES('job','ocr',?,?,? ,NULL,'failed','private detail',?,?)")
            .bind(&representation_id)
            .bind(OCR_PRODUCER_ID)
            .bind(OCR_PRODUCER_VERSION)
            .bind(now)
            .bind(now)
            .execute(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Failed {
                message: "Text recognition failed".into()
            }
        );
        sqlx::query("UPDATE artifact_jobs SET status='unsupported' WHERE id='job'")
            .execute(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Unsupported
        );
        sqlx::query("UPDATE artifact_jobs SET status='running' WHERE id='job'")
            .execute(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Running
        );
        sqlx::query("INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) SELECT 'artifact',clip_id,'ocr',?,? ,?,?,'ready',?,? FROM clip_representations WHERE id=?")
            .bind(OCR_PRODUCER_ID)
            .bind(OCR_PRODUCER_VERSION)
            .bind("0".repeat(64))
            .bind("1".repeat(64))
            .bind(now)
            .bind(now)
            .bind(&representation_id)
            .execute(&repo.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256) VALUES('artifact',0,?,?)")
            .bind(&representation_id)
            .bind("2".repeat(64))
            .execute(&repo.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO artifact_text_values(artifact_id,text_value,utf8_byte_length,sha256) VALUES('artifact','',0,?)")
            .bind("3".repeat(64))
            .execute(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Ready {
                text: String::new()
            }
        );
    }

    #[derive(Clone)]
    struct FakeOcrProvider {
        diagnostics: OcrProviderDiagnostics,
        result: crate::providers::error::ProviderResult<String>,
    }

    #[async_trait::async_trait]
    impl OcrProvider for FakeOcrProvider {
        fn descriptor(&self) -> crate::providers::contracts::ProviderDescriptor {
            crate::providers::contracts::ProviderDescriptor {
                provider_id: NATIVE_OCR_PROVIDER_ID.into(),
                provider_version: "test".into(),
                model_id: "test".into(),
                model_revision: "test".into(),
            }
        }

        async fn diagnostics(
            &self,
        ) -> crate::providers::error::ProviderResult<OcrProviderDiagnostics> {
            Ok(self.diagnostics.clone())
        }

        async fn recognize(
            &self,
            _input: &VisualInput,
            _language: &str,
        ) -> crate::providers::error::ProviderResult<String> {
            self.result.clone()
        }
    }

    fn fake_provider(result: crate::providers::error::ProviderResult<String>) -> FakeOcrProvider {
        FakeOcrProvider {
            diagnostics: OcrProviderDiagnostics {
                provider_id: NATIVE_OCR_PROVIDER_ID.into(),
                provider_version: "test-engine-1".into(),
                available: true,
                languages: vec![crate::providers::contracts::ocr::OcrLanguage {
                    id: "en-US".into(),
                    label: "English".into(),
                }],
                recovery_code: None,
                recovery_message: None,
            },
            result,
        }
    }

    #[tokio::test]
    async fn persistent_queue_preserves_canonical_image_and_indexes_empty_or_ready_output() {
        let (_temp, repo, representation_id) = image_fixture().await;
        let clip_id: String =
            sqlx::query_scalar("SELECT clip_id FROM clip_representations WHERE id=?")
                .bind(&representation_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let canonical_sha: String = sqlx::query_scalar("SELECT b.sha256 FROM clip_representations r JOIN clip_binary_files b ON b.id=r.binary_file_id WHERE r.id=?")
            .bind(&representation_id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();

        produce_for_clip(&repo, &clip_id).await.unwrap();
        assert_eq!(ocr_runtime_status(&repo).await.unwrap().pending_jobs, 1);
        let provider = fake_provider(Ok("hello from image".into()));
        assert!(run_next_ocr_with_provider(&repo, &provider)
            .await
            .unwrap()
            .is_some());
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Ready {
                text: "hello from image".into()
            }
        );
        crate::search::upsert_projection(&repo, &clip_id)
            .await
            .unwrap();
        let projected: String =
            sqlx::query_scalar("SELECT search_text FROM search_documents WHERE clip_id=?")
                .bind(&clip_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert!(projected.contains("hello from image"));
        let after_sha: String = sqlx::query_scalar("SELECT b.sha256 FROM clip_representations r JOIN clip_binary_files b ON b.id=r.binary_file_id WHERE r.id=?")
            .bind(&representation_id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(canonical_sha, after_sha);

        retry_ocr(&repo, &clip_id, &representation_id)
            .await
            .unwrap();
        run_next_ocr_with_provider(&repo, &provider).await.unwrap();
        let artifact_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM artifact_records WHERE owner_clip_id=? AND producer_id=?",
        )
        .bind(&clip_id)
        .bind(OCR_PRODUCER_ID)
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert_eq!(artifact_count, 1);

        repo.delete(&clip_id).await.unwrap();
        let remaining_jobs: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM artifact_jobs WHERE target_representation_id=?",
        )
        .bind(&representation_id)
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert_eq!(remaining_jobs, 0);
    }

    #[tokio::test]
    async fn disabled_and_unavailable_ocr_end_in_explicit_terminal_states() {
        let (_temp, repo, representation_id) = image_fixture().await;
        let clip_id: String =
            sqlx::query_scalar("SELECT clip_id FROM clip_representations WHERE id=?")
                .bind(&representation_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        produce_for_clip(&repo, &clip_id).await.unwrap();
        sqlx::query(
            "UPDATE config_profile_values SET value_json='false' WHERE key='artifacts.ocr.enabled'",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        run_next_ocr_with_provider(&repo, &fake_provider(Ok(String::new())))
            .await
            .unwrap();
        let status: String = sqlx::query_scalar(
            "SELECT status FROM artifact_jobs ORDER BY requested_at DESC LIMIT 1",
        )
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert_eq!(status, "cancelled");

        sqlx::query(
            "UPDATE config_profile_values SET value_json='true' WHERE key='artifacts.ocr.enabled'",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        enqueue_ocr(&repo, &representation_id).await.unwrap();
        let mut unavailable = fake_provider(Ok(String::new()));
        unavailable.diagnostics.available = false;
        unavailable.diagnostics.languages.clear();
        unavailable.diagnostics.recovery_message = Some("Install language data".into());
        run_next_ocr_with_provider(&repo, &unavailable)
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Unsupported
        );
    }

    #[tokio::test]
    async fn empty_success_and_failed_retry_have_stable_presentations() {
        let (_temp, repo, representation_id) = image_fixture().await;
        let clip_id: String =
            sqlx::query_scalar("SELECT clip_id FROM clip_representations WHERE id=?")
                .bind(&representation_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        produce_for_clip(&repo, &clip_id).await.unwrap();
        run_next_ocr_with_provider(&repo, &fake_provider(Ok(String::new())))
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Ready {
                text: String::new()
            }
        );

        sqlx::query("UPDATE artifact_records SET lifecycle_state='invalidated' WHERE owner_clip_id=? AND producer_id=?")
            .bind(&clip_id)
            .bind(OCR_PRODUCER_ID)
            .execute(&repo.pool)
            .await
            .unwrap();
        retry_ocr(&repo, &clip_id, &representation_id)
            .await
            .unwrap();
        run_next_ocr_with_provider(
            &repo,
            &fake_provider(Err(crate::providers::error::ProviderError::InvalidOutput(
                "fixture failure".into(),
            ))),
        )
        .await
        .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Failed {
                message: "Text recognition failed".into()
            }
        );
        retry_ocr(&repo, &clip_id, &representation_id)
            .await
            .unwrap();
        run_next_ocr_with_provider(&repo, &fake_provider(Ok("recovered".into())))
            .await
            .unwrap();
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Ready {
                text: "recovered".into()
            }
        );
    }

    #[derive(Clone)]
    struct BlockingOcrProvider {
        started: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
    }

    #[async_trait::async_trait]
    impl OcrProvider for BlockingOcrProvider {
        fn descriptor(&self) -> crate::providers::contracts::ProviderDescriptor {
            fake_provider(Ok(String::new())).descriptor()
        }

        async fn diagnostics(
            &self,
        ) -> crate::providers::error::ProviderResult<OcrProviderDiagnostics> {
            fake_provider(Ok(String::new())).diagnostics().await
        }

        async fn recognize(
            &self,
            _input: &VisualInput,
            _language: &str,
        ) -> crate::providers::error::ProviderResult<String> {
            self.started.notify_one();
            self.release.notified().await;
            Ok("must be discarded".into())
        }
    }

    #[tokio::test]
    async fn disabling_ocr_discards_an_in_flight_native_result() {
        let (_temp, repo, representation_id) = image_fixture().await;
        let clip_id: String =
            sqlx::query_scalar("SELECT clip_id FROM clip_representations WHERE id=?")
                .bind(&representation_id)
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        produce_for_clip(&repo, &clip_id).await.unwrap();
        let provider = BlockingOcrProvider {
            started: Arc::new(tokio::sync::Notify::new()),
            release: Arc::new(tokio::sync::Notify::new()),
        };
        let worker_repo = repo.clone();
        let worker_provider = provider.clone();
        let worker = tokio::spawn(async move {
            run_next_ocr_with_provider(&worker_repo, &worker_provider).await
        });
        provider.started.notified().await;
        update_ocr_settings(
            &repo,
            &OcrSettings {
                enabled: false,
                language: "auto".into(),
            },
        )
        .await
        .unwrap();
        provider.release.notify_one();
        worker.await.unwrap().unwrap();
        let artifacts: i64 = sqlx::query_scalar("SELECT count(*) FROM artifact_records WHERE owner_clip_id=? AND producer_id=? AND lifecycle_state='ready'")
            .bind(&clip_id)
            .bind(OCR_PRODUCER_ID)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(artifacts, 0);
        assert_eq!(
            ocr_presentation(&repo, &representation_id).await.unwrap(),
            OcrPresentation::Disabled
        );
    }
}
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn native_ocr_runtime_has_an_installed_language() {
    let diagnostics = NativeOcrProvider::new().diagnostics().await.unwrap();
    assert!(
        diagnostics.available,
        "native OCR must have at least one installed language"
    );
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn native_ocr_recognizes_a_bounded_bitmap_off_ui_thread() {
    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    let glyphs: [[&str; 7]; 4] = [
        [
            "11111", "00100", "00100", "00100", "00100", "00100", "00100",
        ],
        [
            "11111", "10000", "10000", "11110", "10000", "10000", "11111",
        ],
        [
            "11111", "10000", "10000", "11111", "00001", "00001", "11111",
        ],
        [
            "11111", "00100", "00100", "00100", "00100", "00100", "00100",
        ],
    ];
    let scale = 16u32;
    let mut image = RgbaImage::from_pixel(420, 152, Rgba([255, 255, 255, 255]));
    for (glyph_index, glyph) in glyphs.iter().enumerate() {
        let origin_x = 18 + glyph_index as u32 * 100;
        for (row, bits) in glyph.iter().enumerate() {
            for (column, bit) in bits.bytes().enumerate() {
                if bit == b'1' {
                    for y in 0..scale {
                        for x in 0..scale {
                            image.put_pixel(
                                origin_x + column as u32 * scale + x,
                                18 + row as u32 * scale + y,
                                Rgba([0, 0, 0, 255]),
                            );
                        }
                    }
                }
            }
        }
    }
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
    let provider = NativeOcrProvider::new();
    let diagnostics = provider.diagnostics().await.unwrap();
    let language = resolve_language("auto", "en", &diagnostics.languages).unwrap();
    let input = bounded_visual_input(png.into_inner(), "image/png".into(), "0".repeat(64)).unwrap();
    let text = provider.recognize(&input, &language).await.unwrap();
    assert!(
        text.to_ascii_uppercase().contains("TEST"),
        "expected TEST, got {text:?}"
    );
}
