use crate::models::{ClipItem, Tag, Collection, Embedding};
use anyhow::Result;
use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
use std::str::FromStr;

pub struct ClipRepository {
    pool: SqlitePool,
}

impl ClipRepository {
    pub async fn new(database_url: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true);
        
        let pool = SqlitePool::connect_with(options).await?;
        
        // Run migrations
        sqlx::migrate!("./migrations").run(&pool).await?;
        
        Ok(Self { pool })
    }

    pub async fn insert(&self, clip: &ClipItem) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO clips (
                id, content_type, content_text, content_html, content_rtf,
                image_path, file_paths, metadata, created_at, updated_at, app_name,
                is_pinned, is_favorite, access_count, content_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&clip.id)
        .bind(&clip.content_type)
        .bind(&clip.content_text)
        .bind(&clip.content_html)
        .bind(&clip.content_rtf)
        .bind(&clip.image_path)
        .bind(&clip.file_paths)
        .bind(&clip.metadata)
        .bind(clip.created_at)
        .bind(clip.updated_at)
        .bind(&clip.app_name)
        .bind(clip.is_pinned)
        .bind(clip.is_favorite)
        .bind(clip.access_count)
        .bind(&clip.content_hash)
        .execute(&self.pool)
        .await?;
        
        Ok(())
    }

    pub async fn get_recent(&self, limit: i32) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            "SELECT * FROM clips ORDER BY updated_at DESC LIMIT ?"
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(clips)
    }

    pub async fn get_recent_paginated(&self, limit: i32, offset: i32) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            "SELECT * FROM clips ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(clips)
    }

    pub async fn get_after_timestamp(&self, timestamp: i64) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            "SELECT * FROM clips WHERE updated_at > ? ORDER BY updated_at DESC"
        )
        .bind(timestamp)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(clips)
    }

    pub async fn touch(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE clips SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Option<ClipItem>> {
        let clip = sqlx::query_as::<_, ClipItem>("SELECT * FROM clips WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        
        Ok(clip)
    }

    pub async fn search(&self, query: &str, limit: i32) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            r#"
            SELECT clips.* FROM clips
            INNER JOIN clips_fts ON clips.rowid = clips_fts.rowid
            WHERE clips_fts MATCH ?
            ORDER BY clips.updated_at DESC
            LIMIT ?
            "#
        )
        .bind(query)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(clips)
    }

    /// Search clips with FTS and pagination
    /// NOTE: For future semantic search, replace FTS query with embedding similarity
    /// TODO: Add semantic_search_paginated() method that uses embeddings table
    pub async fn search_paginated(&self, query: &str, limit: i32, offset: i32) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            r#"
            SELECT clips.* FROM clips
            INNER JOIN clips_fts ON clips.rowid = clips_fts.rowid
            WHERE clips_fts MATCH ?
            ORDER BY clips.updated_at DESC
            LIMIT ? OFFSET ?
            "#
        )
        .bind(query)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(clips)
    }

    pub async fn delete(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM clips WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }

    pub async fn clear_all(&self) -> Result<()> {
        sqlx::query("DELETE FROM clips")
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }

    /// Find clip by exact content text match
    pub async fn find_by_content_text(&self, content: &str) -> Result<Option<ClipItem>> {
        let clip = sqlx::query_as::<_, ClipItem>(
            "SELECT * FROM clips WHERE content_text = ? LIMIT 1"
        )
        .bind(content)
        .fetch_optional(&self.pool)
        .await?;
        
        Ok(clip)
    }
    
    /// Find clip by content hash for duplicate detection
    pub async fn find_by_hash(&self, hash: &str) -> Result<Option<ClipItem>> {
        let clip = sqlx::query_as::<_, ClipItem>(
            "SELECT * FROM clips WHERE content_hash = ? LIMIT 1"
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await?;
        
        Ok(clip)
    }
    
    /// Toggle pin status
    pub async fn toggle_pin(&self, id: &str) -> Result<bool> {
        let current = sqlx::query_scalar::<_, i32>(
            "SELECT is_pinned FROM clips WHERE id = ?"
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        
        let new_value = if current == 1 { 0 } else { 1 };
        
        sqlx::query("UPDATE clips SET is_pinned = ? WHERE id = ?")
            .bind(new_value)
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(new_value == 1)
    }
    
    /// Toggle favorite status
    pub async fn toggle_favorite(&self, id: &str) -> Result<bool> {
        let current = sqlx::query_scalar::<_, i32>(
            "SELECT is_favorite FROM clips WHERE id = ?"
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        
        let new_value = if current == 1 { 0 } else { 1 };
        
        sqlx::query("UPDATE clips SET is_favorite = ? WHERE id = ?")
            .bind(new_value)
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(new_value == 1)
    }
    
    /// Increment access count
    pub async fn increment_access(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE clips SET access_count = access_count + 1 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
    
    // ===== TAG OPERATIONS =====
    
    /// Create a new tag
    pub async fn create_tag(&self, name: &str, color: Option<String>) -> Result<Tag> {
        let now = chrono::Utc::now().timestamp();
        
        let id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO tags (name, color, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id"
        )
        .bind(name)
        .bind(&color)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;
        
        Ok(Tag {
            id,
            name: name.to_string(),
            color,
            created_at: now,
            updated_at: now,
        })
    }
    
    /// Get all tags
    pub async fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let tags = sqlx::query_as::<_, Tag>("SELECT * FROM tags ORDER BY name")
            .fetch_all(&self.pool)
            .await?;
        
        Ok(tags)
    }
    
    /// Add tag to clip
    pub async fn add_tag_to_clip(&self, clip_id: &str, tag_id: i64) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        
        sqlx::query(
            "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, created_at) VALUES (?, ?, ?)"
        )
        .bind(clip_id)
        .bind(tag_id)
        .bind(now)
        .execute(&self.pool)
        .await?;
        
        Ok(())
    }
    
    /// Remove tag from clip
    pub async fn remove_tag_from_clip(&self, clip_id: &str, tag_id: i64) -> Result<()> {
        sqlx::query("DELETE FROM clip_tags WHERE clip_id = ? AND tag_id = ?")
            .bind(clip_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
    
    /// Get tags for a specific clip
    pub async fn get_tags_for_clip(&self, clip_id: &str) -> Result<Vec<Tag>> {
        let tags = sqlx::query_as::<_, Tag>(
            r#"
            SELECT t.* FROM tags t
            INNER JOIN clip_tags ct ON t.id = ct.tag_id
            WHERE ct.clip_id = ?
            ORDER BY t.name
            "#
        )
        .bind(clip_id)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(tags)
    }
    
    // ===== COLLECTION OPERATIONS =====
    
    /// Create a new collection
    pub async fn create_collection(&self, name: &str, icon: Option<String>, description: Option<String>) -> Result<Collection> {
        let now = chrono::Utc::now().timestamp();
        
        let id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO collections (name, icon, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id"
        )
        .bind(name)
        .bind(&icon)
        .bind(&description)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;
        
        Ok(Collection {
            id,
            name: name.to_string(),
            icon,
            description,
            created_at: now,
            updated_at: now,
        })
    }
    
    /// Get all collections
    pub async fn get_all_collections(&self) -> Result<Vec<Collection>> {
        let collections = sqlx::query_as::<_, Collection>(
            "SELECT * FROM collections ORDER BY name"
        )
        .fetch_all(&self.pool)
        .await?;
        
        Ok(collections)
    }
    
    /// Add clip to collection
    pub async fn add_clip_to_collection(&self, clip_id: &str, collection_id: i64) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        
        sqlx::query(
            "INSERT OR IGNORE INTO clip_collections (clip_id, collection_id, added_at) VALUES (?, ?, ?)"
        )
        .bind(clip_id)
        .bind(collection_id)
        .bind(now)
        .execute(&self.pool)
        .await?;
        
        Ok(())
    }
    
    /// Remove clip from collection
    pub async fn remove_clip_from_collection(&self, clip_id: &str, collection_id: i64) -> Result<()> {
        sqlx::query("DELETE FROM clip_collections WHERE clip_id = ? AND collection_id = ?")
            .bind(clip_id)
            .bind(collection_id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
    
    /// Get collections for a specific clip
    pub async fn get_collections_for_clip(&self, clip_id: &str) -> Result<Vec<Collection>> {
        let collections = sqlx::query_as::<_, Collection>(
            r#"
            SELECT c.* FROM collections c
            INNER JOIN clip_collections cc ON c.id = cc.collection_id
            WHERE cc.clip_id = ?
            ORDER BY c.name
            "#
        )
        .bind(clip_id)
        .fetch_all(&self.pool)
        .await?;
        
        Ok(collections)
    }
    
    // ===== EMBEDDING OPERATIONS (for semantic search) =====
    
    /// Store embedding vector for a clip
    pub async fn create_embedding(&self, clip_id: &str, vector: Vec<u8>, model: &str, dimensions: i32) -> Result<Embedding> {
        let now = chrono::Utc::now().timestamp();
        
        let id = sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO embeddings (clip_id, vector, model, dimensions, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(clip_id) DO UPDATE SET
                vector = excluded.vector,
                model = excluded.model,
                dimensions = excluded.dimensions,
                updated_at = excluded.updated_at
            RETURNING id
            "#
        )
        .bind(clip_id)
        .bind(&vector)
        .bind(model)
        .bind(dimensions)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;
        
        Ok(Embedding {
            id,
            clip_id: clip_id.to_string(),
            vector,
            model: model.to_string(),
            dimensions,
            created_at: now,
            updated_at: now,
        })
    }
    
    /// Get embedding for a clip
    pub async fn get_embedding(&self, clip_id: &str) -> Result<Option<Embedding>> {
        let embedding = sqlx::query_as::<_, Embedding>(
            "SELECT * FROM embeddings WHERE clip_id = ?"
        )
        .bind(clip_id)
        .fetch_optional(&self.pool)
        .await?;
        
        Ok(embedding)
    }
    
    /// Get all embeddings (for similarity search)
    pub async fn get_all_embeddings(&self) -> Result<Vec<Embedding>> {
        let embeddings = sqlx::query_as::<_, Embedding>(
            "SELECT * FROM embeddings ORDER BY created_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;
        
        Ok(embeddings)
    }
    
    /// Delete embedding for a clip
    pub async fn delete_embedding(&self, clip_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM embeddings WHERE clip_id = ?")
            .bind(clip_id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
}
