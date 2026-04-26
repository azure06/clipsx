#![allow(dead_code)]
use crate::models::{ClipItem, Embedding, Tag};
use anyhow::Result;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{str::FromStr, time::Duration};
use tokio::sync::Mutex;

const CLIPS_FTS_TABLE_SQL: &str = r#"
    CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
        id UNINDEXED,
        content_text,
        note,
        content = clips,
        content_rowid = rowid
    )
"#;

const CLIPS_FTS_INSERT_TRIGGER_SQL: &str = r#"
    CREATE TRIGGER IF NOT EXISTS clips_fts_insert
    AFTER INSERT ON clips BEGIN
        INSERT INTO clips_fts(rowid, id, content_text, note)
        VALUES (new.rowid, new.id, new.content_text, new.note);
    END
"#;

const CLIPS_FTS_DELETE_TRIGGER_SQL: &str = r#"
    CREATE TRIGGER IF NOT EXISTS clips_fts_delete
    AFTER DELETE ON clips BEGIN
        INSERT INTO clips_fts(clips_fts, rowid, id, content_text, note)
        VALUES ('delete', old.rowid, old.id, old.content_text, old.note);
    END
"#;

const CLIPS_FTS_UPDATE_TRIGGER_SQL: &str = r#"
    CREATE TRIGGER IF NOT EXISTS clips_fts_update
    AFTER UPDATE ON clips BEGIN
        INSERT INTO clips_fts(clips_fts, rowid, id, content_text, note)
        VALUES ('delete', old.rowid, old.id, old.content_text, old.note);
        INSERT INTO clips_fts(rowid, id, content_text, note)
        VALUES (new.rowid, new.id, new.content_text, new.note);
    END
"#;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EmbeddingCandidate {
    pub id: String,
    pub content_text: String,
}

#[derive(Debug, Clone)]
pub struct EmbeddingStats {
    pub total_text_clips: i64,
    pub indexed_clips: i64,
}

pub struct ClipRepository {
    pool: SqlitePool,
    write_lock: Mutex<()>,
}

struct TypeFilterClause {
    sql: String,
    binds: Vec<String>,
}

impl ClipRepository {
    pub async fn new(database_url: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .busy_timeout(Duration::from_secs(5))
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .min_connections(1)
            .connect_with(options)
            .await?;

        // Run migrations
        sqlx::migrate!("./migrations").run(&pool).await?;

        let repository = Self {
            pool,
            write_lock: Mutex::new(()),
        };
        repository.ensure_clips_fts_healthy().await?;

        Ok(repository)
    }

    fn is_malformed_error(error: &anyhow::Error) -> bool {
        let message = error.to_string().to_lowercase();
        message.contains("database disk image is malformed")
            || message.contains("malformed")
            || message.contains("sql logic error")
    }

    async fn create_clips_fts_schema(&self) -> Result<()> {
        sqlx::query(CLIPS_FTS_TABLE_SQL).execute(&self.pool).await?;
        sqlx::query(CLIPS_FTS_INSERT_TRIGGER_SQL)
            .execute(&self.pool)
            .await?;
        sqlx::query(CLIPS_FTS_DELETE_TRIGGER_SQL)
            .execute(&self.pool)
            .await?;
        sqlx::query(CLIPS_FTS_UPDATE_TRIGGER_SQL)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn rebuild_clips_fts_unlocked(&self) -> Result<()> {
        eprintln!(
            "[NOTE_DEBUG][repository] rebuilding clips_fts | expected=search index should be recreated from clips without losing clip data"
        );

        sqlx::query("DROP TRIGGER IF EXISTS clips_fts_insert")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP TRIGGER IF EXISTS clips_fts_delete")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP TRIGGER IF EXISTS clips_fts_update")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP TABLE IF EXISTS clips_fts")
            .execute(&self.pool)
            .await?;

        self.create_clips_fts_schema().await?;

        sqlx::query("INSERT INTO clips_fts(clips_fts) VALUES('rebuild')")
            .execute(&self.pool)
            .await?;

        eprintln!(
            "[NOTE_DEBUG][repository] rebuilt clips_fts successfully | expected=note and search writes should work again"
        );

        Ok(())
    }

    async fn ensure_clips_fts_healthy_unlocked(&self) -> Result<()> {
        match sqlx::query("INSERT INTO clips_fts(clips_fts) VALUES('integrity-check')")
            .execute(&self.pool)
            .await
        {
            Ok(_) => Ok(()),
            Err(error) => {
                let error = anyhow::Error::from(error);
                if Self::is_malformed_error(&error) {
                    eprintln!(
                        "[NOTE_DEBUG][repository] clips_fts integrity check failed; attempting rebuild | error={} | expected=rebuild should restore FTS writes",
                        error
                    );
                    self.rebuild_clips_fts_unlocked().await
                } else {
                    Err(error)
                }
            }
        }
    }

    async fn ensure_clips_fts_healthy(&self) -> Result<()> {
        let _write_guard = self.write_lock.lock().await;
        self.ensure_clips_fts_healthy_unlocked().await
    }

    pub async fn insert(&self, clip: &ClipItem) -> Result<()> {
        let _write_guard = self.write_lock.lock().await;
        sqlx::query(
            r#"
            INSERT INTO clips (
                id, content_type, content_text, content_html, content_rtf,
                svg_path, pdf_path, image_path, attachment_path, attachment_type,
                file_paths, detected_type, metadata, note, created_at, updated_at, app_name,
                is_pinned, is_favorite, access_count, content_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&clip.id)
        .bind(&clip.content_type)
        .bind(&clip.content_text)
        .bind(&clip.content_html)
        .bind(&clip.content_rtf)
        .bind(&clip.svg_path)
        .bind(&clip.pdf_path)
        .bind(&clip.image_path)
        .bind(&clip.attachment_path)
        .bind(&clip.attachment_type)
        .bind(&clip.file_paths)
        .bind(&clip.detected_type)
        .bind(&clip.metadata)
        .bind(&clip.note)
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
            "SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips ORDER BY updated_at DESC LIMIT ?"
        )
        .bind(limit)
                .fetch_all(&self.pool)
                .await?;

        Ok(clips)
    }

    pub async fn get_recent_paginated(
        &self,
        limit: i32,
        offset: i32,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
    ) -> Result<Vec<ClipItem>> {
        let mut sql = String::from(
            "SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips WHERE 1=1"
        );

        if favorites_only {
            sql.push_str(" AND clips.is_favorite = 1");
        }
        if pinned_only {
            sql.push_str(" AND clips.is_pinned = 1");
        }
        if tag_filter.is_some() {
            sql.push_str(" AND clips.id IN (SELECT clip_id FROM clip_tags WHERE tag_id = ?)");
        }

        sql.push_str(" ORDER BY updated_at DESC LIMIT ? OFFSET ?");

        let mut q = sqlx::query_as::<_, ClipItem>(&sql);
        if let Some(tag_id) = tag_filter {
            q = q.bind(tag_id);
        }
        let clips = q.bind(limit).bind(offset).fetch_all(&self.pool).await?;

        Ok(clips)
    }

    pub async fn get_after_timestamp(&self, timestamp: i64) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            "SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips WHERE updated_at > ? ORDER BY updated_at DESC",
        )
        .bind(timestamp)
        .fetch_all(&self.pool)
        .await?;

        Ok(clips)
    }

    pub async fn touch(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        let _write_guard = self.write_lock.lock().await;
        sqlx::query("UPDATE clips SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Option<ClipItem>> {
        let clip = sqlx::query_as::<_, ClipItem>(
            "SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(clip)
    }

    /// Retrieve multiple clips by ID, maintaining the order of the provided IDs
    pub async fn get_clips_by_ids(&self, ids: &[String]) -> Result<Vec<ClipItem>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders: String = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips WHERE id IN ({})", placeholders);

        let mut query = sqlx::query_as::<_, ClipItem>(&sql);
        for id in ids {
            query = query.bind(id);
        }

        let clips = query.fetch_all(&self.pool).await?;

        // Sort clips to match the order of the input IDs
        let mut sorted_clips = Vec::with_capacity(clips.len());
        for id in ids {
            if let Some(clip) = clips.iter().find(|c| &c.id == id) {
                sorted_clips.push(clip.clone());
            }
        }

        Ok(sorted_clips)
    }

    /// Escape user input for FTS5 MATCH queries with prefix matching.
    ///
    /// FTS5 has special characters that cause syntax errors if unescaped:
    /// - Double quotes (") for phrase search
    /// - Parentheses () for grouping
    /// - AND, OR, NOT operators
    /// - Asterisk (*) for prefix matching
    ///
    /// Strategy: Split into tokens, escape each, add prefix wildcard to last token
    /// for autocomplete-style matching.
    ///
    /// Examples:
    /// - `cli` → `"cli"*` (matches "cli", "clipboard", "click")
    /// - `hello world` → `"hello"* AND "world"*` (both prefix match)
    /// - `user@example.com` → `"user@example.com"*` (literal prefix)
    /// - `"quoted"` → `"""quoted"""*` (escaped quotes with prefix)
    fn escape_fts5_query(query: &str) -> String {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return String::from("\"\"");
        }

        // Split by whitespace for multi-word queries
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();

        if tokens.is_empty() {
            return String::from("\"\"");
        }

        // Escape and add prefix wildcard to each token
        let escaped_tokens: Vec<String> = tokens
            .iter()
            .map(|token| {
                let escaped = token.replace('"', "\"\"");
                format!("\"{}\"*", escaped)
            })
            .collect();

        // Join with AND for multi-word search
        escaped_tokens.join(" AND ")
    }

    fn build_type_filter_clause(alias: &str, filter_types: &[String]) -> Option<TypeFilterClause> {
        if filter_types.is_empty() {
            return None;
        }

        let spreadsheet_office_predicate = format!(
            "({alias}.detected_type = 'office' AND json_extract({alias}.metadata, '$.office_kind') = 'spreadsheet')"
        );

        let mut clauses = Vec::with_capacity(filter_types.len());
        let mut binds = Vec::with_capacity(filter_types.len());

        for filter_type in filter_types {
            if filter_type == "csv" {
                clauses.push(format!(
                    "({alias}.detected_type = ? OR {spreadsheet_office_predicate})"
                ));
            } else {
                clauses.push(format!("{alias}.detected_type = ?"));
            }
            binds.push(filter_type.clone());
        }

        Some(TypeFilterClause {
            sql: format!(" AND ({})", clauses.join(" OR ")),
            binds,
        })
    }

    pub async fn search(
        &self,
        query: &str,
        filter_types: Option<Vec<String>>,
        limit: i32,
    ) -> Result<Vec<ClipItem>> {
        let escaped_query = Self::escape_fts5_query(query);

        // Build base query
        let mut sql = String::new();
        let has_text_query = escaped_query != "\"\"";

        if has_text_query {
            sql.push_str(
                r#"
                SELECT clips.* FROM clips
                INNER JOIN clips_fts ON clips.rowid = clips_fts.rowid
                WHERE clips_fts MATCH ?
            "#,
            );
        } else {
            sql.push_str("SELECT clips.* FROM clips WHERE 1=1");
        }

        // Add filter types if present
        if let Some(types) = &filter_types {
            if let Some(clause) = Self::build_type_filter_clause("clips", types) {
                sql.push_str(&clause.sql);
            }
        }

        if has_text_query {
            sql.push_str(" ORDER BY clips_fts.rank, clips.updated_at DESC LIMIT ?");
        } else {
            sql.push_str(" ORDER BY clips.updated_at DESC LIMIT ?");
        }

        // Bind parameters
        let mut query_builder = sqlx::query_as::<_, ClipItem>(&sql);

        if has_text_query {
            query_builder = query_builder.bind(escaped_query);
        }

        if let Some(types) = &filter_types {
            if let Some(clause) = Self::build_type_filter_clause("clips", types) {
                for t in clause.binds {
                    query_builder = query_builder.bind(t);
                }
            } else {
                for t in types {
                    query_builder = query_builder.bind(t);
                }
            }
        }

        let clips = query_builder.bind(limit).fetch_all(&self.pool).await?;

        Ok(clips)
    }

    /// Search clips with FTS and pagination
    /// NOTE: For future semantic search, replace FTS query with embedding similarity
    /// TODO: Add semantic_search_paginated() method that uses embeddings table
    #[allow(clippy::too_many_arguments)]
    pub async fn search_paginated(
        &self,
        query: &str,
        filter_types: Option<Vec<String>>,
        limit: i32,
        offset: i32,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
    ) -> Result<Vec<ClipItem>> {
        let escaped_query = Self::escape_fts5_query(query);

        let mut sql = String::new();
        let has_text_query = escaped_query != "\"\"";

        if has_text_query {
            sql.push_str(
                r#"
                SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips
                INNER JOIN clips_fts ON clips.rowid = clips_fts.rowid
                WHERE clips_fts MATCH ?
            "#,
            );
        } else {
            sql.push_str("SELECT clips.*, EXISTS(SELECT 1 FROM embeddings e WHERE e.clip_id = clips.id) as has_embedding FROM clips WHERE 1=1");
        }

        if let Some(types) = &filter_types {
            if let Some(clause) = Self::build_type_filter_clause("clips", types) {
                sql.push_str(&clause.sql);
            }
        }

        if favorites_only {
            sql.push_str(" AND clips.is_favorite = 1");
        }
        if pinned_only {
            sql.push_str(" AND clips.is_pinned = 1");
        }
        if tag_filter.is_some() {
            sql.push_str(" AND clips.id IN (SELECT clip_id FROM clip_tags WHERE tag_id = ?)");
        }

        if has_text_query {
            sql.push_str(" ORDER BY clips_fts.rank, clips.updated_at DESC LIMIT ? OFFSET ?");
        } else {
            sql.push_str(" ORDER BY clips.updated_at DESC LIMIT ? OFFSET ?");
        }

        let mut query_builder = sqlx::query_as::<_, ClipItem>(&sql);

        if has_text_query {
            query_builder = query_builder.bind(escaped_query);
        }

        if let Some(types) = &filter_types {
            if let Some(clause) = Self::build_type_filter_clause("clips", types) {
                for t in clause.binds {
                    query_builder = query_builder.bind(t);
                }
            } else {
                for t in types {
                    query_builder = query_builder.bind(t);
                }
            }
        }

        if let Some(tag_id) = tag_filter {
            query_builder = query_builder.bind(tag_id);
        }

        let clips = query_builder
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        Ok(clips)
    }

    pub async fn delete(&self, id: &str) -> Result<()> {
        let _write_guard = self.write_lock.lock().await;
        sqlx::query("DELETE FROM clips WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn clear_all(&self) -> Result<()> {
        let _write_guard = self.write_lock.lock().await;
        sqlx::query("DELETE FROM clips").execute(&self.pool).await?;

        Ok(())
    }

    /// Find clip by exact content text match
    pub async fn find_by_content_text(&self, content: &str) -> Result<Option<ClipItem>> {
        let clip =
            sqlx::query_as::<_, ClipItem>("SELECT * FROM clips WHERE content_text = ? LIMIT 1")
                .bind(content)
                .fetch_optional(&self.pool)
                .await?;

        Ok(clip)
    }

    /// Find clip by content hash for duplicate detection
    pub async fn find_by_hash(&self, hash: &str) -> Result<Option<ClipItem>> {
        let clip =
            sqlx::query_as::<_, ClipItem>("SELECT * FROM clips WHERE content_hash = ? LIMIT 1")
                .bind(hash)
                .fetch_optional(&self.pool)
                .await?;

        Ok(clip)
    }

    /// Toggle pin status
    pub async fn toggle_pin(&self, id: &str) -> Result<bool> {
        let _write_guard = self.write_lock.lock().await;
        let current = sqlx::query_scalar::<_, i32>("SELECT is_pinned FROM clips WHERE id = ?")
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
        let _write_guard = self.write_lock.lock().await;
        let current = sqlx::query_scalar::<_, i32>("SELECT is_favorite FROM clips WHERE id = ?")
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
        let _write_guard = self.write_lock.lock().await;
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
            "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, created_at) VALUES (?, ?, ?)",
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
            "#,
        )
        .bind(clip_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(tags)
    }

    /// Delete a tag (cascades to clip_tags via FK)
    pub async fn delete_tag(&self, tag_id: i64) -> Result<()> {
        sqlx::query("DELETE FROM tags WHERE id = ?")
            .bind(tag_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Fetch tags for multiple clips in one query, returned as (clip_id, Tag) pairs
    pub async fn get_tags_for_clips(
        &self,
        clip_ids: &[String],
    ) -> Result<Vec<(String, crate::models::Tag)>> {
        if clip_ids.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = clip_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT ct.clip_id, t.id, t.name, t.color, t.created_at, t.updated_at \
             FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id \
             WHERE ct.clip_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&sql);
        for id in clip_ids {
            q = q.bind(id);
        }
        let rows = q.fetch_all(&self.pool).await?;
        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            use sqlx::Row;
            let clip_id: String = row.try_get("clip_id")?;
            let tag = crate::models::Tag {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                color: row.try_get("color")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            };
            result.push((clip_id, tag));
        }
        Ok(result)
    }

    /// Update the note on a clip and return the saved row
    pub async fn update_clip_note(&self, clip_id: &str, note: Option<String>) -> Result<ClipItem> {
        let now = chrono::Utc::now().timestamp();
        let _write_guard = self.write_lock.lock().await;
        eprintln!(
            "[NOTE_DEBUG][repository] executing note update | clip_id={} | note={:?} | expected=rows_affected should be 1 and get_by_id should return the saved note",
            clip_id, note
        );
        let update_result = sqlx::query("UPDATE clips SET note = ?, updated_at = ? WHERE id = ?")
            .bind(&note)
            .bind(now)
            .bind(clip_id)
            .execute(&self.pool)
            .await;

        let result = match update_result {
            Ok(result) => result,
            Err(error) => {
                let error = anyhow::Error::from(error);
                if Self::is_malformed_error(&error) {
                    eprintln!(
                        "[NOTE_DEBUG][repository] note update hit malformed DB error; rebuilding clips_fts and retrying | clip_id={} | error={} | expected=retry should succeed",
                        clip_id, error
                    );
                    self.rebuild_clips_fts_unlocked().await?;
                    sqlx::query("UPDATE clips SET note = ?, updated_at = ? WHERE id = ?")
                        .bind(&note)
                        .bind(now)
                        .bind(clip_id)
                        .execute(&self.pool)
                        .await?
                } else {
                    return Err(error);
                }
            }
        };

        eprintln!(
            "[NOTE_DEBUG][repository] update executed | clip_id={} | rows_affected={} | expected=1",
            clip_id,
            result.rows_affected()
        );

        if result.rows_affected() == 0 {
            anyhow::bail!("Clip not found for note update: {}", clip_id);
        }

        let clip = self
            .get_by_id(clip_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Clip disappeared after note update: {}", clip_id))?;

        eprintln!(
            "[NOTE_DEBUG][repository] fetched clip after update | clip_id={} | fetched_note={:?} | expected=fetched_note should match the saved note",
            clip.id, clip.note
        );

        Ok(clip)
    }

    // ===== EMBEDDING OPERATIONS (for semantic search) =====

    /// Store embedding vector for a clip
    pub async fn create_embedding(
        &self,
        clip_id: &str,
        vector: Vec<u8>,
        model: &str,
        dimensions: i32,
    ) -> Result<Embedding> {
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
            "#,
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
        let embedding =
            sqlx::query_as::<_, Embedding>("SELECT * FROM embeddings WHERE clip_id = ?")
                .bind(clip_id)
                .fetch_optional(&self.pool)
                .await?;

        Ok(embedding)
    }

    pub async fn get_embeddings_with_filters(
        &self,
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
    ) -> Result<Vec<Embedding>> {
        let mut sql = String::from(
            "SELECT e.* FROM embeddings e INNER JOIN clips c ON e.clip_id = c.id WHERE 1=1",
        );

        if let Some(types) = &filter_types {
            if let Some(clause) = Self::build_type_filter_clause("c", types) {
                sql.push_str(&clause.sql);
            }
        }

        if favorites_only {
            sql.push_str(" AND c.is_favorite = 1");
        }
        if pinned_only {
            sql.push_str(" AND c.is_pinned = 1");
        }

        let mut query_builder = sqlx::query_as::<_, Embedding>(&sql);

        if let Some(types) = &filter_types {
            if let Some(clause) = Self::build_type_filter_clause("c", types) {
                for t in clause.binds {
                    query_builder = query_builder.bind(t);
                }
            } else {
                for t in types {
                    query_builder = query_builder.bind(t);
                }
            }
        }

        let embeddings = query_builder.fetch_all(&self.pool).await?;
        Ok(embeddings)
    }

    pub async fn get_embedding_candidates_for_model(
        &self,
        model: &str,
    ) -> Result<Vec<EmbeddingCandidate>> {
        let clips = sqlx::query_as::<_, EmbeddingCandidate>(
            r#"
            SELECT c.id, c.content_text
            FROM clips c
            LEFT JOIN embeddings e ON e.clip_id = c.id
            WHERE c.content_text IS NOT NULL
              AND TRIM(c.content_text) != ''
              AND (e.clip_id IS NULL OR e.model != ?)
            ORDER BY c.updated_at DESC
            "#,
        )
        .bind(model)
        .fetch_all(&self.pool)
        .await?;

        Ok(clips)
    }

    pub async fn get_embedding_stats(&self, model: &str) -> Result<EmbeddingStats> {
        let total_text_clips = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM clips
            WHERE content_text IS NOT NULL
              AND TRIM(content_text) != ''
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let indexed_clips = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM embeddings
            WHERE model = ?
            "#,
        )
        .bind(model)
        .fetch_one(&self.pool)
        .await?;

        Ok(EmbeddingStats {
            total_text_clips,
            indexed_clips,
        })
    }

    /// Delete embedding for a clip
    pub async fn delete_embedding(&self, clip_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM embeddings WHERE clip_id = ?")
            .bind(clip_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Enforce storage limits based on settings.
    ///
    /// Pinned **and** favorited clips are always exempt from automatic deletion.
    ///
    /// 1. Delete clips older than `max_age_days` (if > 0).
    /// 2. If total non-protected count still exceeds `max_clips` (if > 0), delete the
    ///    oldest non-protected clips until we're back under the limit.
    ///
    /// Returns the number of clips deleted.
    pub async fn enforce_storage_limits(&self, max_clips: u32, max_age_days: u32) -> Result<u64> {
        let mut deleted: u64 = 0;

        // --- Step 1: Age-based pruning ---
        if max_age_days > 0 {
            let cutoff = chrono::Utc::now().timestamp() - (max_age_days as i64 * 24 * 60 * 60);

            let result = sqlx::query(
                "DELETE FROM clips WHERE is_pinned = 0 AND is_favorite = 0 AND created_at < ?",
            )
            .bind(cutoff)
            .execute(&self.pool)
            .await?;

            deleted += result.rows_affected();
        }

        // --- Step 2: Count-based pruning ---
        if max_clips > 0 {
            let total: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM clips WHERE is_pinned = 0 AND is_favorite = 0",
            )
            .fetch_one(&self.pool)
            .await?;

            let overflow = total - max_clips as i64;
            if overflow > 0 {
                // Delete the oldest non-protected clips
                let result = sqlx::query(
                    "DELETE FROM clips WHERE is_pinned = 0 AND is_favorite = 0 AND id IN \
                     (SELECT id FROM clips WHERE is_pinned = 0 AND is_favorite = 0 \
                      ORDER BY updated_at ASC LIMIT ?)",
                )
                .bind(overflow)
                .execute(&self.pool)
                .await?;

                deleted += result.rows_affected();
            }
        }

        if deleted > 0 {
            eprintln!("[STORAGE] Pruned {} old clip(s)", deleted);
        }

        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_fts5_query_simple() {
        let result = ClipRepository::escape_fts5_query("hello world");
        assert_eq!(result, "\"hello\"* AND \"world\"*");
    }

    #[test]
    fn test_escape_fts5_query_single_word() {
        let result = ClipRepository::escape_fts5_query("cli");
        assert_eq!(result, "\"cli\"*");
    }

    #[test]
    fn test_escape_fts5_query_with_quotes() {
        let result = ClipRepository::escape_fts5_query("say \"hello\"");
        assert_eq!(result, "\"say\"* AND \"\"\"hello\"\"\"*");
    }

    #[test]
    fn test_escape_fts5_query_email() {
        let result = ClipRepository::escape_fts5_query("user@example.com");
        assert_eq!(result, "\"user@example.com\"*");
    }

    #[test]
    fn test_escape_fts5_query_path() {
        let result = ClipRepository::escape_fts5_query("C:\\Users\\foo");
        assert_eq!(result, "\"C:\\Users\\foo\"*");
    }

    #[test]
    fn test_escape_fts5_query_special_chars() {
        // Parentheses, asterisks, AND/OR operators should be treated as literals in each token
        let result = ClipRepository::escape_fts5_query("(foo AND bar) OR baz*");
        assert_eq!(
            result,
            "\"(foo\"* AND \"AND\"* AND \"bar)\"* AND \"OR\"* AND \"baz*\"*"
        );
    }

    #[test]
    fn test_escape_fts5_query_empty() {
        let result = ClipRepository::escape_fts5_query("");
        assert_eq!(result, "\"\"");
    }

    #[test]
    fn test_escape_fts5_query_whitespace() {
        let result = ClipRepository::escape_fts5_query("   ");
        assert_eq!(result, "\"\"");
    }

    // ===== Shared test helper =====

    /// Populate an in-memory repository with `normal` plain clips, `pinned` pinned clips,
    /// and `favs` favourite clips.  Normal clips have staggered `updated_at` so ordering
    /// is deterministic (clip 0 is always the newest).  Protected clips are pushed far
    /// into the past to prove the exemption guard works regardless of ordering.
    async fn make_repo(normal: u32, pinned: u32, favs: u32) -> Result<ClipRepository> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let base = chrono::Utc::now().timestamp();

        for i in 0..normal {
            let mut c = ClipItem::from_text(format!("normal {}", i), "text".to_string(), None);
            // clip 0 = most recent, clip N-1 = oldest
            c.updated_at = base - i as i64 * 10;
            c.created_at = c.updated_at;
            repo.insert(&c).await?;
        }

        for i in 0..pinned {
            let mut c = ClipItem::from_text(format!("pinned {}", i), "text".to_string(), None);
            c.is_pinned = 1;
            c.updated_at = base - 100_000 - i as i64 * 10;
            c.created_at = c.updated_at;
            repo.insert(&c).await?;
        }

        for i in 0..favs {
            let mut c = ClipItem::from_text(format!("fav {}", i), "text".to_string(), None);
            c.is_favorite = 1;
            c.updated_at = base - 200_000 - i as i64 * 10;
            c.created_at = c.updated_at;
            repo.insert(&c).await?;
        }

        Ok(repo)
    }

    // ===== enforce_storage_limits — count-based =====

    /// 5 normal + 1 pinned + 1 fav → limit 3.
    /// Expect 2 deletions; protected clips stay.
    #[tokio::test]
    async fn test_enforce_storage_limits_basic() -> Result<()> {
        let repo = make_repo(5, 1, 1).await?;

        let deleted = repo.enforce_storage_limits(3, 0).await?;
        assert_eq!(deleted, 2, "should delete exactly 2 non-protected clips");

        let remaining = repo.get_recent(20).await?;
        // 3 normal + 1 pinned + 1 fav
        assert_eq!(remaining.len(), 5);
        assert!(
            remaining.iter().any(|c| c.is_pinned == 1),
            "pinned must survive"
        );
        assert!(
            remaining.iter().any(|c| c.is_favorite == 1),
            "favorite must survive"
        );

        Ok(())
    }

    /// max_clips = 0 (unlimited) → nothing deleted.
    #[tokio::test]
    async fn test_enforce_storage_limits_unlimited_noop() -> Result<()> {
        let repo = make_repo(10, 0, 0).await?;
        let deleted = repo.enforce_storage_limits(0, 0).await?;
        assert_eq!(deleted, 0, "unlimited mode must not delete anything");
        assert_eq!(repo.get_recent(20).await?.len(), 10);
        Ok(())
    }

    /// Already within the limit → no deletion.
    #[tokio::test]
    async fn test_enforce_storage_limits_within_limit_noop() -> Result<()> {
        let repo = make_repo(3, 0, 0).await?;
        let deleted = repo.enforce_storage_limits(10, 0).await?;
        assert_eq!(deleted, 0, "already under limit — nothing to delete");
        assert_eq!(repo.get_recent(20).await?.len(), 3);
        Ok(())
    }

    /// Count equals limit exactly → no deletion.
    #[tokio::test]
    async fn test_enforce_storage_limits_exactly_at_limit() -> Result<()> {
        let repo = make_repo(5, 0, 0).await?;
        let deleted = repo.enforce_storage_limits(5, 0).await?;
        assert_eq!(deleted, 0, "exactly at limit — nothing to delete");
        assert_eq!(repo.get_recent(20).await?.len(), 5);
        Ok(())
    }

    /// Limit = 1 with 10 clips → only the newest survives.
    #[tokio::test]
    async fn test_enforce_storage_limits_aggressive_trim() -> Result<()> {
        let repo = make_repo(10, 0, 0).await?;
        let deleted = repo.enforce_storage_limits(1, 0).await?;
        assert_eq!(deleted, 9, "should leave exactly 1 clip");
        let remaining = repo.get_recent(20).await?;
        assert_eq!(remaining.len(), 1);
        // clip 0 is the most recent and must be the survivor
        assert_eq!(
            remaining[0].content_text.as_deref(),
            Some("normal 0"),
            "newest clip should survive"
        );
        Ok(())
    }

    /// Protected clips are NOT counted toward the limit — only normal clips are pruned.
    #[tokio::test]
    async fn test_enforce_storage_limits_protected_clips_excluded_from_count() -> Result<()> {
        // 4 normal + 2 pinned + 2 fav → limit 2 should delete 2 normal
        let repo = make_repo(4, 2, 2).await?;
        let deleted = repo.enforce_storage_limits(2, 0).await?;
        assert_eq!(deleted, 2, "only 2 of the 4 normal clips deleted");
        let remaining = repo.get_recent(20).await?;
        // 2 normal + 2 pinned + 2 fav = 6
        assert_eq!(remaining.len(), 6);
        assert_eq!(remaining.iter().filter(|c| c.is_pinned == 1).count(), 2);
        assert_eq!(remaining.iter().filter(|c| c.is_favorite == 1).count(), 2);
        Ok(())
    }

    /// Empty DB → 0 deletions, no panic.
    #[tokio::test]
    async fn test_enforce_storage_limits_empty_db() -> Result<()> {
        let repo = make_repo(0, 0, 0).await?;
        let deleted = repo.enforce_storage_limits(10, 0).await?;
        assert_eq!(deleted, 0);
        Ok(())
    }

    // ===== enforce_storage_limits — age-based =====

    /// Clips older than max_age_days are deleted; protected clips are spared.
    #[tokio::test]
    async fn test_enforce_storage_limits_age_prunes_old_clips() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let now = chrono::Utc::now().timestamp();

        // A fresh clip (created now)
        let mut new_clip = ClipItem::from_text("new clip".to_string(), "text".to_string(), None);
        new_clip.created_at = now;
        new_clip.updated_at = now;
        repo.insert(&new_clip).await?;

        // An old clip (91 days old) — should be pruned
        let mut old_clip = ClipItem::from_text("old clip".to_string(), "text".to_string(), None);
        old_clip.created_at = now - 91 * 24 * 60 * 60;
        old_clip.updated_at = old_clip.created_at;
        repo.insert(&old_clip).await?;

        // An old pinned clip — must survive despite age
        let mut old_pinned =
            ClipItem::from_text("old pinned".to_string(), "text".to_string(), None);
        old_pinned.is_pinned = 1;
        old_pinned.created_at = now - 91 * 24 * 60 * 60;
        old_pinned.updated_at = old_pinned.created_at;
        repo.insert(&old_pinned).await?;

        let deleted = repo.enforce_storage_limits(0, 90).await?;
        assert_eq!(deleted, 1, "only the non-protected old clip deleted");

        let remaining = repo.get_recent(10).await?;
        assert_eq!(remaining.len(), 2, "new clip + old pinned survive");

        let texts: Vec<_> = remaining
            .iter()
            .filter_map(|c| c.content_text.as_deref())
            .collect();
        assert!(texts.contains(&"new clip"));
        assert!(texts.contains(&"old pinned"));

        Ok(())
    }

    /// max_age_days = 0 disables age-based deletion entirely.
    #[tokio::test]
    async fn test_enforce_storage_limits_age_zero_is_noop() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let now = chrono::Utc::now().timestamp();

        let mut ancient = ClipItem::from_text("ancient".to_string(), "text".to_string(), None);
        ancient.created_at = now - 3650 * 24 * 60 * 60; // 10 years old
        ancient.updated_at = ancient.created_at;
        repo.insert(&ancient).await?;

        let deleted = repo.enforce_storage_limits(0, 0).await?;
        assert_eq!(
            deleted, 0,
            "age-based deletion disabled when max_age_days=0"
        );
        Ok(())
    }

    /// Favourite clips are spared from age-based deletion just like pinned ones.
    #[tokio::test]
    async fn test_enforce_storage_limits_age_spares_favorites() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let now = chrono::Utc::now().timestamp();

        let mut fav = ClipItem::from_text("old fav".to_string(), "text".to_string(), None);
        fav.is_favorite = 1;
        fav.created_at = now - 91 * 24 * 60 * 60;
        fav.updated_at = fav.created_at;
        repo.insert(&fav).await?;

        let deleted = repo.enforce_storage_limits(0, 30).await?;
        assert_eq!(deleted, 0, "favourite clips must survive age-based pruning");
        Ok(())
    }

    /// Age step + count step both fire; deleted counts combine correctly.
    #[tokio::test]
    async fn test_enforce_storage_limits_combined_age_and_count() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let now = chrono::Utc::now().timestamp();

        // 3 recent clips
        for i in 0..3u32 {
            let mut c = ClipItem::from_text(format!("recent {}", i), "text".to_string(), None);
            c.created_at = now - i as i64 * 10;
            c.updated_at = c.created_at;
            repo.insert(&c).await?;
        }

        // 2 old clips (> 30 days) — age step removes these
        for i in 0..2u32 {
            let mut c = ClipItem::from_text(format!("old {}", i), "text".to_string(), None);
            c.created_at = now - 31 * 24 * 60 * 60 - i as i64 * 10;
            c.updated_at = c.created_at;
            repo.insert(&c).await?;
        }

        // After age pruning 3 remain; max_clips = 2 → 1 more deleted by count
        let deleted = repo.enforce_storage_limits(2, 30).await?;
        assert_eq!(deleted, 3, "2 by age + 1 by count = 3 total");

        let remaining = repo.get_recent(10).await?;
        assert_eq!(remaining.len(), 2);
        Ok(())
    }

    #[tokio::test]
    async fn test_update_clip_note_keeps_fts_searchable() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("alpha body".to_string(), "text".to_string(), None);

        repo.insert(&clip).await?;
        let updated = repo
            .update_clip_note(&clip.id, Some("fresh note".to_string()))
            .await?;

        assert_eq!(updated.note.as_deref(), Some("fresh note"));

        let results = repo
            .search_paginated("fresh", None, 20, 0, false, false, None)
            .await?;

        assert!(
            results.iter().any(|result| result.id == clip.id),
            "clip should still be searchable by its updated note"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_csv_filter_includes_only_csv_and_office_spreadsheets() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let csv_clip = ClipItem::from_text(
            "name,age\nalice,30".to_string(),
            "csv".to_string(),
            Some(serde_json::json!({ "delimiter": ",", "rows": 2, "columns": 2 }).to_string()),
        );
        repo.insert(&csv_clip).await?;

        let mut office_spreadsheet = ClipItem::from_text(
            "product\tqty\npens\t12".to_string(),
            "office".to_string(),
            None,
        );
        office_spreadsheet.content_type = "office".to_string();
        office_spreadsheet.metadata =
            Some(serde_json::json!({ "office_kind": "spreadsheet" }).to_string());
        repo.insert(&office_spreadsheet).await?;

        let mut legacy_html_table =
            ClipItem::from_text("legacy table".to_string(), "office".to_string(), None);
        legacy_html_table.content_type = "office".to_string();
        legacy_html_table.content_html =
            Some("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>".to_string());
        legacy_html_table.metadata =
            Some(serde_json::json!({ "source_app": "Microsoft Excel" }).to_string());
        repo.insert(&legacy_html_table).await?;

        let mut office_document =
            ClipItem::from_text("Quarterly memo".to_string(), "office".to_string(), None);
        office_document.content_type = "office".to_string();
        office_document.metadata =
            Some(serde_json::json!({ "office_kind": "document" }).to_string());
        repo.insert(&office_document).await?;

        let csv_results = repo
            .search_paginated("", Some(vec!["csv".to_string()]), 20, 0, false, false, None)
            .await?;
        let csv_ids: std::collections::HashSet<String> =
            csv_results.into_iter().map(|clip| clip.id).collect();

        assert!(csv_ids.contains(&csv_clip.id));
        assert!(csv_ids.contains(&office_spreadsheet.id));
        assert!(!csv_ids.contains(&legacy_html_table.id));
        assert!(!csv_ids.contains(&office_document.id));

        let office_results = repo
            .search_paginated(
                "",
                Some(vec!["office".to_string()]),
                20,
                0,
                false,
                false,
                None,
            )
            .await?;
        let office_ids: std::collections::HashSet<String> =
            office_results.into_iter().map(|clip| clip.id).collect();

        assert!(office_ids.contains(&office_spreadsheet.id));
        assert!(office_ids.contains(&legacy_html_table.id));
        assert!(office_ids.contains(&office_document.id));
        assert!(!office_ids.contains(&csv_clip.id));

        Ok(())
    }
}
