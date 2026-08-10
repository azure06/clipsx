//! Artifact producers: thumbnail generation and native OCR.
use crate::{
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

// ─── Public API ──────────────────────────────────────────────────────────────

/// Produce thumbnail and OCR artifacts for all raster representations in a clip.
pub async fn produce_for_clip(repo: &HistoryRepository, clip_id: &str) -> Result<()> {
    let reps = raster_representations(repo, clip_id).await?;
    for (rep_id, binary_id) in reps {
        let _ = produce_thumbnail(repo, clip_id, &rep_id, &binary_id).await;
        let _ = produce_ocr(repo, clip_id, &rep_id, &binary_id).await;
    }
    Ok(())
}

/// First ready thumbnail artifact-binary-file id for a clip.
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
    _clip_id: &str,
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
                "INSERT INTO artifact_records(id,artifact_kind,producer_id,producer_version,\
                 parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) \
                 VALUES(?,?,?,?,?,?,'pending',?,?)",
            )
            .bind(&art_id)
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
            set_job_state(repo, &job_id, "unsupported").await?;
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
    _clip_id: &str,
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
    match platform_ocr(&bytes).await {
        Ok(text) if !text.trim().is_empty() => {
            let art_id = new_id();
            let art_sha = sha256(text.as_bytes());
            let now = now_ms();
            let mut tx = repo.pool.begin().await?;
            sqlx::query(
                "INSERT INTO artifact_records(id,artifact_kind,producer_id,producer_version,\
                 parameter_sha256,input_manifest_sha256,lifecycle_state,created_at,updated_at) \
                 VALUES(?,?,?,?,?,?,'pending',?,?)",
            )
            .bind(&art_id)
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
        _ => {
            set_job_state(repo, &job_id, "unsupported").await?;
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
async fn platform_ocr(bytes: &[u8]) -> Result<String> {
    use windows::{
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };
    let bytes_owned = bytes.to_vec();
    tokio::task::spawn_blocking(move || -> Result<String> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes_owned)?;
        writer.StoreAsync()?.get()?;
        writer.FlushAsync()?.get()?;
        stream.Seek(0)?;
        let decoder =
            BitmapDecoder::CreateWithIdAsync(BitmapDecoder::PngDecoderId()?, &stream)?.get()?;
        let bitmap = decoder.GetSoftwareBitmapAsync()?.get()?;
        let lang = Language::CreateLanguage(&windows::core::HSTRING::from("en-US"))?;
        let engine = OcrEngine::TryCreateFromLanguage(&lang)?
            .context("Windows OCR engine unavailable for en-US")?;
        let result = engine.RecognizeAsync(&bitmap)?.get()?;
        Ok(result.Text()?.to_string())
    })
    .await
    .context("OCR task panicked")?
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

async fn set_job_state(repo: &HistoryRepository, job_id: &str, status: &str) -> Result<()> {
    sqlx::query("UPDATE artifact_jobs SET status=?,completed_at=? WHERE id=?")
        .bind(status)
        .bind(now_ms())
        .bind(job_id)
        .execute(&repo.pool)
        .await?;
    Ok(())
}
