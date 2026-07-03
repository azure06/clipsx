use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocument {
    pub clip_id: String,
    pub title: Option<String>,
    pub visible_text: Option<String>,
    pub ocr_text: Option<String>,
    pub search_text: String,
    pub source_app: Option<String>,
    pub thumbnail_path: Option<String>,
    pub search_version: i32,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchEmbedding {
    pub id: i64,
    pub clip_id: String,
    pub modality: String,
    pub model: String,
    pub vector: Vec<u8>,
    pub dimensions: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchJob {
    pub id: i64,
    pub clip_id: String,
    pub status: String,
    pub attempt_count: i32,
    pub last_error: Option<String>,
    pub requested_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub updated_at: i64,
    pub search_version: i32,
}
