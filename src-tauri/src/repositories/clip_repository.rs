#![allow(dead_code)]
use crate::models::{
    compute_index_text, ClipItem, SearchDocument, SearchEmbedding, SearchJob, Tag,
};
use anyhow::Result;
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    AssertSqlSafe, SqlitePool,
};
use std::{str::FromStr, time::Duration};
use tokio::sync::Mutex;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EmbeddingCandidate {
    pub id: String,
    pub index_text: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VisualEmbeddingCandidate {
    pub id: String,
    pub image_path: String,
}

#[derive(Debug, Clone)]
pub struct EmbeddingStats {
    pub total_text_clips: i64,
    pub indexed_clips: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClipIndexStateRow {
    pub clip_id: String,
    pub requires_text: bool,
    pub requires_image: bool,
    pub has_text: bool,
    pub has_image: bool,
    pub job_status: Option<String>,
    pub last_error: Option<String>,
    pub job_search_version: Option<i32>,
    pub document_search_version: Option<i32>,
}

pub struct ClipRepository {
    pool: SqlitePool,
    write_lock: Mutex<()>,
}

struct TypeFilterClause {
    sql: String,
    binds: Vec<String>,
}

pub const SEARCH_DOCUMENT_VERSION: i32 = 1;
const HAS_EMBEDDING_SQL: &str =
    "EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id)";

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

        Ok(Self {
            pool,
            write_lock: Mutex::new(()),
        })
    }

    pub async fn insert(&self, clip: &ClipItem) -> Result<()> {
        let _write_guard = self.write_lock.lock().await;
        sqlx::query(
            r#"
            INSERT INTO clips (
                id, content_type, content_text, content_html, content_rtf,
                svg_path, pdf_path, image_path, attachment_path, attachment_type,
                file_paths, ocr_text, index_text, primary_text_source, ocr_status,
                detected_type, metadata, note, created_at, updated_at, app_name,
                is_pinned, is_favorite, access_count, content_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        .bind(&clip.ocr_text)
        .bind(&clip.index_text)
        .bind(&clip.primary_text_source)
        .bind(&clip.ocr_status)
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
            "SELECT clips.*, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding FROM clips ORDER BY updated_at DESC LIMIT ?"
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
            "SELECT clips.*, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding FROM clips WHERE 1=1"
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

        let mut q = sqlx::query_as::<_, ClipItem>(AssertSqlSafe(sql));
        if let Some(tag_id) = tag_filter {
            q = q.bind(tag_id);
        }
        let clips = q.bind(limit).bind(offset).fetch_all(&self.pool).await?;

        Ok(clips)
    }

    pub async fn get_after_timestamp(&self, timestamp: i64) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            "SELECT clips.*, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding FROM clips WHERE updated_at > ? ORDER BY updated_at DESC",
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
            "SELECT clips.*, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding FROM clips WHERE id = ?"
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
        let sql = format!(
            "SELECT clips.*, {} as has_embedding FROM clips WHERE id IN ({})",
            HAS_EMBEDDING_SQL, placeholders
        );

        let mut query = sqlx::query_as::<_, ClipItem>(AssertSqlSafe(sql));
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

    fn summarize_for_title(primary: Option<&str>, fallback: Option<&str>) -> Option<String> {
        primary
            .filter(|text| !text.trim().is_empty())
            .or_else(|| fallback.filter(|text| !text.trim().is_empty()))
            .map(|text| {
                text.lines()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or(text)
                    .chars()
                    .take(160)
                    .collect()
            })
    }

    fn derive_thumbnail_path(clip: &ClipItem) -> Option<String> {
        clip.image_path
            .clone()
            .or_else(|| clip.svg_path.clone())
            .or_else(|| clip.pdf_path.clone())
    }

    fn meaningful_text(text: Option<&str>) -> Option<String> {
        text.map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    }

    fn canonical_search_text(clip: &ClipItem) -> Option<String> {
        match clip.primary_text_source.as_str() {
            "clipboard" | "office" | "pdf_extract" | "svg_extract" | "ocr" => {
                Self::meaningful_text(clip.content_text.as_deref())
            }
            "note" | "none" => None,
            _ => Self::meaningful_text(clip.content_text.as_deref()),
        }
    }

    fn clip_metadata_json(clip: &ClipItem) -> Option<Value> {
        clip.metadata
            .as_deref()
            .and_then(|metadata| serde_json::from_str::<Value>(metadata).ok())
    }

    fn metadata_search_terms(clip: &ClipItem) -> Vec<String> {
        let mut terms = Vec::new();
        let Some(metadata) = Self::clip_metadata_json(clip) else {
            return terms;
        };

        let mut push_str = |value: Option<&str>| {
            if let Some(value) = Self::meaningful_text(value) {
                terms.push(value.replace('_', " "));
            }
        };

        push_str(metadata.get("source_app").and_then(Value::as_str));
        push_str(metadata.get("office_app").and_then(Value::as_str));
        push_str(metadata.get("office_kind").and_then(Value::as_str));
        push_str(metadata.get("table_source").and_then(Value::as_str));
        push_str(metadata.get("delimiter").and_then(Value::as_str));

        terms
    }

    fn build_search_document_fields(
        clip: &ClipItem,
    ) -> (Option<String>, Option<String>, Option<String>, String) {
        let canonical_text = Self::canonical_search_text(clip);
        let note_text = Self::meaningful_text(clip.note.as_deref());
        let ocr_text = Self::meaningful_text(clip.ocr_text.as_deref());
        let source_app = Self::meaningful_text(clip.app_name.as_deref());
        let metadata_terms = Self::metadata_search_terms(clip);

        let visible_text = canonical_text
            .clone()
            .or_else(|| note_text.clone())
            .or_else(|| ocr_text.clone());

        let title = Self::summarize_for_title(
            visible_text.as_deref(),
            source_app
                .as_deref()
                .or_else(|| metadata_terms.first().map(String::as_str)),
        );

        let mut search_parts: Vec<String> = Vec::new();
        let mut push_unique = |value: Option<String>| {
            if let Some(value) = value {
                if !search_parts
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(&value))
                {
                    search_parts.push(value);
                }
            }
        };

        push_unique(canonical_text.clone());
        push_unique(note_text);
        if ocr_text.as_ref() != canonical_text.as_ref() {
            push_unique(ocr_text.clone());
        }
        push_unique(source_app);
        for term in metadata_terms {
            push_unique(Some(term));
        }

        let search_text = search_parts.join("\n\n");

        (title, visible_text, ocr_text, search_text)
    }

    /// Search clips with FTS and pagination
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
                SELECT clips.*, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding FROM clips
                INNER JOIN search_documents ON search_documents.clip_id = clips.id
                INNER JOIN search_documents_fts ON search_documents.rowid = search_documents_fts.rowid
                WHERE search_documents_fts MATCH ?
            "#,
            );
        } else {
            sql.push_str("SELECT clips.*, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding FROM clips WHERE 1=1");
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
            sql.push_str(
                " ORDER BY search_documents_fts.rank, clips.updated_at DESC LIMIT ? OFFSET ?",
            );
        } else {
            sql.push_str(" ORDER BY clips.updated_at DESC LIMIT ? OFFSET ?");
        }

        let mut query_builder = sqlx::query_as::<_, ClipItem>(AssertSqlSafe(sql));

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
        let mut q = sqlx::query(AssertSqlSafe(sql));
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

    /// Update the note on a clip, recompute index_text, and return the saved row.
    /// Deletes the existing embedding when index_text changes so the next reindex
    /// picks up the fresh vector rather than keeping a stale one.
    pub async fn update_clip_note(&self, clip_id: &str, note: Option<String>) -> Result<ClipItem> {
        let now = chrono::Utc::now().timestamp();
        let _write_guard = self.write_lock.lock().await;
        eprintln!(
            "[NOTE_DEBUG][repository] executing note update | clip_id={} | note={:?} | expected=rows_affected should be 1 and get_by_id should return the saved note",
            clip_id, note
        );

        // Fetch what we need to recompute index_text and primary_text_source correctly.
        let row = sqlx::query_as::<_, (Option<String>, String, String)>(
            "SELECT content_text, index_text, primary_text_source FROM clips WHERE id = ?",
        )
        .bind(clip_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some((content_text, old_index_text, primary_text_source)) = row else {
            anyhow::bail!("Clip not found for note update: {}", clip_id);
        };

        // Determine the new primary_text_source and what feeds into index_text.
        //
        // Real sources (clipboard, office, pdf_extract, svg_extract, ocr) own content_text
        // and always keep their status regardless of note changes.
        //
        // 'none' → a clip whose only possible text contribution is a user note:
        //   - non-empty note: promote to 'note', index_text = note only
        //   - empty note:     stay 'none', index_text = ""
        //
        // 'note' → currently note-only:
        //   - non-empty note: stay 'note', index_text = note only
        //   - empty/cleared note: revert to 'none', index_text = ""
        let real_sources = ["clipboard", "office", "pdf_extract", "svg_extract", "ocr"];
        let is_real_source = real_sources.contains(&primary_text_source.as_str());

        let (new_primary_text_source, index_content) = if is_real_source {
            // Real source: fold note into index_text, source unchanged
            (primary_text_source.clone(), content_text.as_deref())
        } else {
            // 'none' or 'note': note is the only candidate
            match note.as_deref().filter(|s| !s.is_empty()) {
                Some(_) => ("note".to_string(), None),
                None => ("none".to_string(), None),
            }
        };

        let new_index_text = compute_index_text(index_content, note.as_deref());

        let result = sqlx::query(
            "UPDATE clips SET note = ?, index_text = ?, primary_text_source = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&note)
        .bind(&new_index_text)
        .bind(&new_primary_text_source)
        .bind(now)
        .bind(clip_id)
        .execute(&self.pool)
        .await;
        let result = result?;

        eprintln!(
            "[NOTE_DEBUG][repository] update executed | clip_id={} | rows_affected={} | expected=1",
            clip_id,
            result.rows_affected()
        );

        if result.rows_affected() == 0 {
            anyhow::bail!("Clip not found for note update: {}", clip_id);
        }

        // Invalidate the stale embedding so the next reindex generates a fresh vector.
        if new_index_text != old_index_text {
            sqlx::query("DELETE FROM search_embeddings WHERE clip_id = ? AND modality = 'text'")
                .bind(clip_id)
                .execute(&self.pool)
                .await?;
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

    /// Update index_text and optionally ocr_text/content_text/primary_text_source after OCR completes.
    /// Deletes the existing embedding when index_text changes so the next reindex
    /// generates a fresh vector instead of keeping a stale one.
    pub async fn update_after_ocr(
        &self,
        clip_id: &str,
        ocr_text: &str,
        update_content: bool,
    ) -> Result<ClipItem> {
        let now = chrono::Utc::now().timestamp();
        let _write_guard = self.write_lock.lock().await;

        if update_content {
            // Fetch current clip state to decide how to handle empty OCR results
            let Some((note, old_index_text, _old_content_text)) =
                sqlx::query_as::<_, (Option<String>, String, Option<String>)>(
                    "SELECT note, index_text, content_text FROM clips WHERE id = ?",
                )
                .bind(clip_id)
                .fetch_optional(&self.pool)
                .await?
            else {
                anyhow::bail!("Clip not found for OCR update: {}", clip_id);
            };

            // If OCR returns empty text, preserve the original placeholder so the clip remains identifiable
            if ocr_text.is_empty() {
                // Empty OCR: keep original content_text (placeholder), don't mark as primary_text_source='ocr'
                let new_index_text = compute_index_text(None, note.as_deref());

                sqlx::query(
                    "UPDATE clips SET ocr_text = ?, index_text = ?, ocr_status = 'done', updated_at = ? WHERE id = ?",
                )
                .bind(ocr_text)
                .bind(&new_index_text)
                .bind(now)
                .bind(clip_id)
                .execute(&self.pool)
                .await?;

                if new_index_text != old_index_text {
                    sqlx::query(
                        "DELETE FROM search_embeddings WHERE clip_id = ? AND modality = 'text'",
                    )
                    .bind(clip_id)
                    .execute(&self.pool)
                    .await?;
                }
            } else {
                // Non-empty OCR: OCR is now the best text source; update content_text and mark primary_text_source
                let new_index_text = compute_index_text(Some(ocr_text), note.as_deref());

                sqlx::query(
                    "UPDATE clips SET ocr_text = ?, content_text = ?, index_text = ?, \
                     primary_text_source = 'ocr', ocr_status = 'done', updated_at = ? WHERE id = ?",
                )
                .bind(ocr_text)
                .bind(ocr_text)
                .bind(&new_index_text)
                .bind(now)
                .bind(clip_id)
                .execute(&self.pool)
                .await?;

                if new_index_text != old_index_text {
                    sqlx::query(
                        "DELETE FROM search_embeddings WHERE clip_id = ? AND modality = 'text'",
                    )
                    .bind(clip_id)
                    .execute(&self.pool)
                    .await?;
                }
            }
        } else {
            // A stronger source already owns content_text; just store OCR as provenance.
            // index_text is unchanged so the existing embedding remains valid.
            sqlx::query(
                "UPDATE clips SET ocr_text = ?, ocr_status = 'done', updated_at = ? WHERE id = ?",
            )
            .bind(ocr_text)
            .bind(now)
            .bind(clip_id)
            .execute(&self.pool)
            .await?;
        }

        let clip = self
            .get_by_id(clip_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Clip disappeared after OCR update: {}", clip_id))?;

        Ok(clip)
    }

    /// Mark a clip's OCR status without changing any text fields.
    pub async fn set_ocr_status(&self, clip_id: &str, status: &str) -> Result<()> {
        let _write_guard = self.write_lock.lock().await;
        sqlx::query("UPDATE clips SET ocr_status = ? WHERE id = ?")
            .bind(status)
            .bind(clip_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Return all clips with ocr_status = 'pending', ordered oldest-first.
    /// Used by the OCR background worker to drain the queue.
    pub async fn get_pending_ocr_clips(&self) -> Result<Vec<ClipItem>> {
        let clips = sqlx::query_as::<_, ClipItem>(
            "SELECT *, EXISTS(SELECT 1 FROM search_embeddings se WHERE se.clip_id = clips.id) as has_embedding \
             FROM clips WHERE ocr_status = 'pending' ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(clips)
    }

    pub async fn upsert_search_document(&self, clip: &ClipItem) -> Result<SearchDocument> {
        let indexed_at = chrono::Utc::now().timestamp();
        let (title, visible_text, ocr_text, search_text) = Self::build_search_document_fields(clip);
        let thumbnail_path = Self::derive_thumbnail_path(clip);

        let document = sqlx::query_as::<_, SearchDocument>(
            r#"
            INSERT INTO search_documents (
                clip_id, title, visible_text, ocr_text, search_text, source_app,
                thumbnail_path, search_version, indexed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(clip_id) DO UPDATE SET
                title = excluded.title,
                visible_text = excluded.visible_text,
                ocr_text = excluded.ocr_text,
                search_text = excluded.search_text,
                source_app = excluded.source_app,
                thumbnail_path = excluded.thumbnail_path,
                search_version = excluded.search_version,
                indexed_at = excluded.indexed_at
            RETURNING clip_id, title, visible_text, ocr_text, search_text, source_app,
                      thumbnail_path, search_version, indexed_at
            "#,
        )
        .bind(&clip.id)
        .bind(title)
        .bind(visible_text)
        .bind(ocr_text)
        .bind(search_text)
        .bind(&clip.app_name)
        .bind(thumbnail_path)
        .bind(SEARCH_DOCUMENT_VERSION)
        .bind(indexed_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(document)
    }

    pub async fn get_search_document(&self, clip_id: &str) -> Result<Option<SearchDocument>> {
        let document = sqlx::query_as::<_, SearchDocument>(
            "SELECT clip_id, title, visible_text, ocr_text, search_text, source_app, thumbnail_path, search_version, indexed_at FROM search_documents WHERE clip_id = ?",
        )
        .bind(clip_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(document)
    }

    pub async fn enqueue_search_job(&self, clip_id: &str) -> Result<SearchJob> {
        let now = chrono::Utc::now().timestamp();

        let job = sqlx::query_as::<_, SearchJob>(
            r#"
            INSERT INTO search_jobs (
                clip_id, status, attempt_count, last_error, requested_at,
                started_at, completed_at, updated_at, search_version
            )
            VALUES (?, 'pending', 0, NULL, ?, NULL, NULL, ?, ?)
            ON CONFLICT(clip_id) DO UPDATE SET
                status = 'pending',
                last_error = NULL,
                requested_at = excluded.requested_at,
                started_at = NULL,
                completed_at = NULL,
                updated_at = excluded.updated_at,
                search_version = excluded.search_version
            RETURNING id, clip_id, status, attempt_count, last_error, requested_at,
                      started_at, completed_at, updated_at, search_version
            "#,
        )
        .bind(clip_id)
        .bind(now)
        .bind(now)
        .bind(SEARCH_DOCUMENT_VERSION)
        .fetch_one(&self.pool)
        .await?;

        Ok(job)
    }

    pub async fn mark_search_job_running(&self, clip_id: &str) -> Result<SearchJob> {
        let now = chrono::Utc::now().timestamp();

        let job = sqlx::query_as::<_, SearchJob>(
            r#"
            UPDATE search_jobs
            SET status = 'running',
                attempt_count = attempt_count + 1,
                last_error = NULL,
                started_at = ?,
                completed_at = NULL,
                updated_at = ?
            WHERE clip_id = ?
            RETURNING id, clip_id, status, attempt_count, last_error, requested_at,
                      started_at, completed_at, updated_at, search_version
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(clip_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(job)
    }

    pub async fn mark_search_job_completed(&self, clip_id: &str) -> Result<SearchJob> {
        let now = chrono::Utc::now().timestamp();

        let job = sqlx::query_as::<_, SearchJob>(
            r#"
            UPDATE search_jobs
            SET status = 'completed',
                last_error = NULL,
                completed_at = ?,
                updated_at = ?
            WHERE clip_id = ?
            RETURNING id, clip_id, status, attempt_count, last_error, requested_at,
                      started_at, completed_at, updated_at, search_version
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(clip_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(job)
    }

    pub async fn mark_search_job_failed(&self, clip_id: &str, message: &str) -> Result<SearchJob> {
        let now = chrono::Utc::now().timestamp();

        let job = sqlx::query_as::<_, SearchJob>(
            r#"
            UPDATE search_jobs
            SET status = 'failed',
                last_error = ?,
                completed_at = NULL,
                updated_at = ?
            WHERE clip_id = ?
            RETURNING id, clip_id, status, attempt_count, last_error, requested_at,
                      started_at, completed_at, updated_at, search_version
            "#,
        )
        .bind(message)
        .bind(now)
        .bind(clip_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(job)
    }

    pub async fn get_search_job(&self, clip_id: &str) -> Result<Option<SearchJob>> {
        let job = sqlx::query_as::<_, SearchJob>(
            "SELECT id, clip_id, status, attempt_count, last_error, requested_at, started_at, completed_at, updated_at, search_version FROM search_jobs WHERE clip_id = ?",
        )
        .bind(clip_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(job)
    }

    pub async fn upsert_search_embedding(
        &self,
        clip_id: &str,
        modality: &str,
        vector: Vec<u8>,
        model: &str,
        dimensions: i32,
    ) -> Result<SearchEmbedding> {
        let now = chrono::Utc::now().timestamp();

        let embedding = sqlx::query_as::<_, SearchEmbedding>(
            r#"
            INSERT INTO search_embeddings (
                clip_id, modality, model, vector, dimensions, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(clip_id, modality, model) DO UPDATE SET
                vector = excluded.vector,
                dimensions = excluded.dimensions,
                updated_at = excluded.updated_at
            RETURNING id, clip_id, modality, model, vector, dimensions, created_at, updated_at
            "#,
        )
        .bind(clip_id)
        .bind(modality)
        .bind(model)
        .bind(&vector)
        .bind(dimensions)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;

        Ok(embedding)
    }

    pub async fn delete_image_embeddings_for_model(&self, model_name: &str) -> Result<u64> {
        let result =
            sqlx::query("DELETE FROM search_embeddings WHERE modality = 'image' AND model = ?")
                .bind(model_name)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected())
    }

    pub async fn get_search_embedding(
        &self,
        clip_id: &str,
        modality: &str,
        model: &str,
    ) -> Result<Option<SearchEmbedding>> {
        let embedding = sqlx::query_as::<_, SearchEmbedding>(
            "SELECT id, clip_id, modality, model, vector, dimensions, created_at, updated_at FROM search_embeddings WHERE clip_id = ? AND modality = ? AND model = ?",
        )
        .bind(clip_id)
        .bind(modality)
        .bind(model)
        .fetch_optional(&self.pool)
        .await?;

        Ok(embedding)
    }

    pub async fn get_search_embeddings_with_filters(
        &self,
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        modality: &str,
        model: &str,
    ) -> Result<Vec<SearchEmbedding>> {
        let mut sql = String::from(
            "SELECT se.id, se.clip_id, se.modality, se.model, se.vector, se.dimensions, se.created_at, se.updated_at \
             FROM search_embeddings se \
             INNER JOIN clips c ON se.clip_id = c.id \
             WHERE se.modality = ? AND se.model = ?",
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
        if tag_filter.is_some() {
            sql.push_str(" AND c.id IN (SELECT clip_id FROM clip_tags WHERE tag_id = ?)");
        }

        let mut query_builder = sqlx::query_as::<_, SearchEmbedding>(AssertSqlSafe(sql))
            .bind(modality)
            .bind(model);

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

        if let Some(tag_id) = tag_filter {
            query_builder = query_builder.bind(tag_id);
        }

        let embeddings = query_builder.fetch_all(&self.pool).await?;
        Ok(embeddings)
    }

    pub async fn get_text_search_embedding(
        &self,
        clip_id: &str,
        model: &str,
    ) -> Result<Option<SearchEmbedding>> {
        self.get_search_embedding(clip_id, "text", model).await
    }

    pub async fn get_text_search_embeddings_with_filters(
        &self,
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: Option<&str>,
    ) -> Result<Vec<SearchEmbedding>> {
        let mut sql = String::from(
            "SELECT se.id, se.clip_id, se.modality, se.model, se.vector, se.dimensions, se.created_at, se.updated_at \
             FROM search_embeddings se INNER JOIN clips c ON se.clip_id = c.id \
             WHERE se.modality = 'text'",
        );

        if model.is_some() {
            sql.push_str(" AND se.model = ?");
        }

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
        if tag_filter.is_some() {
            sql.push_str(" AND c.id IN (SELECT clip_id FROM clip_tags WHERE tag_id = ?)");
        }

        let mut query_builder = sqlx::query_as::<_, SearchEmbedding>(AssertSqlSafe(sql));

        if let Some(model_name) = model {
            query_builder = query_builder.bind(model_name);
        }

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

        if let Some(tag_id) = tag_filter {
            query_builder = query_builder.bind(tag_id);
        }

        let embeddings = query_builder.fetch_all(&self.pool).await?;
        Ok(embeddings)
    }

    /// Return clips whose index_text is non-empty and lack an up-to-date text
    /// search embedding, or whose embedding has been invalidated after an
    /// index_text change.
    /// Clips with primary_text_source='none' have no real text yet and are excluded.
    pub async fn get_text_embedding_candidates_for_model(
        &self,
        model: &str,
    ) -> Result<Vec<EmbeddingCandidate>> {
        let clips = sqlx::query_as::<_, EmbeddingCandidate>(
            r#"
            SELECT c.id, c.index_text
            FROM clips c
            LEFT JOIN search_embeddings se
              ON se.clip_id = c.id
             AND se.modality = 'text'
             AND se.model = ?
            WHERE c.index_text IS NOT NULL
              AND TRIM(c.index_text) != ''
              AND c.primary_text_source != 'none'
              AND se.clip_id IS NULL
            ORDER BY c.updated_at DESC
            "#,
        )
        .bind(model)
        .fetch_all(&self.pool)
        .await?;

        Ok(clips)
    }

    pub async fn get_visual_embedding_candidates_for_model(
        &self,
        model: &str,
    ) -> Result<Vec<VisualEmbeddingCandidate>> {
        let clips = sqlx::query_as::<_, VisualEmbeddingCandidate>(
            r#"
            SELECT c.id, c.image_path
            FROM clips c
            LEFT JOIN search_embeddings se
              ON se.clip_id = c.id
             AND se.model = ?
             AND se.modality = 'image'
            WHERE c.content_type IN ('image', 'office')
              AND c.image_path IS NOT NULL
              AND TRIM(c.image_path) != ''
              AND se.clip_id IS NULL
            ORDER BY c.updated_at DESC
            "#,
        )
        .bind(model)
        .fetch_all(&self.pool)
        .await?;

        Ok(clips)
    }

    pub async fn get_text_embedding_stats(&self, model: &str) -> Result<EmbeddingStats> {
        let total_text_clips = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM clips
            WHERE index_text IS NOT NULL
              AND TRIM(index_text) != ''
              AND primary_text_source != 'none'
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let indexed_clips = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM search_embeddings
            WHERE modality = 'text' AND model = ?
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

    pub async fn get_clip_index_state_rows(
        &self,
        text_model: &str,
        image_model: &str,
    ) -> Result<Vec<ClipIndexStateRow>> {
        let rows = sqlx::query_as::<_, ClipIndexStateRow>(
            r#"
            SELECT
                c.id AS clip_id,
                CASE
                    WHEN c.index_text IS NOT NULL
                     AND TRIM(c.index_text) != ''
                     AND c.primary_text_source != 'none' THEN 1
                    ELSE 0
                END AS requires_text,
                CASE
                    WHEN c.content_type IN ('image', 'office')
                     AND c.image_path IS NOT NULL
                     AND TRIM(c.image_path) != '' THEN 1
                    ELSE 0
                END AS requires_image,
                EXISTS(
                    SELECT 1
                    FROM search_embeddings se
                    WHERE se.clip_id = c.id
                      AND se.modality = 'text'
                      AND se.model = ?
                ) AS has_text,
                EXISTS(
                    SELECT 1
                    FROM search_embeddings se
                    WHERE se.clip_id = c.id
                      AND se.modality = 'image'
                      AND se.model = ?
                ) AS has_image,
                sj.status AS job_status,
                sj.last_error AS last_error,
                sj.search_version AS job_search_version,
                sd.search_version AS document_search_version
            FROM clips c
            LEFT JOIN search_jobs sj ON sj.clip_id = c.id
            LEFT JOIN search_documents sd ON sd.clip_id = c.id
            WHERE (
                    c.index_text IS NOT NULL
                AND TRIM(c.index_text) != ''
                AND c.primary_text_source != 'none'
            )
               OR (
                    c.content_type IN ('image', 'office')
                AND c.image_path IS NOT NULL
                AND TRIM(c.image_path) != ''
            )
            "#,
        )
        .bind(text_model)
        .bind(image_model)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Delete text search embeddings for a clip.
    pub async fn delete_text_search_embeddings_for_clip(&self, clip_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM search_embeddings WHERE clip_id = ? AND modality = 'text'")
            .bind(clip_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Delete all text search embeddings generated by a specific model.
    pub async fn delete_text_search_embeddings_for_model(&self, model: &str) -> Result<()> {
        sqlx::query("DELETE FROM search_embeddings WHERE model = ? AND modality = 'text'")
            .bind(model)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn delete_search_embeddings_for_model(
        &self,
        model: &str,
        modality: &str,
    ) -> Result<()> {
        sqlx::query("DELETE FROM search_embeddings WHERE model = ? AND modality = ?")
            .bind(model)
            .bind(modality)
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
        sync_search_projection(&repo, &updated).await?;

        assert_eq!(updated.note.as_deref(), Some("fresh note"));

        // Note is folded into index_text, so FTS should find it
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
    async fn test_update_clip_note_index_text_composition() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("body text".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;

        let updated = repo
            .update_clip_note(&clip.id, Some("user note".to_string()))
            .await?;

        assert_eq!(updated.index_text, "body text\n\nuser note");

        Ok(())
    }

    #[tokio::test]
    async fn test_search_paginated_does_not_match_tag_names_as_text() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("boring body".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;
        sync_search_projection(&repo, &clip).await?;

        let tag = repo.create_tag("urgent", None).await?;
        repo.add_tag_to_clip(&clip.id, tag.id).await?;

        let results = repo
            .search_paginated("urgent", None, 20, 0, false, false, None)
            .await?;

        assert!(
            results.iter().all(|result| result.id != clip.id),
            "FTS should not search tag names as text"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_get_text_search_embeddings_with_filters_respects_tag_filter() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let tagged_clip = ClipItem::from_text("tagged body".to_string(), "text".to_string(), None);
        let untagged_clip =
            ClipItem::from_text("untagged body".to_string(), "text".to_string(), None);

        repo.insert(&tagged_clip).await?;
        repo.insert(&untagged_clip).await?;

        repo.upsert_search_embedding(&tagged_clip.id, "text", vec![1, 2, 3, 4], "test-model", 1)
            .await?;
        repo.upsert_search_embedding(&untagged_clip.id, "text", vec![5, 6, 7, 8], "test-model", 1)
            .await?;

        let tag = repo.create_tag("focus", None).await?;
        repo.add_tag_to_clip(&tagged_clip.id, tag.id).await?;

        let filtered = repo
            .get_text_search_embeddings_with_filters(None, false, false, Some(tag.id), None)
            .await?;

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].clip_id, tagged_clip.id);

        Ok(())
    }

    #[tokio::test]
    async fn test_get_text_search_embeddings_with_filters_respects_model_filter() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let current_clip =
            ClipItem::from_text("current model body".to_string(), "text".to_string(), None);
        let stale_clip =
            ClipItem::from_text("stale model body".to_string(), "text".to_string(), None);

        repo.insert(&current_clip).await?;
        repo.insert(&stale_clip).await?;

        repo.upsert_search_embedding(
            &current_clip.id,
            "text",
            vec![1, 2, 3, 4],
            "current-model",
            1,
        )
        .await?;
        repo.upsert_search_embedding(&stale_clip.id, "text", vec![5, 6, 7, 8], "stale-model", 1)
            .await?;

        let filtered = repo
            .get_text_search_embeddings_with_filters(
                None,
                false,
                false,
                None,
                Some("current-model"),
            )
            .await?;

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].clip_id, current_clip.id);
        assert_eq!(filtered[0].model, "current-model");

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
        sync_search_projection(&repo, &csv_clip).await?;

        let mut office_spreadsheet = ClipItem::from_text(
            "product\tqty\npens\t12".to_string(),
            "office".to_string(),
            None,
        );
        office_spreadsheet.content_type = "office".to_string();
        office_spreadsheet.metadata =
            Some(serde_json::json!({ "office_kind": "spreadsheet" }).to_string());
        repo.insert(&office_spreadsheet).await?;
        sync_search_projection(&repo, &office_spreadsheet).await?;

        let mut legacy_html_table =
            ClipItem::from_text("legacy table".to_string(), "office".to_string(), None);
        legacy_html_table.content_type = "office".to_string();
        legacy_html_table.content_html =
            Some("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>".to_string());
        legacy_html_table.metadata =
            Some(serde_json::json!({ "source_app": "Microsoft Excel" }).to_string());
        repo.insert(&legacy_html_table).await?;
        sync_search_projection(&repo, &legacy_html_table).await?;

        let mut office_document =
            ClipItem::from_text("Quarterly memo".to_string(), "office".to_string(), None);
        office_document.content_type = "office".to_string();
        office_document.metadata =
            Some(serde_json::json!({ "office_kind": "document" }).to_string());
        repo.insert(&office_document).await?;
        sync_search_projection(&repo, &office_document).await?;

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

    #[tokio::test]
    async fn test_embedding_candidates_exclude_source_none() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        // Raw image: no text source — must be excluded
        let mut image_no_text =
            ClipItem::from_text("[Image: abc.png]".to_string(), "image".to_string(), None);
        image_no_text.index_text = String::new();
        image_no_text.primary_text_source = "none".to_string();
        image_no_text.ocr_status = "pending".to_string();
        repo.insert(&image_no_text).await?;

        // Regular text clip — must be included
        let text_clip = ClipItem::from_text("hello world".to_string(), "text".to_string(), None);
        repo.insert(&text_clip).await?;

        let candidates = repo
            .get_text_embedding_candidates_for_model("test-model")
            .await?;

        assert!(
            candidates.iter().all(|c| c.id != image_no_text.id),
            "image with no text source must not be a candidate"
        );
        assert!(
            candidates.iter().any(|c| c.id == text_clip.id),
            "text clip must be a candidate"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_note_on_image_clip_promotes_source_to_note() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut image_clip =
            ClipItem::from_text("[Image: abc.png]".to_string(), "image".to_string(), None);
        image_clip.index_text = String::new();
        image_clip.primary_text_source = "none".to_string();
        image_clip.ocr_status = "pending".to_string();
        repo.insert(&image_clip).await?;

        let updated = repo
            .update_clip_note(&image_clip.id, Some("my caption".to_string()))
            .await?;

        assert_eq!(updated.primary_text_source, "note");
        assert_eq!(updated.index_text, "my caption");

        Ok(())
    }

    #[tokio::test]
    async fn test_clearing_note_on_note_only_clip_reverts_to_none() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut image_clip =
            ClipItem::from_text("[Image: abc.png]".to_string(), "image".to_string(), None);
        image_clip.index_text = String::new();
        image_clip.primary_text_source = "none".to_string();
        image_clip.ocr_status = "pending".to_string();
        repo.insert(&image_clip).await?;

        repo.update_clip_note(&image_clip.id, Some("temporary".to_string()))
            .await?;
        let cleared = repo.update_clip_note(&image_clip.id, None).await?;

        assert_eq!(cleared.primary_text_source, "none");
        assert_eq!(cleared.index_text, "");

        Ok(())
    }

    #[tokio::test]
    async fn test_note_only_clip_appears_in_embedding_candidates() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut image_clip =
            ClipItem::from_text("[Image: abc.png]".to_string(), "image".to_string(), None);
        image_clip.index_text = String::new();
        image_clip.primary_text_source = "none".to_string();
        image_clip.ocr_status = "pending".to_string();
        repo.insert(&image_clip).await?;

        repo.update_clip_note(&image_clip.id, Some("searchable caption".to_string()))
            .await?;

        let candidates = repo
            .get_text_embedding_candidates_for_model("test-model")
            .await?;
        assert!(
            candidates.iter().any(|c| c.id == image_clip.id),
            "note-only image clip must be an embedding candidate"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_note_only_clip_counted_by_embedding_stats() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut image_clip =
            ClipItem::from_text("[Image: abc.png]".to_string(), "image".to_string(), None);
        image_clip.index_text = String::new();
        image_clip.primary_text_source = "none".to_string();
        image_clip.ocr_status = "pending".to_string();
        repo.insert(&image_clip).await?;

        let stats_before = repo.get_text_embedding_stats("test-model").await?;

        repo.update_clip_note(&image_clip.id, Some("a note".to_string()))
            .await?;

        let stats_after = repo.get_text_embedding_stats("test-model").await?;
        assert_eq!(
            stats_after.total_text_clips,
            stats_before.total_text_clips + 1,
            "note-only clip must be counted by embedding stats"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_ocr_promotion_from_note_only_preserves_note_in_index_text() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut image_clip =
            ClipItem::from_text("[Image: abc.png]".to_string(), "image".to_string(), None);
        image_clip.index_text = String::new();
        image_clip.primary_text_source = "none".to_string();
        image_clip.ocr_status = "pending".to_string();
        repo.insert(&image_clip).await?;

        // Add a note — promotes to 'note' source
        repo.update_clip_note(&image_clip.id, Some("user caption".to_string()))
            .await?;

        // OCR completes — promotes to 'ocr' source, note must stay in index_text
        let promoted = repo
            .update_after_ocr(&image_clip.id, "extracted text", true)
            .await?;

        assert_eq!(promoted.primary_text_source, "ocr");
        assert_eq!(promoted.index_text, "extracted text\n\nuser caption");

        Ok(())
    }

    #[tokio::test]
    async fn test_note_edit_invalidates_embedding() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("body".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;

        // Give it an embedding
        repo.upsert_search_embedding(&clip.id, "text", vec![1, 2, 3, 4], "test-model", 1)
            .await?;
        assert!(repo
            .get_text_search_embedding(&clip.id, "test-model")
            .await?
            .is_some());

        // Edit the note — index_text changes, embedding must be deleted
        repo.update_clip_note(&clip.id, Some("new note".to_string()))
            .await?;
        assert!(
            repo.get_text_search_embedding(&clip.id, "test-model")
                .await?
                .is_none(),
            "embedding must be invalidated after note changes index_text"
        );

        // The clip now appears as a reindex candidate
        let candidates = repo
            .get_text_embedding_candidates_for_model("test-model")
            .await?;
        assert!(
            candidates.iter().any(|c| c.id == clip.id),
            "clip must be a candidate after embedding invalidation"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_note_edit_no_change_preserves_embedding() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("body".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;

        repo.upsert_search_embedding(&clip.id, "text", vec![1, 2, 3, 4], "test-model", 1)
            .await?;

        // Clear note — index_text stays "body", embedding must survive
        repo.update_clip_note(&clip.id, None).await?;
        assert!(
            repo.get_text_search_embedding(&clip.id, "test-model")
                .await?
                .is_some(),
            "embedding must survive when index_text does not change"
        );

        Ok(())
    }

    // ── OCR state transition tests ────────────────────────────────────────────

    fn make_pending_image_clip() -> ClipItem {
        let mut clip =
            ClipItem::from_text("[Image: test.png]".to_string(), "image".to_string(), None);
        clip.index_text = String::new();
        clip.primary_text_source = "none".to_string();
        clip.ocr_status = "pending".to_string();
        clip
    }

    async fn sync_search_projection(repo: &ClipRepository, clip: &ClipItem) -> Result<()> {
        repo.upsert_search_document(clip).await?;
        repo.enqueue_search_job(&clip.id).await?;
        repo.mark_search_job_completed(&clip.id).await?;
        Ok(())
    }

    async fn assert_search_results(
        repo: &ClipRepository,
        query: &str,
        expected_ids: &[String],
    ) -> Result<()> {
        let ids: Vec<String> = repo
            .search_paginated(query, None, 20, 0, false, false, None)
            .await?
            .into_iter()
            .map(|clip| clip.id)
            .collect();

        assert_eq!(
            ids, expected_ids,
            "query `{query}` should match expected clips"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_search_documents_dual_write_keeps_insert_search_parity() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let matching =
            ClipItem::from_text("search me please".to_string(), "text".to_string(), None);
        let other = ClipItem::from_text("different body".to_string(), "text".to_string(), None);

        repo.insert(&matching).await?;
        repo.insert(&other).await?;

        sync_search_projection(&repo, &matching).await?;
        sync_search_projection(&repo, &other).await?;

        let document = repo.get_search_document(&matching.id).await?.unwrap();
        assert_eq!(document.search_text, matching.index_text);

        let job = repo.get_search_job(&matching.id).await?.unwrap();
        assert_eq!(job.status, "completed");

        assert_search_results(&repo, "search", std::slice::from_ref(&matching.id)).await
    }

    #[tokio::test]
    async fn test_search_documents_dual_write_keeps_note_search_parity() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = make_pending_image_clip();
        repo.insert(&clip).await?;

        let updated = repo
            .update_clip_note(&clip.id, Some("caption text".to_string()))
            .await?;
        sync_search_projection(&repo, &updated).await?;

        let document = repo.get_search_document(&clip.id).await?.unwrap();
        assert_eq!(document.search_text, "caption text");

        assert_search_results(&repo, "caption", std::slice::from_ref(&clip.id)).await
    }

    #[tokio::test]
    async fn test_search_documents_dual_write_keeps_ocr_search_parity() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = make_pending_image_clip();
        repo.insert(&clip).await?;

        let updated = repo
            .update_after_ocr(&clip.id, "ocr extracted text", true)
            .await?;
        sync_search_projection(&repo, &updated).await?;

        let document = repo.get_search_document(&clip.id).await?.unwrap();
        assert_eq!(document.ocr_text.as_deref(), Some("ocr extracted text"));

        assert_search_results(&repo, "extracted", std::slice::from_ref(&clip.id)).await
    }

    #[tokio::test]
    async fn test_search_documents_include_office_metadata_terms() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut office_clip = ClipItem::from_text(
            "Q1 revenue".to_string(),
            "office".to_string(),
            Some(
                serde_json::json!({
                    "source_app": "Microsoft Excel",
                    "office_app": "excel",
                    "office_kind": "spreadsheet",
                    "table_source": "csv_text"
                })
                .to_string(),
            ),
        );
        office_clip.content_type = "office".to_string();
        office_clip.detected_type = "office".to_string();
        office_clip.primary_text_source = "office".to_string();
        office_clip.app_name = Some("Microsoft Excel".to_string());

        repo.insert(&office_clip).await?;
        sync_search_projection(&repo, &office_clip).await?;

        let document = repo.get_search_document(&office_clip.id).await?.unwrap();
        assert!(
            document.search_text.contains("spreadsheet"),
            "search document should include office metadata terms"
        );
        assert!(
            document.search_text.contains("Microsoft Excel"),
            "search document should include source app for office clips"
        );

        assert_search_results(&repo, "spreadsheet", &[office_clip.id.clone()]).await?;
        assert_search_results(&repo, "excel", &[office_clip.id.clone()]).await
    }

    #[tokio::test]
    async fn test_visual_embedding_candidates_require_raster_preview() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut image_clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        image_clip.content_type = "image".to_string();
        image_clip.detected_type = "image".to_string();
        image_clip.image_path = Some("/tmp/image-preview.png".to_string());
        image_clip.index_text.clear();
        image_clip.primary_text_source = "none".to_string();

        let mut office_with_preview =
            ClipItem::from_text("Quarterly plan".to_string(), "office".to_string(), None);
        office_with_preview.content_type = "office".to_string();
        office_with_preview.detected_type = "office".to_string();
        office_with_preview.image_path = Some("/tmp/office-preview.png".to_string());

        let mut office_pdf_only =
            ClipItem::from_text("Quarterly plan".to_string(), "office".to_string(), None);
        office_pdf_only.content_type = "office".to_string();
        office_pdf_only.detected_type = "office".to_string();
        office_pdf_only.pdf_path = Some("/tmp/office-preview.pdf".to_string());

        repo.insert(&image_clip).await?;
        repo.insert(&office_with_preview).await?;
        repo.insert(&office_pdf_only).await?;

        let candidates = repo
            .get_visual_embedding_candidates_for_model("clip-vit-b32")
            .await?;
        let ids: Vec<String> = candidates
            .into_iter()
            .map(|candidate| candidate.id)
            .collect();

        assert!(ids.contains(&image_clip.id));
        assert!(ids.contains(&office_with_preview.id));
        assert!(!ids.contains(&office_pdf_only.id));

        Ok(())
    }

    #[tokio::test]
    async fn test_visual_embedding_candidates_exclude_existing_model_rows() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let mut clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        clip.content_type = "image".to_string();
        clip.detected_type = "image".to_string();
        clip.image_path = Some("/tmp/already-indexed.png".to_string());
        clip.index_text.clear();
        clip.primary_text_source = "none".to_string();
        repo.insert(&clip).await?;

        repo.upsert_search_embedding(&clip.id, "image", vec![1, 2, 3, 4], "clip-vit-b32", 1)
            .await?;

        let same_model = repo
            .get_visual_embedding_candidates_for_model("clip-vit-b32")
            .await?;
        assert!(same_model.iter().all(|candidate| candidate.id != clip.id));

        let other_model = repo
            .get_visual_embedding_candidates_for_model("clip-vit-b16")
            .await?;
        assert!(other_model.iter().any(|candidate| candidate.id == clip.id));

        Ok(())
    }

    #[tokio::test]
    async fn test_get_pending_ocr_clips_returns_pending_only() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let pending = make_pending_image_clip();
        repo.insert(&pending).await?;

        let text_clip = ClipItem::from_text("hello".to_string(), "text".to_string(), None);
        repo.insert(&text_clip).await?;

        let results = repo.get_pending_ocr_clips().await?;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, pending.id);

        Ok(())
    }

    #[tokio::test]
    async fn test_ocr_success_promotes_text_and_marks_done() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = make_pending_image_clip();
        repo.insert(&clip).await?;

        let updated = repo
            .update_after_ocr(&clip.id, "extracted content", true)
            .await?;

        assert_eq!(updated.ocr_status, "done");
        assert_eq!(updated.primary_text_source, "ocr");
        assert_eq!(updated.ocr_text.as_deref(), Some("extracted content"));
        assert!(updated.index_text.contains("extracted content"));

        Ok(())
    }

    #[tokio::test]
    async fn test_ocr_empty_result_preserves_placeholder() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = make_pending_image_clip();
        let original_placeholder = clip.content_text.clone();
        repo.insert(&clip).await?;

        let updated = repo.update_after_ocr(&clip.id, "", true).await?;

        assert_eq!(updated.ocr_status, "done");
        // When OCR returns empty, preserve the original placeholder so clip remains identifiable
        assert_eq!(updated.content_text, original_placeholder);
        // primary_text_source stays "none" because OCR failed to extract meaningful text
        assert_eq!(updated.primary_text_source, "none");
        // index_text stays empty so there's nothing searchable for this clip
        assert!(updated.index_text.is_empty());
        // ocr_text is recorded as empty for audit trail
        assert_eq!(updated.ocr_text.as_deref(), Some(""));

        Ok(())
    }

    #[tokio::test]
    async fn test_ocr_does_not_override_existing_real_source() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        // Simulate an office clip that already has extracted text.
        let mut clip = ClipItem::from_text("office text".to_string(), "office".to_string(), None);
        clip.primary_text_source = "office".to_string();
        clip.ocr_status = "pending".to_string();
        clip.index_text = "office text".to_string();
        repo.insert(&clip).await?;

        // update_content=false because 'office' is a real source.
        let updated = repo
            .update_after_ocr(&clip.id, "ocr overlay text", false)
            .await?;

        assert_eq!(updated.ocr_status, "done");
        assert_eq!(updated.primary_text_source, "office"); // must not be overwritten
        assert_eq!(updated.ocr_text.as_deref(), Some("ocr overlay text"));
        // index_text must be unchanged since update_content=false.
        assert_eq!(updated.index_text, "office text");

        Ok(())
    }

    #[tokio::test]
    async fn test_set_ocr_status_transitions_to_running_and_failed() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = make_pending_image_clip();
        repo.insert(&clip).await?;

        repo.set_ocr_status(&clip.id, "running").await?;
        let running = repo.get_by_id(&clip.id).await?.unwrap();
        assert_eq!(running.ocr_status, "running");

        repo.set_ocr_status(&clip.id, "failed").await?;
        let failed = repo.get_by_id(&clip.id).await?.unwrap();
        assert_eq!(failed.ocr_status, "failed");

        // Failed clips must NOT appear in the pending queue.
        let pending = repo.get_pending_ocr_clips().await?;
        assert!(pending.iter().all(|c| c.id != clip.id));

        Ok(())
    }

    #[tokio::test]
    async fn test_ocr_success_invalidates_stale_embedding() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = make_pending_image_clip();
        repo.insert(&clip).await?;

        // Give the clip a stale embedding (e.g. from a note that was added first).
        repo.upsert_search_embedding(&clip.id, "text", vec![1, 2, 3], "m", 1)
            .await?;
        assert!(repo
            .get_text_search_embedding(&clip.id, "m")
            .await?
            .is_some());

        // OCR completes with new text — index_text changes, embedding must be invalidated.
        let updated = repo
            .update_after_ocr(&clip.id, "new ocr text", true)
            .await?;
        assert_eq!(updated.ocr_status, "done");
        assert!(
            repo.get_text_search_embedding(&clip.id, "m")
                .await?
                .is_none(),
            "stale embedding must be deleted when index_text changes after OCR"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_pending_clips_appear_in_get_pending_queue() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;

        let c1 = make_pending_image_clip();
        let mut c2 = make_pending_image_clip();
        c2.id = format!("{}_2", c2.id);
        repo.insert(&c1).await?;
        repo.insert(&c2).await?;

        let pending = repo.get_pending_ocr_clips().await?;
        assert_eq!(pending.len(), 2);

        // After OCR completes on c1 it must no longer appear.
        repo.update_after_ocr(&c1.id, "text", true).await?;
        let pending2 = repo.get_pending_ocr_clips().await?;
        assert_eq!(pending2.len(), 1);
        assert_eq!(pending2[0].id, c2.id);

        Ok(())
    }

    // ===== has_embedding reflects any modality =====

    #[tokio::test]
    async fn test_has_embedding_false_with_no_embeddings() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("hello".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;

        let fetched = repo.get_by_id(&clip.id).await?.unwrap();
        assert_eq!(fetched.has_embedding, Some(false));
        Ok(())
    }

    #[tokio::test]
    async fn test_has_embedding_true_for_text_embedding() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let clip = ClipItem::from_text("hello".to_string(), "text".to_string(), None);
        repo.insert(&clip).await?;
        repo.upsert_search_embedding(&clip.id, "text", vec![0u8; 4], "test-model", 1)
            .await?;

        let fetched = repo.get_by_id(&clip.id).await?.unwrap();
        assert_eq!(fetched.has_embedding, Some(true));
        Ok(())
    }

    #[tokio::test]
    async fn test_has_embedding_true_for_image_only_embedding() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let mut clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        clip.image_path = Some("/tmp/img.png".to_string());
        repo.insert(&clip).await?;

        // Insert only an image-modality embedding — no text embedding.
        repo.upsert_search_embedding(&clip.id, "image", vec![0u8; 4], "visual-model", 1)
            .await?;

        let fetched = repo.get_by_id(&clip.id).await?.unwrap();
        assert_eq!(
            fetched.has_embedding,
            Some(true),
            "image-only clip with a visual embedding must report has_embedding = true"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_has_embedding_image_only_via_get_recent() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let mut clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        clip.image_path = Some("/tmp/img.png".to_string());
        repo.insert(&clip).await?;
        repo.upsert_search_embedding(&clip.id, "image", vec![0u8; 4], "visual-model", 1)
            .await?;

        let recent = repo.get_recent(10).await?;
        let found = recent.iter().find(|c| c.id == clip.id).unwrap();
        assert_eq!(found.has_embedding, Some(true));
        Ok(())
    }

    // ===== visual embedding failure → search job marked failed =====

    #[tokio::test]
    async fn test_visual_embedding_failure_marks_job_failed() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let mut clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        clip.image_path = Some("/tmp/img.png".to_string());
        repo.insert(&clip).await?;

        repo.upsert_search_document(&clip).await?;
        repo.enqueue_search_job(&clip.id).await?;
        repo.mark_search_job_running(&clip.id).await?;

        let err_msg = "visual model failed: connection refused";
        repo.mark_search_job_failed(&clip.id, err_msg).await?;

        let job = repo.get_search_job(&clip.id).await?.unwrap();
        assert_eq!(job.status, "failed");
        assert_eq!(job.last_error.as_deref(), Some(err_msg));
        Ok(())
    }

    #[tokio::test]
    async fn test_failed_job_status_not_completed() -> Result<()> {
        let repo = ClipRepository::new("sqlite::memory:").await?;
        let mut clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        clip.image_path = Some("/tmp/img.png".to_string());
        repo.insert(&clip).await?;

        repo.upsert_search_document(&clip).await?;
        repo.enqueue_search_job(&clip.id).await?;
        repo.mark_search_job_running(&clip.id).await?;
        repo.mark_search_job_failed(&clip.id, "visual model unavailable")
            .await?;

        let job = repo.get_search_job(&clip.id).await?.unwrap();
        assert_ne!(
            job.status, "completed",
            "a failed visual embedding job must not be marked completed"
        );
        assert!(
            job.completed_at.is_none(),
            "completed_at must be NULL for a failed job"
        );
        Ok(())
    }
}
