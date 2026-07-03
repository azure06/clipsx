use crate::models::ClipItem;
use crate::repositories::ClipRepository;
use anyhow::{anyhow, Result};
use tauri::{AppHandle, Emitter, Runtime};

pub const CLIP_UPDATED_EVENT: &str = "clip-updated";

async fn load_clip_updated_payload(repository: &ClipRepository, clip_id: &str) -> Result<ClipItem> {
    repository
        .get_by_id(clip_id)
        .await?
        .ok_or_else(|| anyhow!("Clip not found for update event: {}", clip_id))
}

pub async fn emit_clip_updated<R: Runtime>(
    app_handle: &AppHandle<R>,
    repository: &ClipRepository,
    clip_id: &str,
) -> Result<()> {
    let clip = load_clip_updated_payload(repository, clip_id).await?;
    app_handle.emit(CLIP_UPDATED_EVENT, &clip)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{emit_clip_updated, CLIP_UPDATED_EVENT};
    use crate::models::ClipItem;
    use crate::repositories::ClipRepository;
    use std::sync::mpsc::channel;
    use std::time::Duration;
    use tauri::{Event, Listener};

    #[tokio::test]
    async fn emit_clip_updated_sends_canonical_clip_payload(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("hello world".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;
        repo.upsert_search_embedding(&clip.id, "text", vec![1, 2, 3, 4], "test-model", 2)
            .await?;

        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let (tx, rx) = channel();

        let listener_id = app.listen_any(CLIP_UPDATED_EVENT, move |event: Event| {
            tx.send(event.payload().to_string()).unwrap();
        });

        emit_clip_updated(&app_handle, &repo, &clip.id).await?;

        let payload = rx.recv_timeout(Duration::from_secs(1))?;
        let emitted: ClipItem = serde_json::from_str(&payload)?;

        assert_eq!(emitted.id, clip.id);
        assert_eq!(emitted.has_embedding, Some(true));

        app.unlisten(listener_id);

        Ok(())
    }
}
