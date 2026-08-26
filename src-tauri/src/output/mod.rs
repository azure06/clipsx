//! Rust-owned clipboard output policies, reconstruction, and paste simulation.

use crate::{
    clipboard::{contract::ClipboardAdapter, plain_text_representation, SystemClipboardAdapter},
    contributions::transformer::TransformService,
    history::{CapturedRepresentation, HistoryRepository},
};
use anyhow::Result;
use serde::Deserialize;

pub mod paste;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardOutputDisposition {
    Copy,
    Paste,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ClipboardOutputSource {
    Original {
        clip_id: String,
    },
    PlainText {
        clip_id: String,
    },
    Transformed {
        result_id: String,
    },
    LiteralText {
        text: String,
        source_clip_id: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardOutputRequest {
    pub disposition: ClipboardOutputDisposition,
    pub source: ClipboardOutputSource,
}

async fn resolve_source(
    source: &ClipboardOutputSource,
    history: &HistoryRepository,
    transforms: &TransformService,
) -> Result<(Vec<CapturedRepresentation>, Option<String>)> {
    match source {
        ClipboardOutputSource::Original { clip_id } => Ok((
            history.reconstruction(clip_id).await?,
            Some(clip_id.clone()),
        )),
        ClipboardOutputSource::PlainText { clip_id } => Ok((
            history.plain_text_reconstruction(clip_id).await?,
            Some(clip_id.clone()),
        )),
        ClipboardOutputSource::Transformed { result_id } => {
            let (_, source_clip_id, _) = transforms.saved_metadata(result_id)?;
            Ok((transforms.transformed(result_id)?, Some(source_clip_id)))
        }
        ClipboardOutputSource::LiteralText {
            text,
            source_clip_id,
        } => Ok((
            vec![plain_text_representation(text.clone())],
            source_clip_id.clone(),
        )),
    }
}

/// Resolves and writes every copy/paste source through the platform adapter so
/// self-write suppression and native reconstruction cannot be bypassed.
pub async fn write_source(
    source: &ClipboardOutputSource,
    history: &HistoryRepository,
    transforms: &TransformService,
) -> Result<()> {
    let mut adapter = SystemClipboardAdapter::new();
    write_source_with_adapter(&mut adapter, source, history, transforms).await
}

async fn write_source_with_adapter(
    adapter: &mut dyn ClipboardAdapter,
    source: &ClipboardOutputSource,
    history: &HistoryRepository,
    transforms: &TransformService,
) -> Result<()> {
    let (representations, source_clip_id) = resolve_source(source, history, transforms).await?;
    adapter.write(&representations)?;
    if let Some(clip_id) = source_clip_id {
        history.touch(&clip_id).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        foundation::{self, AppRoots},
        history::{CaptureSettings, CapturedPayload, CapturedSnapshot},
    };
    use serde_json::json;

    #[derive(Default)]
    struct RecordingAdapter {
        writes: Vec<Vec<CapturedRepresentation>>,
    }

    impl ClipboardAdapter for RecordingAdapter {
        fn snapshot_token(&mut self) -> Result<u64> {
            Ok(1)
        }

        fn capture_once(&mut self, _token: u64) -> Result<CapturedSnapshot> {
            anyhow::bail!("capture is not used by output tests")
        }

        fn write(&mut self, representations: &[CapturedRepresentation]) -> Result<u64> {
            self.writes.push(representations.to_vec());
            Ok(self.writes.len() as u64)
        }
    }

    #[test]
    fn request_uses_the_frontend_camel_case_wire_shape() {
        assert_eq!(
            serde_json::from_value::<ClipboardOutputRequest>(json!({
                "disposition": "copy",
                "source": {
                    "kind": "literal_text",
                    "text": "#FF0040",
                    "sourceClipId": "clip-1"
                }
            }))
            .unwrap(),
            ClipboardOutputRequest {
                disposition: ClipboardOutputDisposition::Copy,
                source: ClipboardOutputSource::LiteralText {
                    text: "#FF0040".into(),
                    source_clip_id: Some("clip-1".into()),
                },
            }
        );
    }

    #[tokio::test]
    async fn every_source_uses_one_adapter_and_literal_output_only_touches_its_source() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        foundation::prepare(&roots).await.unwrap();
        let history = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let (clip_id, _) = history
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: Some("Output test".into()),
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![plain_text_representation("hello".into())],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let source_id = history.detail(&clip_id).await.unwrap().representations[0]
            .id
            .clone();
        let transforms = TransformService::default();
        let transformed = transforms
            .preview(
                &history,
                &clip_id,
                "builtin.transform.url.encode",
                &source_id,
                json!({}),
            )
            .await
            .unwrap();
        let sources = [
            ClipboardOutputSource::Original {
                clip_id: clip_id.clone(),
            },
            ClipboardOutputSource::PlainText {
                clip_id: clip_id.clone(),
            },
            ClipboardOutputSource::Transformed {
                result_id: transformed.result_id,
            },
            ClipboardOutputSource::LiteralText {
                text: "#FF0040".into(),
                source_clip_id: Some(clip_id.clone()),
            },
        ];
        let mut adapter = RecordingAdapter::default();

        for source in &sources {
            write_source_with_adapter(&mut adapter, source, &history, &transforms)
                .await
                .unwrap();
        }

        assert_eq!(adapter.writes.len(), sources.len());
        assert!(matches!(
            &adapter.writes[3][0].payload,
            CapturedPayload::Text(value) if value == "#FF0040"
        ));
        let clip_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clip_items")
            .fetch_one(&history.pool)
            .await
            .unwrap();
        let access_count: i64 =
            sqlx::query_scalar("SELECT access_count FROM clip_items WHERE id=?")
                .bind(&clip_id)
                .fetch_one(&history.pool)
                .await
                .unwrap();
        assert_eq!(
            clip_count, 1,
            "literal output must not create a history entry"
        );
        assert_eq!(
            access_count, 4,
            "each source-linked output touches the source clip"
        );
    }
}
