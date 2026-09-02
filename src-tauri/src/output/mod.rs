//! Rust-owned clipboard output policies, reconstruction, and paste simulation.

use crate::{
    clipboard::{contract::ClipboardAdapter, plain_text_representation, SystemClipboardAdapter},
    contributions::transformer::TransformService,
    history::{CapturedPayload, CapturedRepresentation, HistoryRepository},
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
    let (representations, source_clip_id) = match source {
        ClipboardOutputSource::Original { clip_id } => (
            history.reconstruction(clip_id).await?,
            Some(clip_id.clone()),
        ),
        ClipboardOutputSource::PlainText { clip_id } => (
            history.plain_text_reconstruction(clip_id).await?,
            Some(clip_id.clone()),
        ),
        ClipboardOutputSource::Transformed { result_id } => {
            let (_, source_clip_id, _) = transforms.saved_metadata(result_id)?;
            (transforms.transformed(result_id)?, Some(source_clip_id))
        }
        ClipboardOutputSource::LiteralText {
            text,
            source_clip_id,
        } => (
            vec![plain_text_representation(text.clone())],
            source_clip_id.clone(),
        ),
    };
    Ok((
        with_portable_plain_text_companion(representations),
        source_clip_id,
    ))
}

/// Platforms expose standard plain text but no portable Markdown, CSV, JSON,
/// YAML, TOML, or TypeScript clipboard identity. Keep their typed
/// representation intact and append an identical plain-text companion only at
/// the write boundary, where native wrappers are regenerated anyway.
fn with_portable_plain_text_companion(
    mut representations: Vec<CapturedRepresentation>,
) -> Vec<CapturedRepresentation> {
    if representations
        .iter()
        .any(|representation| representation.canonical_mime_type.as_deref() == Some("text/plain"))
    {
        return representations;
    }
    let text = representations
        .iter()
        .find_map(|representation| portable_plain_text_source(representation).map(str::to_owned));
    if let Some(text) = text {
        representations.push(plain_text_representation(text));
    }
    representations
}

fn portable_plain_text_source(representation: &CapturedRepresentation) -> Option<&str> {
    let CapturedPayload::Text(text) = &representation.payload else {
        return None;
    };
    let mime = representation.canonical_mime_type.as_deref()?;
    let is_source_text = (mime.starts_with("text/") && !matches!(mime, "text/html" | "text/rtf"))
        || matches!(
            mime,
            "application/json"
                | "application/yaml"
                | "application/x-yaml"
                | "application/toml"
                | "application/xml"
                | "image/svg+xml"
        );
    is_source_text.then_some(text)
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

    fn typed_text(mime: &str, text: &str) -> CapturedRepresentation {
        CapturedRepresentation {
            format_key: format!("mime:{mime}"),
            canonical_mime_type: Some(mime.into()),
            native_type: None,
            platform: "windows".into(),
            capture_priority: 10,
            payload: CapturedPayload::Text(text.into()),
        }
    }

    #[test]
    fn typed_text_output_gets_one_transient_plain_text_companion() {
        let output = with_portable_plain_text_companion(vec![typed_text(
            "text/markdown",
            "| name |\n| --- |\n| 雪 |",
        )]);
        assert_eq!(output.len(), 2);
        assert_eq!(
            output[0].canonical_mime_type.as_deref(),
            Some("text/markdown")
        );
        assert!(matches!(
            &output[1].payload,
            CapturedPayload::Text(text) if text == "| name |\n| --- |\n| 雪 |"
        ));
        assert_eq!(output[1].canonical_mime_type.as_deref(), Some("text/plain"));

        assert_eq!(
            with_portable_plain_text_companion(vec![
                typed_text("application/json", "{\"ok\":true}"),
                typed_text("text/plain", "already portable"),
            ])
            .len(),
            2,
            "a native plain-text representation must never be duplicated"
        );
    }

    #[test]
    fn rich_markup_and_binary_output_do_not_get_raw_plain_text_companions() {
        let html = with_portable_plain_text_companion(vec![typed_text("text/html", "<b>Ada</b>")]);
        assert_eq!(html.len(), 1);
        let rtf = with_portable_plain_text_companion(vec![typed_text("text/rtf", "{\\rtf1 Ada}")]);
        assert_eq!(rtf.len(), 1);
        let binary = CapturedRepresentation {
            format_key: "mime:image/png".into(),
            canonical_mime_type: Some("image/png".into()),
            native_type: None,
            platform: "windows".into(),
            capture_priority: 10,
            payload: CapturedPayload::Binary(vec![137, 80, 78, 71]),
        };
        assert_eq!(with_portable_plain_text_companion(vec![binary]).len(), 1);
    }

    #[tokio::test]
    async fn transformed_and_saved_typed_text_copy_with_plain_companion_without_mutating_output() {
        let temp = tempfile::TempDir::new().unwrap();
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        foundation::prepare(&roots).await.unwrap();
        let history = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        let markdown = typed_text("text/markdown", "| name |\n| --- |\n| Ada |");
        let (clip_id, _) = history
            .capture(
                CapturedSnapshot {
                    token: 1,
                    source_app_name: Some("Output test".into()),
                    source_app_id: None,
                    format_observations: Vec::new(),
                    representations: vec![markdown.clone()],
                },
                &CaptureSettings::default(),
            )
            .await
            .unwrap();
        let source_id = history.detail(&clip_id).await.unwrap().representations[0]
            .id
            .clone();
        let transforms = TransformService::default();
        let preview = transforms
            .cache_external(
                clip_id.clone(),
                "example.test/transform".into(),
                "1.0.0".into(),
                source_id,
                json!({}),
                vec![markdown],
            )
            .unwrap();
        let mut adapter = RecordingAdapter::default();

        write_source_with_adapter(
            &mut adapter,
            &ClipboardOutputSource::Transformed {
                result_id: preview.result_id.clone(),
            },
            &history,
            &transforms,
        )
        .await
        .unwrap();
        write_source_with_adapter(
            &mut adapter,
            &ClipboardOutputSource::Original {
                clip_id: clip_id.clone(),
            },
            &history,
            &transforms,
        )
        .await
        .unwrap();

        for representations in &adapter.writes {
            assert_eq!(representations.len(), 2);
            assert_eq!(
                representations[0].canonical_mime_type.as_deref(),
                Some("text/markdown")
            );
            assert_eq!(
                representations[1].canonical_mime_type.as_deref(),
                Some("text/plain")
            );
        }
        let cached = transforms.transformed(&preview.result_id).unwrap();
        assert_eq!(
            cached.len(),
            1,
            "clipboard companions must not enter the cache"
        );
        assert_eq!(
            cached[0].canonical_mime_type.as_deref(),
            Some("text/markdown")
        );
        let saved = history.reconstruction(&clip_id).await.unwrap();
        assert_eq!(saved.len(), 1, "clipboard companions must not be persisted");
        assert_eq!(
            saved[0].canonical_mime_type.as_deref(),
            Some("text/markdown")
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
            .cache_external(
                clip_id.clone(),
                "example.test/transform".into(),
                "1.0.0".into(),
                source_id,
                json!({}),
                vec![plain_text_representation("transformed".into())],
            )
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
