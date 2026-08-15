//! Artifact scheduling, persistence, and built-in execution host.
use crate::{
    contracts::OcrPresentation,
    foundation::ManagedFileStore,
    history::repository::safe_relative,
    history::{new_id, now_ms, sha256, HistoryRepository},
};
use anyhow::{bail, Context, Result};
use sqlx::Row;
use std::path::PathBuf;

const THUMBNAIL_MAX_EDGE: u32 = 512;
const THUMBNAIL_PRODUCER_ID: &str = "builtin.artifact.thumbnail";
const THUMBNAIL_PRODUCER_VERSION: &str = "1";
const OCR_PRODUCER_ID: &str = "builtin.artifact.ocr";
const OCR_PRODUCER_VERSION: &str = "1";

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
    static PRODUCERS: [ArtifactProducerDescriptor; 4] = [
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
        ArtifactProducerDescriptor {
            id: "builtin.artifact.html-text",
            version: "1",
            artifact_kind: "text_extraction",
        },
        ArtifactProducerDescriptor {
            id: "builtin.artifact.rtf-text",
            version: "1",
            artifact_kind: "text_extraction",
        },
    ];
    &PRODUCERS
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Produce thumbnail and OCR artifacts for all raster representations in a clip.
pub async fn produce_for_clip(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    if !ocr_enabled(repo).await? {
        // Thumbnails are still useful and entirely local; only OCR is optional.
        for (rep_id, binary_id) in raster_representations(repo, clip_id).await? {
            let _ = produce_thumbnail(repo, clip_id, &rep_id, &binary_id).await;
        }
        return Ok(());
    }
    let reps = raster_representations(repo, clip_id).await?;
    for (rep_id, binary_id) in reps {
        let _ = produce_thumbnail(repo, clip_id, &rep_id, &binary_id).await;
        let _ = produce_ocr(repo, clip_id, &rep_id, &binary_id).await;
    }
    Ok(())
}

async fn ocr_enabled(repo: &HistoryRepository) -> Result<bool> {
    let raw: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_profile_values WHERE key='artifacts.ocr.enabled'",
    )
    .fetch_optional(&repo.pool)
    .await?;
    Ok(raw
        .as_deref()
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or(true))
}

pub async fn ocr_presentation(
    repo: &HistoryRepository,
    representation_id: &str,
) -> Result<OcrPresentation> {
    if !ocr_enabled(repo).await? {
        return Ok(OcrPresentation::Disabled);
    }
    let ready: Option<String> = sqlx::query_scalar(
        "SELECT atv.text_value FROM artifact_records ar \
         JOIN artifact_inputs ai ON ai.artifact_id=ar.id \
         JOIN artifact_text_values atv ON atv.artifact_id=ar.id \
         WHERE ai.representation_id=? AND ar.producer_id=? \
         AND ar.lifecycle_state='ready' ORDER BY ar.updated_at DESC LIMIT 1",
    )
    .bind(representation_id)
    .bind(OCR_PRODUCER_ID)
    .fetch_optional(&repo.pool)
    .await?;
    if let Some(text) = ready {
        return Ok(OcrPresentation::Ready { text });
    }
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM artifact_jobs WHERE target_representation_id=? \
         AND producer_id=? ORDER BY requested_at DESC LIMIT 1",
    )
    .bind(representation_id)
    .bind(OCR_PRODUCER_ID)
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
    let binary_id: String = sqlx::query_scalar(
        "SELECT binary_file_id FROM clip_representations WHERE id=? AND clip_id=? \
         AND lifecycle_state='ready' AND canonical_mime_type LIKE 'image/%' \
         AND storage_kind='binary_asset'",
    )
    .bind(representation_id)
    .bind(clip_id)
    .fetch_optional(&repo.pool)
    .await?
    .context("ready image representation not found")?;
    produce_ocr(repo, clip_id, representation_id, &binary_id).await
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
         WHERE cr.clip_id = ? AND ar.producer_id = ? AND ar.lifecycle_state = 'ready' \
         LIMIT 1",
    )
    .bind(clip_id)
    .bind(THUMBNAIL_PRODUCER_ID)
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
         WHERE cr.clip_id = ? AND ar.producer_id = ? AND ar.lifecycle_state = 'ready' \
         LIMIT 1",
    )
    .bind(clip_id)
    .bind(OCR_PRODUCER_ID)
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

async fn produce_ocr(
    repo: &HistoryRepository,
    clip_id: &str,
    rep_id: &str,
    binary_id: &str,
) -> Result<()> {
    let param_sha = sha256(format!("{OCR_PRODUCER_ID}:{OCR_PRODUCER_VERSION}").as_bytes());
    let input_sha = binary_sha256_for(repo, binary_id).await?;
    let input_manifest = sha256(format!("{rep_id}:{input_sha}").as_bytes());

    if artifact_exists(repo, OCR_PRODUCER_ID, rep_id, &param_sha).await? {
        return Ok(());
    }
    let job_id = claim_job(
        repo,
        "ocr",
        rep_id,
        OCR_PRODUCER_ID,
        OCR_PRODUCER_VERSION,
        &param_sha,
    )
    .await?;

    let (bytes, _) = repo.asset(binary_id).await?;
    if !platform_ocr_available() {
        set_job_state(repo, &job_id, "unsupported", None).await?;
        return Ok(());
    }
    match platform_ocr(&bytes).await {
        Ok(text) => {
            let art_id = new_id();
            let art_sha = sha256(text.as_bytes());
            let now = now_ms();
            let mut tx = repo.pool.begin().await?;
            sqlx::query(
                "INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,\
                 parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) \
                 VALUES(?,?,?,?,?,?,?,'pending',?,?)",
            )
            .bind(&art_id)
            .bind(clip_id)
            .bind("ocr")
            .bind(OCR_PRODUCER_ID)
            .bind(OCR_PRODUCER_VERSION)
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
                "INSERT INTO artifact_text_values(artifact_id,text_value,utf8_byte_length,sha256) \
                 VALUES(?,?,?,?)",
            )
            .bind(&art_id)
            .bind(&text)
            .bind(text.len() as i64)
            .bind(&art_sha)
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
        Err(error) => {
            set_job_state(repo, &job_id, "failed", Some(&error.to_string())).await?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn platform_ocr(bytes: &[u8]) -> Result<String> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;

    let bytes_owned = bytes.to_vec();
    tokio::task::spawn_blocking(move || -> Result<String> {
        unsafe {
            let ns_data: id = msg_send![class!(NSData),
                dataWithBytes: bytes_owned.as_ptr()
                length: bytes_owned.len()];
            let ci_image: id = msg_send![class!(CIImage), imageWithData: ns_data];
            if ci_image == nil {
                bail!("could not create CIImage");
            }
            let handler: id = msg_send![class!(VNImageRequestHandler), alloc];
            let handler: id = msg_send![handler, initWithCIImage: ci_image options: nil];
            let request: id = msg_send![class!(VNRecognizeTextRequest), alloc];
            let request: id = msg_send![request, init];
            let _: () = msg_send![request, setRecognitionLevel: 1i64];
            let requests: id = msg_send![class!(NSArray), arrayWithObject: request];
            let ok: bool = msg_send![handler, performRequests: requests
                                       error: std::ptr::null_mut::<id>()];
            if !ok {
                bail!("VNImageRequestHandler failed");
            }
            let results: id = msg_send![request, results];
            if results == nil {
                return Ok(String::new());
            }
            let count: usize = msg_send![results, count];
            let mut parts = Vec::with_capacity(count);
            for i in 0..count {
                let obs: id = msg_send![results, objectAtIndex: i];
                let cands: id = msg_send![obs, topCandidates: 1usize];
                let first: id = msg_send![cands, objectAtIndex: 0usize];
                let ns: id = msg_send![first, string];
                let c: *const std::os::raw::c_char = msg_send![ns, UTF8String];
                if !c.is_null() {
                    parts.push(CStr::from_ptr(c).to_string_lossy().into_owned());
                }
            }
            Ok(parts.join("\n"))
        }
    })
    .await
    .context("OCR task panicked")?
}

#[cfg(target_os = "windows")]
async fn platform_ocr(_bytes: &[u8]) -> Result<String> {
    // The Windows Runtime bindings used by this crate expose asynchronous OCR
    // operations. They must run on a WinRT-capable async apartment rather than
    // a Tokio blocking worker. Until that host integration is available, report
    // a precise unsupported state instead of claiming failed English-only OCR.
    bail!("Windows OCR runtime integration is unavailable")
}

#[cfg(target_os = "macos")]
fn platform_ocr_available() -> bool {
    true
}

#[cfg(target_os = "windows")]
fn platform_ocr_available() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn platform_ocr_available() -> bool {
    std::process::Command::new("which")
        .arg("tesseract")
        .output()
        .is_ok_and(|output| output.status.success())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_ocr_available() -> bool {
    false
}

#[cfg(target_os = "linux")]
async fn platform_ocr(bytes: &[u8]) -> Result<String> {
    if std::process::Command::new("which")
        .arg("tesseract")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
    {
        bail!("tesseract not installed");
    }
    let bytes_owned = bytes.to_vec();
    tokio::task::spawn_blocking(move || -> Result<String> {
        let dir = tempfile::TempDir::new()?;
        let input = dir.path().join("input.png");
        std::fs::write(&input, &bytes_owned)?;
        let output_base = dir.path().join("out");
        let status = std::process::Command::new("tesseract")
            .arg(&input)
            .arg(&output_base)
            .status()?;
        if !status.success() {
            bail!("tesseract failed");
        }
        let text = std::fs::read_to_string(output_base.with_extension("txt"))?;
        Ok(text)
    })
    .await
    .context("OCR task panicked")?
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
async fn platform_ocr(_bytes: &[u8]) -> Result<String> {
    bail!("OCR not supported on this platform")
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
    sqlx::query("UPDATE artifact_jobs SET status=?,last_error=?,completed_at=? WHERE id=?")
        .bind(status)
        .bind(error.map(|value| value.chars().take(512).collect::<String>()))
        .bind(now_ms())
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
                        payload: CapturedPayload::Binary(vec![1, 2, 3]),
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
}
