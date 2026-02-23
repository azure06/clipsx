use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: String,
    pub content_type: String,
    pub content_text: Option<String>,
    pub content_html: Option<String>,
    pub content_rtf: Option<String>,
    pub image_path: Option<String>,
    pub file_paths: Option<String>, // JSON array
    pub detected_type: String,      // New: 'url', 'code', 'text', etc.
    pub metadata: Option<String>,   // JSON object
    pub created_at: i64,            // Unix timestamp
    pub updated_at: i64,            // Last access timestamp
    pub app_name: Option<String>,
    pub is_pinned: i32,   // SQLite uses INTEGER for boolean
    pub is_favorite: i32, // SQLite uses INTEGER for boolean
    pub access_count: i32,
    pub content_hash: Option<String>,

    #[sqlx(default)]
    pub has_embedding: Option<bool>,

    #[sqlx(default)]
    pub similarity_score: Option<f32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Embedding {
    pub id: i64,
    pub clip_id: String,
    pub vector: Vec<u8>, // Serialized float array (BLOB in DB)
    pub model: String,   // E.g., "text-embedding-3-small"
    pub dimensions: i32, // Vector size (768, 1536, etc.)
    pub created_at: i64,
    pub updated_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipWithTags {
    #[serde(flatten)]
    pub clip: ClipItem,
    pub tags: Vec<Tag>,
    pub collections: Vec<Collection>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClipContent {
    Text { content: String },
    Html { html: String, plain: String },
    Rtf { rtf: String, plain: String },
    Image { path: String },
    Files { paths: Vec<String> },
}

impl ClipItem {
    pub fn from_text(content: String, detected_type: String, metadata: Option<String>) -> Self {
        let id = format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let now = chrono::Utc::now().timestamp();

        // Compute hash for duplicate detection
        let content_hash = Self::compute_hash(&content);

        Self {
            id,
            content_type: "text".to_string(),
            content_text: Some(content),
            content_html: None,
            content_rtf: None,
            image_path: None,
            file_paths: None,
            detected_type,
            metadata,
            created_at: now,
            updated_at: now,
            app_name: None,
            is_pinned: 0,
            is_favorite: 0,
            access_count: 0,
            content_hash: Some(content_hash),
            has_embedding: Some(false),
            similarity_score: None,
        }
    }

    /// Compute SHA-256 hash of content for duplicate detection
    fn compute_hash(content: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    #[allow(dead_code)]
    pub fn content(&self) -> Option<ClipContent> {
        match self.content_type.as_str() {
            "text" => self
                .content_text
                .as_ref()
                .map(|c| ClipContent::Text { content: c.clone() }),
            "html" => {
                if let (Some(html), Some(plain)) = (&self.content_html, &self.content_text) {
                    Some(ClipContent::Html {
                        html: html.clone(),
                        plain: plain.clone(),
                    })
                } else {
                    None
                }
            }
            "rtf" => {
                if let (Some(rtf), Some(plain)) = (&self.content_rtf, &self.content_text) {
                    Some(ClipContent::Rtf {
                        rtf: rtf.clone(),
                        plain: plain.clone(),
                    })
                } else {
                    None
                }
            }
            "image" => self
                .image_path
                .as_ref()
                .map(|p| ClipContent::Image { path: p.clone() }),
            "files" => self.file_paths.as_ref().and_then(|json| {
                serde_json::from_str::<Vec<String>>(json)
                    .ok()
                    .map(|paths| ClipContent::Files { paths })
            }),
            _ => None,
        }
    }
}
