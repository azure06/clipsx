use super::{contracts::*, service::ClipboardService};
use crate::{
    foundation::AppRoots,
    history::{
        CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
        HistoryRepository,
    },
    search,
};
use std::io::Cursor;

async fn repository() -> (tempfile::TempDir, ClipboardService) {
    let temp = tempfile::tempdir().unwrap();
    let roots = AppRoots {
        data: temp.path().join("data"),
        config: temp.path().join("config"),
    };
    crate::foundation::prepare(&roots).await.unwrap();
    let history = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
        .await
        .unwrap();
    (temp, ClipboardService::new(history))
}
async fn capture(service: &ClipboardService, text: &str, app: &str, timestamp: i64) -> String {
    let (id, _) = service
        .history
        .capture(
            CapturedSnapshot {
                token: timestamp as u64,
                source_app_id: Some(app.into()),
                source_app_name: Some(app.into()),
                format_observations: vec![],
                representations: vec![CapturedRepresentation {
                    format_key: "text/plain".into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: None,
                    platform: std::env::consts::OS.into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Text(text.into()),
                }],
            },
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    sqlx::query("UPDATE clip_items SET captured_at=? WHERE id=?")
        .bind(timestamp)
        .bind(&id)
        .execute(&service.history.pool)
        .await
        .unwrap();
    search::upsert_projection(&service.history, &id)
        .await
        .unwrap();
    id
}
fn query(query: &str, filters: ClipFilters) -> ClipSearchRequest {
    ClipSearchRequest {
        query: query.into(),
        mode: None,
        filters: Some(filters),
        limit: None,
        cursor: None,
    }
}
fn read(clip: &str) -> ClipReadRequest {
    ClipReadRequest {
        clip_id: clip.into(),
        representation_id: None,
        kind: None,
        page_bytes: Some(8192),
        cursor: None,
    }
}
async fn make_secret(service: &ClipboardService, id: &str) {
    let representation = service.metadata(id).await.unwrap().representations[0]
        .id
        .clone();
    sqlx::query("INSERT INTO content_facet_definitions(id,owner_id,version,display_name,created_at,updated_at) VALUES('core.security.secret','builtin.core','1','Secret',0,0) ON CONFLICT DO NOTHING").execute(&service.history.pool).await.unwrap();
    sqlx::query("INSERT INTO content_clip_facets(clip_id,facet_id,source_representation_id,detector_id,detector_version) VALUES(?,'core.security.secret',?,'fixture','1')").bind(id).bind(representation).execute(&service.history.pool).await.unwrap();
}

#[tokio::test]
async fn assistant_filtering_precedes_both_candidate_sources_and_history_is_preserved() {
    let (_temp, service) = repository().await;
    let good = capture(&service, "meeting alpha", "editor", 2000).await;
    let wrong_app = capture(&service, "meeting beta", "browser", 2000).await;
    let old = capture(&service, "meeting older", "editor", 1000).await;
    let secret = capture(&service, "meeting hidden", "editor", 2000).await;
    make_secret(&service, &secret).await;
    let filters = ClipFilters {
        captured_after: Some(1500),
        captured_before: Some(2500),
        source_app_ids: vec!["editor".into()],
        ..Default::default()
    };
    let page = service
        .search(query("meeting", filters.clone()))
        .await
        .unwrap();
    assert_eq!(
        page.items
            .iter()
            .map(|v| v.clip.id.as_str())
            .collect::<Vec<_>>(),
        vec![good.as_str()]
    );
    let native = search::SearchRequest {
        query: "meeting".into(),
        scope: None,
        tag_id: None,
        limit: Some(20),
        cursor: None,
        enabled_source_ids: vec![],
        representation_families: vec![],
        facet_ids: vec![],
        eligibility: search::SearchEligibility {
            captured_after: Some(1500),
            captured_before: Some(2500),
            source_app_ids: vec!["editor".into()],
            excluded_clip_ids: vec![],
            assistant: true,
        },
    };
    let eligible = search::eligible_clip_ids(&service.history, &native)
        .await
        .unwrap();
    assert_eq!(eligible.len(), 1);
    assert!(eligible.contains_key(&good));
    assert!(!eligible.contains_key(&wrong_app));
    assert!(!eligible.contains_key(&old));
    assert!(!eligible.contains_key(&secret));
    assert!(service.history.detail(&secret).await.is_ok());
    assert!(service.read(read(&secret)).await.is_err());
    let excluded = service
        .search(query(
            "meeting",
            ClipFilters {
                excluded_clip_ids: vec![good],
                ..filters
            },
        ))
        .await
        .unwrap();
    assert!(excluded.items.is_empty());
    let browse = service
        .search(query("", ClipFilters::default()))
        .await
        .unwrap();
    assert_eq!(browse.items.len(), 3);
    let mut hybrid = query("meeting", ClipFilters::default());
    hybrid.mode = Some(RetrievalMode::Hybrid);
    let fallback = service.search(hybrid).await.unwrap();
    assert_eq!(fallback.items.len(), 3);
    assert!(fallback
        .source_outcomes
        .iter()
        .any(|v| v.status == "unavailable"));
}

#[tokio::test]
async fn text_paging_preserves_utf8_and_binds_representation_revision_and_access() {
    let (_temp, service) = repository().await;
    let text = format!("{}日本語{}", "a".repeat(8191), "z".repeat(9000));
    let id = capture(&service, &text, "editor", 1000).await;
    let first = service.read(read(&id)).await.unwrap();
    assert_eq!(first.text.len(), 8191);
    let revision = first.clip.revision.clone();
    service.history.touch(&id).await.unwrap();
    assert_eq!(service.metadata(&id).await.unwrap().revision, revision);
    let mut request = read(&id);
    request.cursor = first.next_cursor;
    let second = service.read(request.clone()).await.unwrap();
    assert!(second.text.starts_with("日本語"));
    service
        .history
        .note(&id, Some("changed".into()))
        .await
        .unwrap();
    assert!(service.read(request).await.is_err());
    let current = service.read(read(&id)).await.unwrap();
    make_secret(&service, &id).await;
    let mut stale = read(&id);
    stale.cursor = current.next_cursor;
    assert!(service.read(stale).await.is_err());
}

#[tokio::test]
async fn image_reads_require_owned_verified_bounded_png_or_jpeg() {
    let (_temp, service) = repository().await;
    let image = image::DynamicImage::new_rgba8(3000, 2);
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    let (id, _) = service
        .history
        .capture(
            CapturedSnapshot {
                token: 1,
                source_app_name: None,
                source_app_id: None,
                format_observations: vec![],
                representations: vec![CapturedRepresentation {
                    format_key: "image/png".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: None,
                    platform: std::env::consts::OS.into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Binary(bytes.into_inner()),
                }],
            },
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    let representation = service.metadata(&id).await.unwrap().representations[0]
        .id
        .clone();
    let request = ClipImageRequest {
        clip_id: id.clone(),
        representation_id: representation,
    };
    let preview = service.image(request.clone()).await.unwrap();
    assert_eq!(preview.original_width, 3000);
    assert!(preview.resized);
    assert!(preview.width <= 2048);
    assert!(preview.data.len() <= 4 * 1024 * 1024);
    let job_id = crate::history::new_id();
    sqlx::query("INSERT INTO artifact_jobs(id,artifact_kind,target_representation_id,producer_id,producer_version,status,requested_at) VALUES(?,'ocr',?,'builtin.artifact.ocr','3','pending',1)").bind(&job_id).bind(&request.representation_id).execute(&service.history.pool).await.unwrap();
    let mut ocr_request = read(&id);
    ocr_request.kind = Some(TextKind::Ocr);
    ocr_request.representation_id = Some(request.representation_id.clone());
    let pending = service.read(ocr_request.clone()).await.unwrap();
    assert!(matches!(pending.warnings[0].code, WarningCode::OcrPending));
    let status: String = sqlx::query_scalar("SELECT status FROM artifact_jobs WHERE id=?")
        .bind(&job_id)
        .fetch_one(&service.history.pool)
        .await
        .unwrap();
    assert_eq!(status, "pending");
    let artifact_id = crate::history::new_id();
    let parameter = crate::history::sha256(b"fixture");
    sqlx::query("INSERT INTO artifact_records(id,owner_clip_id,artifact_kind,producer_id,producer_version,parameter_sha256,lifecycle_state,created_at,updated_at) VALUES(? ,?,'ocr','builtin.artifact.ocr','3',?,'ready',1,1)").bind(&artifact_id).bind(&id).bind(&parameter).execute(&service.history.pool).await.unwrap();
    sqlx::query("INSERT INTO artifact_inputs(artifact_id,ordinal,representation_id,input_sha256) VALUES(?,0,?,?)").bind(&artifact_id).bind(&request.representation_id).bind(&preview.source_fingerprint).execute(&service.history.pool).await.unwrap();
    sqlx::query("INSERT INTO artifact_text_values(artifact_id,text_value,utf8_byte_length,sha256) VALUES(?,'recognized text',15,?)").bind(&artifact_id).bind(crate::history::sha256(b"recognized text")).execute(&service.history.pool).await.unwrap();
    sqlx::query("UPDATE artifact_jobs SET status='completed',produced_artifact_id=? WHERE id=?")
        .bind(&artifact_id)
        .bind(&job_id)
        .execute(&service.history.pool)
        .await
        .unwrap();
    let ocr = service.read(ocr_request.clone()).await.unwrap();
    assert_eq!(ocr.kind, TextKind::Ocr);
    assert_eq!(ocr.text, "recognized text");
    assert!(ocr.warnings.is_empty());
    sqlx::query("UPDATE artifact_inputs SET input_sha256=? WHERE artifact_id=?")
        .bind("0".repeat(64))
        .bind(&artifact_id)
        .execute(&service.history.pool)
        .await
        .unwrap();
    let stale_ocr = service.read(ocr_request).await.unwrap();
    assert!(stale_ocr.text.is_empty());
    let unrelated = capture(&service, "hello", "editor", 2000).await;
    assert!(service
        .image(ClipImageRequest {
            clip_id: unrelated,
            representation_id: request.representation_id.clone()
        })
        .await
        .is_err());
    let relative: String=sqlx::query_scalar("SELECT relative_path FROM clip_binary_files WHERE id=(SELECT binary_file_id FROM clip_representations WHERE id=?)").bind(&request.representation_id).fetch_one(&service.history.pool).await.unwrap();
    std::fs::write(service.history.managed_root.join(relative), b"tampered").unwrap();
    assert!(service.image(request.clone()).await.is_err());
    make_secret(&service, &id).await;
    assert!(service.image(request).await.is_err());
}
