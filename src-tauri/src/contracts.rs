#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StorageKind {
    Text,
    BinaryAsset,
    FileList,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    Pending,
    Ready,
    Failed,
    Missing,
    Quarantined,
    Unsupported,
    Invalidated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepresentationContract {
    pub id: String,
    pub clip_id: String,
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub platform: String,
    pub storage_kind: StorageKind,
    pub ordinal: i32,
    pub capture_priority: i32,
    pub lifecycle_state: LifecycleState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RenderModel {
    Text {
        text: String,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    Markdown {
        markdown: String,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Tree {
        value: serde_json::Value,
    },
    KeyValue {
        entries: Vec<(String, String)>,
    },
    Card {
        leading: LeadingVisual,
        title: String,
        subtitle: Option<String>,
        fields: Vec<(String, String)>,
    },
    Image {
        asset_id: String,
        ocr: OcrPresentation,
    },
    Html {
        sanitized_html: String,
    },
    RichText {
        sanitized_html: Option<String>,
        plain_text: String,
    },
    Files {
        entries: Vec<FilePresentation>,
    },
    Document {
        asset_id: String,
        mime_type: String,
    },
    Office {
        format_key: String,
        native_type: Option<String>,
        byte_length: i64,
    },
    Semantic {
        facet_id: String,
        text: String,
        payload: serde_json::Value,
    },
    Unsupported {
        format_key: String,
        mime_type: Option<String>,
        native_type: Option<String>,
        byte_length: i64,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LeadingVisual {
    None,
    HostIcon {
        name: String,
    },
    Swatch {
        red: u8,
        green: u8,
        blue: u8,
        alpha: u8,
    },
    InputThumbnail,
    Monogram {
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompactPresentation {
    pub leading: LeadingVisual,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub badge: Option<String>,
    pub accessibility_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum OcrPresentation {
    Disabled,
    Pending,
    Running,
    Ready { text: String },
    Unsupported,
    Failed { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilePresentation {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSpaceDescriptor {
    pub provider_kind: String,
    pub endpoint_identity: Option<String>,
    pub model_id: String,
    pub model_revision: Option<String>,
    pub modality: String,
    pub dimensions: u32,
    pub normalization: String,
    pub distance_metric: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub state: String,
    pub message: String,
    pub reset_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactoryResetResult {
    pub deleted: Vec<String>,
    pub failures: Vec<String>,
    pub restart_required: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_model_wire_contract_is_camel_case_and_lossless() {
        use serde_json::json;

        let cases = [
            (
                RenderModel::Text {
                    text: "text".into(),
                },
                json!({"kind": "text", "text": "text"}),
            ),
            (
                RenderModel::Code {
                    language: Some("rust".into()),
                    text: "code".into(),
                },
                json!({"kind": "code", "language": "rust", "text": "code"}),
            ),
            (
                RenderModel::Markdown {
                    markdown: "# title".into(),
                },
                json!({"kind": "markdown", "markdown": "# title"}),
            ),
            (
                RenderModel::Table {
                    columns: vec!["A".into()],
                    rows: vec![vec!["1".into()]],
                },
                json!({"kind": "table", "columns": ["A"], "rows": [["1"]]}),
            ),
            (
                RenderModel::Tree {
                    value: json!({"a": 1}),
                },
                json!({"kind": "tree", "value": {"a": 1}}),
            ),
            (
                RenderModel::KeyValue {
                    entries: vec![("a".into(), "1".into())],
                },
                json!({"kind": "key_value", "entries": [["a", "1"]]}),
            ),
            (
                RenderModel::Card {
                    leading: LeadingVisual::Swatch {
                        red: 239,
                        green: 68,
                        blue: 68,
                        alpha: 255,
                    },
                    title: "#EF4444".into(),
                    subtitle: Some("rgb(239 68 68)".into()),
                    fields: vec![("HEX".into(), "#EF4444".into())],
                },
                json!({"kind": "card", "leading": {"kind": "swatch", "red": 239, "green": 68, "blue": 68, "alpha": 255}, "title": "#EF4444", "subtitle": "rgb(239 68 68)", "fields": [["HEX", "#EF4444"]]}),
            ),
            (
                RenderModel::Image {
                    asset_id: "asset-1".into(),
                    ocr: OcrPresentation::Ready {
                        text: String::new(),
                    },
                },
                json!({"kind": "image", "assetId": "asset-1", "ocr": {"state": "ready", "text": ""}}),
            ),
            (
                RenderModel::Html {
                    sanitized_html: "<p>safe</p>".into(),
                },
                json!({"kind": "html", "sanitizedHtml": "<p>safe</p>"}),
            ),
            (
                RenderModel::RichText {
                    sanitized_html: Some("<p>safe</p>".into()),
                    plain_text: "safe".into(),
                },
                json!({"kind": "rich_text", "sanitizedHtml": "<p>safe</p>", "plainText": "safe"}),
            ),
            (
                RenderModel::Files {
                    entries: vec![FilePresentation {
                        path: "C:\\missing\\report.txt".into(),
                        name: "report.txt".into(),
                    }],
                },
                json!({"kind": "files", "entries": [{"path": "C:\\missing\\report.txt", "name": "report.txt"}]}),
            ),
            (
                RenderModel::Document {
                    asset_id: "asset-2".into(),
                    mime_type: "application/pdf".into(),
                },
                json!({"kind": "document", "assetId": "asset-2", "mimeType": "application/pdf"}),
            ),
            (
                RenderModel::Office {
                    format_key: "windows:office".into(),
                    native_type: Some("Office".into()),
                    byte_length: 12,
                },
                json!({"kind": "office", "formatKey": "windows:office", "nativeType": "Office", "byteLength": 12}),
            ),
            (
                RenderModel::Semantic {
                    facet_id: "core.link.url".into(),
                    text: "https://example.com".into(),
                    payload: json!({"host": "example.com"}),
                },
                json!({"kind": "semantic", "facetId": "core.link.url", "text": "https://example.com", "payload": {"host": "example.com"}}),
            ),
            (
                RenderModel::Unsupported {
                    format_key: "native:x".into(),
                    mime_type: None,
                    native_type: Some("x".into()),
                    byte_length: 3,
                },
                json!({"kind": "unsupported", "formatKey": "native:x", "mimeType": null, "nativeType": "x", "byteLength": 3}),
            ),
            (
                RenderModel::Error {
                    message: "failed".into(),
                },
                json!({"kind": "error", "message": "failed"}),
            ),
        ];

        for (model, expected) in cases {
            assert_eq!(serde_json::to_value(model).unwrap(), expected);
        }

        let files = serde_json::to_value(RenderModel::Files {
            entries: vec![FilePresentation {
                path: "C:\\missing\\report.txt".into(),
                name: "report.txt".into(),
            }],
        })
        .unwrap();
        assert!(files["entries"][0].get("size").is_none());
        assert!(files["entries"][0].get("created").is_none());
        assert!(files["entries"][0].get("modified").is_none());
    }

    #[test]
    fn every_ocr_state_has_a_stable_tag() {
        let states = [
            OcrPresentation::Disabled,
            OcrPresentation::Pending,
            OcrPresentation::Running,
            OcrPresentation::Ready {
                text: "text".into(),
            },
            OcrPresentation::Unsupported,
            OcrPresentation::Failed {
                message: "failed".into(),
            },
        ];
        let tags: Vec<_> = states
            .into_iter()
            .map(|state| {
                serde_json::to_value(state).unwrap()["state"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(
            tags,
            [
                "disabled",
                "pending",
                "running",
                "ready",
                "unsupported",
                "failed"
            ]
        );
    }
}
