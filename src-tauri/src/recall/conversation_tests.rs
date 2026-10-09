use super::{
    agent::AgentRuntime,
    agent_tests::{request, setup},
    contracts::*,
    conversations::*,
    service_tests::capture,
    transport::Transport,
};
use crate::history::new_id;

fn user(id: &str, parent: Option<&str>, text: &str) -> RecallMessage {
    RecallMessage {
        id: id.into(),
        parent_id: parent.map(str::to_string),
        role: "user".into(),
        content_json: serde_json::to_string(&serde_json::json!([{ "type":"text","text":text }]))
            .unwrap(),
        status_json: None,
        metadata_json: "{\"custom\":{}}".into(),
        created_at: 1,
    }
}
#[tokio::test]
async fn branches_survive_restart_and_source_deletion_without_replaying_interrupted_actions() {
    let (_root, service, preset) = setup(Some(true)).await;
    let repo = &service.history;
    let thread = initialize(repo, "local-thread").await.unwrap();
    assert_eq!(
        initialize(repo, "local-thread").await.unwrap().id,
        thread.id
    );
    append(repo, &thread.id, user("question", None, "Find my note"))
        .await
        .unwrap();
    let runtime = AgentRuntime::default();
    let transport = Transport::default();
    let context = runtime
        .begin(repo, &transport, request(&preset))
        .await
        .unwrap();
    runtime
        .persist_run(
            repo,
            RecallRunStart {
                thread_id: thread.id.clone(),
                run_id: context.run_id.clone(),
                message_id: "reply".into(),
                parent_id: "question".into(),
            },
        )
        .await
        .unwrap();
    let clip = capture(&service, "original evidence", "editor", 10).await;
    record_read(
        repo,
        &context.run_id,
        ClipReadRequest {
            clip_id: clip.clone(),
            representation_id: None,
            kind: None,
            page_bytes: None,
            cursor: None,
        },
    )
    .await
    .unwrap();
    checkpoint(
        repo,
        RecallCheckpoint {
            run_id: context.run_id.clone(),
            sequence: 1,
            content_json: "[{\"type\":\"text\",\"text\":\"partial answer\"}]".into(),
            metadata_json: "{\"custom\":{}}".into(),
            status_json: None,
            terminal: false,
        },
    )
    .await
    .unwrap();
    assert!(
        delete(repo, &thread.id).await.is_err(),
        "running threads must be stopped first"
    );
    runtime.finish(&transport, &context.run_id).await;
    recover(repo).await.unwrap();
    sqlx::query("DELETE FROM clip_items WHERE id=?")
        .bind(&clip)
        .execute(&repo.pool)
        .await
        .unwrap();
    let saved = load(repo, &thread.id).await.unwrap();
    assert_eq!(saved.messages.len(), 2);
    assert!(saved.messages[1]
        .status_json
        .as_ref()
        .unwrap()
        .contains("incomplete"));
    assert!(saved.messages[1].metadata_json.contains("interrupted"));
    assert!(saved.sources[0].snapshot_json.contains("original evidence"));
    assert!(!saved.sources[0].available);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM assistant_actions")
            .fetch_one(&repo.pool)
            .await
            .unwrap(),
        0
    );
    append(repo, &thread.id, user("edited", None, "Corrected question"))
        .await
        .unwrap();
    assert_eq!(
        load(repo, &thread.id)
            .await
            .unwrap()
            .thread
            .head_message_id
            .as_deref(),
        Some("edited")
    );
    assert!(append(
        repo,
        &thread.id,
        user("question", None, "overwrite original")
    )
    .await
    .is_err());
    assert!(append(
        repo,
        &thread.id,
        user("invalid", Some("missing"), "bad parent")
    )
    .await
    .is_err());
    checkpoint(
        repo,
        RecallCheckpoint {
            run_id: context.run_id,
            sequence: 2,
            content_json: "[]".into(),
            metadata_json: "{}".into(),
            status_json: Some("{\"type\":\"complete\",\"reason\":\"stop\"}".into()),
            terminal: true,
        },
    )
    .await
    .unwrap();
    assert!(load(repo, &thread.id)
        .await
        .unwrap()
        .messages
        .iter()
        .find(|message| message.id == "reply")
        .unwrap()
        .content_json
        .contains("partial answer"));
    delete(repo, &thread.id).await.unwrap();
    assert!(list(repo, 0).await.unwrap().is_empty());
}
#[tokio::test]
async fn checkpoints_are_ordered_terminal_and_preserve_frozen_model_attribution() {
    let (_root, service, preset) = setup(Some(true)).await;
    let repo = &service.history;
    let thread = initialize(repo, &new_id()).await.unwrap();
    append(repo, &thread.id, user("question", None, "Hello"))
        .await
        .unwrap();
    let runtime = AgentRuntime::default();
    let transport = Transport::default();
    let context = runtime
        .begin(repo, &transport, request(&preset))
        .await
        .unwrap();
    runtime
        .persist_run(
            repo,
            RecallRunStart {
                thread_id: thread.id.clone(),
                run_id: context.run_id.clone(),
                message_id: "answer".into(),
                parent_id: "question".into(),
            },
        )
        .await
        .unwrap();
    let point = |sequence, text: &str, terminal: bool| RecallCheckpoint {
        run_id: context.run_id.clone(),
        sequence,
        content_json: serde_json::to_string(&serde_json::json!([{ "type":"text","text":text }]))
            .unwrap(),
        metadata_json: "{\"custom\":{}}".into(),
        status_json: terminal.then(|| "{\"type\":\"complete\",\"reason\":\"stop\"}".into()),
        terminal,
    };
    checkpoint(repo, point(2, "finished", true)).await.unwrap();
    checkpoint(repo, point(1, "late", false)).await.unwrap();
    checkpoint(repo, point(3, "after terminal", false))
        .await
        .unwrap();
    assert!(load(repo, &thread.id).await.unwrap().messages[1]
        .content_json
        .contains("finished"));
    let context_json: String =
        sqlx::query_scalar("SELECT context_json FROM recall_runs WHERE id=?")
            .bind(&context.run_id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert!(context_json.contains("fixture-chat"));
    assert!(!context_json.contains("credential"));
    let mut unsupported = user("remote-image", None, "ignored");
    unsupported.content_json =
        "[{\"type\":\"image\",\"image\":\"https://evil.invalid/pixel\"}]".into();
    assert!(append(repo, &thread.id, unsupported).await.is_err());
    runtime.finish(&transport, &context.run_id).await;
}

#[tokio::test]
async fn managed_image_snapshots_are_shared_retained_and_removed_with_the_last_chat() {
    use crate::history::{
        CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
    };
    let (_root, service, preset) = setup(Some(true)).await;
    let repo = &service.history;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let (clip, _) = repo
        .capture(
            CapturedSnapshot {
                token: 1,
                source_app_id: None,
                source_app_name: None,
                format_observations: vec![],
                representations: vec![CapturedRepresentation {
                    format_key: "image/png".into(),
                    canonical_mime_type: Some("image/png".into()),
                    native_type: None,
                    platform: std::env::consts::OS.into(),
                    capture_priority: 1,
                    payload: CapturedPayload::Binary(png.into_inner()),
                }],
            },
            &CaptureSettings::default(),
        )
        .await
        .unwrap();
    let representation = service.metadata(&clip).await.unwrap().representations[0]
        .id
        .clone();
    let preview = service
        .image(ClipImageRequest {
            clip_id: clip.clone(),
            representation_id: representation,
        })
        .await
        .unwrap();
    let runtime = AgentRuntime::default();
    let transport = Transport::default();
    let mut threads = vec![];
    for _ in 0..2 {
        let thread = initialize(repo, &new_id()).await.unwrap();
        append(repo, &thread.id, user("question", None, "Inspect image"))
            .await
            .unwrap();
        let context = runtime
            .begin(repo, &transport, request(&preset))
            .await
            .unwrap();
        runtime
            .persist_run(
                repo,
                RecallRunStart {
                    thread_id: thread.id.clone(),
                    run_id: context.run_id.clone(),
                    message_id: "answer".into(),
                    parent_id: "question".into(),
                },
            )
            .await
            .unwrap();
        record_image(repo, &context.run_id, &preview).await.unwrap();
        checkpoint(
            repo,
            RecallCheckpoint {
                run_id: context.run_id.clone(),
                sequence: 1,
                content_json: "[]".into(),
                metadata_json: "{}".into(),
                status_json: Some("{\"type\":\"complete\",\"reason\":\"stop\"}".into()),
                terminal: true,
            },
        )
        .await
        .unwrap();
        runtime.finish(&transport, &context.run_id).await;
        threads.push(thread.id);
    }
    sqlx::query("DELETE FROM clip_items WHERE id=?")
        .bind(&clip)
        .execute(&repo.pool)
        .await
        .unwrap();
    let first = load(repo, &threads[0]).await.unwrap().sources.remove(0);
    let second = load(repo, &threads[1]).await.unwrap().sources.remove(0);
    assert_eq!(first.asset_hash, second.asset_hash);
    assert!(!first.available);
    assert_eq!(
        read_snapshot_image(repo, &threads[0], &first.id)
            .await
            .unwrap(),
        preview.data
    );
    delete(repo, &threads[0]).await.unwrap();
    assert_eq!(
        read_snapshot_image(repo, &threads[1], &second.id)
            .await
            .unwrap(),
        preview.data
    );
    let root = repo
        .managed_root
        .parent()
        .unwrap()
        .join("recall-attachments");
    let file = root.join(second.asset_hash.unwrap());
    let bytes = std::fs::read(&file).unwrap();
    std::fs::write(&file, b"tampered").unwrap();
    assert!(read_snapshot_image(repo, &threads[1], &second.id)
        .await
        .is_err());
    std::fs::write(&file, bytes).unwrap();
    delete(repo, &threads[1]).await.unwrap();
    assert!(!file.exists());
}
