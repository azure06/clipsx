//! Authenticated, atomic clipboard actions. Adapters supply the actor, never tool arguments.
use super::{
    contracts::*,
    service::{require_eligible_in, validate_id, ClipboardService},
};
use crate::{
    failure::FailureCode,
    history::{new_id, now_ms, sha256},
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};
use std::collections::HashSet;

const RETENTION: i64 = 30 * 86_400_000;
pub struct Actor {
    id: String,
    origin: &'static str,
    model: Option<ModelAttribution>,
}
impl Actor {
    pub fn native() -> Self {
        Self {
            id: "clipsx".into(),
            origin: "native_assistant",
            model: None,
        }
    }
    pub fn native_run(model: ModelAttribution) -> Self {
        Self {
            model: Some(model),
            ..Self::native()
        }
    }
    pub fn mcp(grant_id: &str) -> Self {
        Self {
            id: format!("mcp:{grant_id}"),
            origin: "mcp_client",
            model: None,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct OrganizationState {
    clip_id: String,
    note: Option<String>,
    favorite: bool,
    pinned: bool,
    tags: Vec<String>,
}

impl ClipboardService {
    pub async fn create(
        &self,
        actor: &Actor,
        request: CreateClipRequest,
    ) -> Result<ClipboardActionResult> {
        validate_id(&request.request_id)?;
        if request.text.is_empty()
            || request.text.len() > 256 * 1024
            || request.sources.as_ref().is_some_and(|s| s.len() > 20)
        {
            return Err(FailureCode::InputLimit.failure().into());
        }
        if request.model.as_ref().is_some_and(|m| {
            m.model.is_empty()
                || m.model.len() > 256
                || m.provider.is_empty()
                || m.provider.len() > 64
        }) {
            return Err(FailureCode::InvalidParameters.failure().into());
        }
        let arguments = sha256(&serde_json::to_vec(&request)?);
        let mut tx = self.history.pool.begin_with("BEGIN IMMEDIATE").await?;
        if let Some(result) = self
            .replay(&mut tx, actor, &request.request_id, &arguments)
            .await?
        {
            return Ok(result);
        }
        let sources = request.sources.clone().unwrap_or_default();
        for source in &sources {
            validate_id(&source.representation_id)?;
            let clip = self.metadata_in(&mut tx, &source.clip_id).await?;
            if !clip
                .representations
                .iter()
                .any(|r| r.id == source.representation_id && r.fingerprint == source.fingerprint)
            {
                return Err(FailureCode::StaleContext.failure().into());
            }
        }
        let now = now_ms();
        let clip_id = new_id();
        let rep_id = new_id();
        let mime = match request.format {
            CreatedTextFormat::PlainText => "text/plain",
            CreatedTextFormat::Markdown => "text/markdown",
        };
        // Canonical creation is independent of capture deduplication and extension jobs.
        let capture_hash = sha256(&serde_json::to_vec(&(mime, &request.text))?);
        sqlx::query("INSERT INTO clip_items(id,source_app_name,source_app_id,captured_at,updated_at,lifecycle_state,capture_sha256,total_payload_bytes) VALUES(?,'ClipsX','clipsx.assistant',?,?,'pending',?,?)").bind(&clip_id).bind(now).bind(now).bind(capture_hash).bind(request.text.len() as i64).execute(&mut *tx).await?;
        let platform = super::representation_platform();
        sqlx::query("INSERT INTO clip_representations(id,clip_id,format_key,canonical_mime_type,capability_id,format_family,platform,storage_kind,ordinal,capture_priority,lifecycle_state,created_at,updated_at) VALUES(?,?,?,?,?,'text',?,'text',0,0,'pending',?,?)").bind(&rep_id).bind(&clip_id).bind(mime).bind(mime).bind(if mime=="text/markdown" {"core.text.markdown"} else {"core.text.plain"}).bind(platform).bind(now).bind(now).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO clip_text_values VALUES(?,?,?,?)")
            .bind(&rep_id)
            .bind(&request.text)
            .bind(request.text.len() as i64)
            .bind(sha256(request.text.as_bytes()))
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE clip_representations SET lifecycle_state='ready' WHERE id=?")
            .bind(&rep_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE clip_items SET lifecycle_state='ready' WHERE id=?")
            .bind(&clip_id)
            .execute(&mut *tx)
            .await?;
        let model = if actor.origin == "mcp_client" {
            request.model.as_ref()
        } else {
            actor.model.as_ref()
        };
        sqlx::query("INSERT INTO assistant_clip_provenance VALUES(?,?,?,?,?,?,?)")
            .bind(&clip_id)
            .bind(&actor.id)
            .bind(actor.origin)
            .bind(serde_json::to_string(&sources)?)
            .bind(model.map(serde_json::to_string).transpose()?)
            .bind(if model.is_none() {
                "none"
            } else if actor.origin == "mcp_client" {
                "client_supplied"
            } else {
                "host_verified"
            })
            .bind(now)
            .execute(&mut *tx)
            .await?;
        intent(&mut tx, &clip_id).await?;
        let clip = self.metadata_in(&mut tx, &clip_id).await?;
        let result = action(
            "create",
            vec![ClipRevision {
                clip_id,
                revision: clip.revision,
            }],
            now,
        );
        persist(
            &mut tx,
            actor,
            &request.request_id,
            &arguments,
            &result,
            "[]",
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }

    pub async fn organize(
        &self,
        actor: &Actor,
        request: OrganizeClipsRequest,
    ) -> Result<ClipboardActionResult> {
        validate_id(&request.request_id)?;
        if request.clips.is_empty()
            || request.clips.len() > 50
            || request.note.as_ref().is_some_and(|s| s.len() > 32 * 1024)
        {
            return Err(FailureCode::InputLimit.failure().into());
        }
        let add = request.add_tags.clone().unwrap_or_default();
        let remove = request.remove_tags.clone().unwrap_or_default();
        if add.len() + remove.len() > 50
            || add
                .iter()
                .chain(&remove)
                .any(|s| s.trim() != s || s.is_empty() || s.len() > 128)
        {
            return Err(FailureCode::InvalidParameters.failure().into());
        }
        let arguments = sha256(&serde_json::to_vec(&request)?);
        let mut tx = self.history.pool.begin_with("BEGIN IMMEDIATE").await?;
        if let Some(result) = self
            .replay(&mut tx, actor, &request.request_id, &arguments)
            .await?
        {
            return Ok(result);
        }
        let mut ids = HashSet::new();
        let mut before = Vec::new();
        // Validate the entire batch while holding the write transaction, before any mutation.
        for target in &request.clips {
            if !ids.insert(&target.clip_id) {
                return Err(FailureCode::InvalidParameters.failure().into());
            }
            let clip = self.metadata_in(&mut tx, &target.clip_id).await?;
            if clip.revision != target.revision {
                return Err(FailureCode::StaleContext.failure().into());
            }
            before.push(organization(&mut tx, &target.clip_id).await?);
            let count = clip
                .tags
                .iter()
                .filter(|t| !remove.contains(&t.name))
                .count()
                + add
                    .iter()
                    .filter(|t| !clip.tags.iter().any(|c| &c.name == *t))
                    .count();
            if count > 64 {
                return Err(FailureCode::ResourceLimit.failure().into());
            }
        }
        let now = now_ms();
        for target in &request.clips {
            sqlx::query("UPDATE clip_items SET note=COALESCE(?,note),is_favorite=COALESCE(?,is_favorite),is_pinned=COALESCE(?,is_pinned),updated_at=? WHERE id=?").bind(&request.note).bind(request.favorite).bind(request.pinned).bind(now).bind(&target.clip_id).execute(&mut *tx).await?;
            for name in &remove {
                sqlx::query("DELETE FROM catalog_clip_tags WHERE clip_id=? AND tag_id IN (SELECT id FROM catalog_tags WHERE name=?)").bind(&target.clip_id).bind(name).execute(&mut *tx).await?;
            }
            for name in &add {
                sqlx::query("INSERT INTO catalog_tags(id,name,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO NOTHING").bind(new_id()).bind(name).bind(now).bind(now).execute(&mut *tx).await?;
                sqlx::query("INSERT OR IGNORE INTO catalog_clip_tags(clip_id,tag_id,created_at) SELECT ?,id,? FROM catalog_tags WHERE name=?").bind(&target.clip_id).bind(now).bind(name).execute(&mut *tx).await?;
            }
            intent(&mut tx, &target.clip_id).await?;
        }
        let mut after = Vec::new();
        for target in &request.clips {
            after.push(ClipRevision {
                clip_id: target.clip_id.clone(),
                revision: self.metadata_in(&mut tx, &target.clip_id).await?.revision,
            });
        }
        let result = action("organize", after, now);
        persist(
            &mut tx,
            actor,
            &request.request_id,
            &arguments,
            &result,
            &serde_json::to_string(&before)?,
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }

    pub async fn undo(
        &self,
        actor: &Actor,
        request: UndoClipboardRequest,
    ) -> Result<ClipboardActionResult> {
        validate_id(&request.request_id)?;
        validate_id(&request.action_id)?;
        let arguments = sha256(&serde_json::to_vec(&request)?);
        let mut tx = self.history.pool.begin_with("BEGIN IMMEDIATE").await?;
        if let Some(result) = self
            .replay(&mut tx, actor, &request.request_id, &arguments)
            .await?
        {
            return Ok(result);
        }
        let original=sqlx::query("SELECT operation,before_json,after_json FROM assistant_actions WHERE id=? AND actor_id=? AND undone_at IS NULL AND expires_at>?").bind(&request.action_id).bind(&actor.id).bind(now_ms()).fetch_optional(&mut *tx).await?.context(FailureCode::StaleContext.failure())?;
        let operation: String = original.get(0);
        if operation == "undo" {
            return Err(FailureCode::InvalidParameters.failure().into());
        }
        let after: Vec<ClipRevision> = serde_json::from_str(&original.get::<String, _>(2))?;
        for target in &after {
            if self.metadata_in(&mut tx, &target.clip_id).await?.revision != target.revision {
                return Err(FailureCode::StaleContext.failure().into());
            }
        }
        let now = now_ms();
        let mut clips = Vec::new();
        if operation == "create" {
            for target in &after {
                let generated:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assistant_clip_provenance WHERE clip_id=? AND actor_id=?)").bind(&target.clip_id).bind(&actor.id).fetch_one(&mut *tx).await?;
                if !generated {
                    return Err(FailureCode::InvalidInput.failure().into());
                }
                sqlx::query("INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at) VALUES(?,?)").bind(&target.clip_id).bind(now).execute(&mut *tx).await?;
                sqlx::query("DELETE FROM clip_items WHERE id=?")
                    .bind(&target.clip_id)
                    .execute(&mut *tx)
                    .await?;
            }
        } else {
            let before: Vec<OrganizationState> =
                serde_json::from_str(&original.get::<String, _>(1))?;
            for old in before {
                // Deleted tags cannot be restored under a reused identity.
                for tag in &old.tags {
                    if !sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS(SELECT 1 FROM catalog_tags WHERE id=?)",
                    )
                    .bind(tag)
                    .fetch_one(&mut *tx)
                    .await?
                    {
                        return Err(FailureCode::StaleContext.failure().into());
                    }
                }
                sqlx::query("UPDATE clip_items SET note=?,is_favorite=?,is_pinned=?,updated_at=? WHERE id=?").bind(old.note).bind(old.favorite).bind(old.pinned).bind(now).bind(&old.clip_id).execute(&mut *tx).await?;
                sqlx::query("DELETE FROM catalog_clip_tags WHERE clip_id=?")
                    .bind(&old.clip_id)
                    .execute(&mut *tx)
                    .await?;
                for tag in old.tags {
                    sqlx::query("INSERT INTO catalog_clip_tags VALUES(?,?,?)")
                        .bind(&old.clip_id)
                        .bind(tag)
                        .bind(now)
                        .execute(&mut *tx)
                        .await?;
                }
                intent(&mut tx, &old.clip_id).await?;
                clips.push(ClipRevision {
                    revision: self.metadata_in(&mut tx, &old.clip_id).await?.revision,
                    clip_id: old.clip_id,
                });
            }
        }
        sqlx::query("UPDATE assistant_actions SET undone_at=? WHERE id=?")
            .bind(now)
            .bind(&request.action_id)
            .execute(&mut *tx)
            .await?;
        let mut result = action("undo", clips, now);
        result.undo_available = false;
        if operation == "create" {
            result.removed_clip_ids = after.iter().map(|c| c.clip_id.clone()).collect();
        }
        persist(
            &mut tx,
            actor,
            &request.request_id,
            &arguments,
            &result,
            "[]",
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }

    async fn replay(
        &self,
        connection: &mut SqliteConnection,
        actor: &Actor,
        request_id: &str,
        arguments: &str,
    ) -> Result<Option<ClipboardActionResult>> {
        sqlx::query("DELETE FROM assistant_actions WHERE expires_at<=?")
            .bind(now_ms())
            .execute(&mut *connection)
            .await?;
        let previous=sqlx::query("SELECT arguments_sha256,result_json FROM assistant_actions WHERE actor_id=? AND request_id=?").bind(&actor.id).bind(request_id).fetch_optional(&mut *connection).await?;
        if let Some(row) = previous {
            if row.get::<String, _>(0) != arguments {
                return Err(FailureCode::StaleContext.failure().into());
            }
            let result: ClipboardActionResult = serde_json::from_str(&row.get::<String, _>(1))?;
            for clip in &result.clips {
                let exists: bool =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM clip_items WHERE id=?)")
                        .bind(&clip.clip_id)
                        .fetch_one(&mut *connection)
                        .await?;
                if exists {
                    require_eligible_in(connection, &clip.clip_id).await?;
                }
            }
            return Ok(Some(result));
        }
        Ok(None)
    }

    pub async fn activity(&self) -> Result<Vec<ClipboardActivity>> {
        Ok(sqlx::query("SELECT id,operation,actor_id,created_at,undone_at IS NULL AND operation!='undo' FROM assistant_actions WHERE expires_at>? ORDER BY created_at DESC,id DESC LIMIT 100").bind(now_ms()).fetch_all(&self.history.pool).await?.into_iter().map(|r|ClipboardActivity{action_id:r.get(0),operation:r.get(1),actor_id:r.get(2),created_at:r.get::<i64,_>(3) as f64,undo_available:r.get(4)}).collect())
    }
}

async fn organization(
    connection: &mut SqliteConnection,
    clip_id: &str,
) -> Result<OrganizationState> {
    let row = sqlx::query("SELECT note,is_favorite,is_pinned FROM clip_items WHERE id=?")
        .bind(clip_id)
        .fetch_one(&mut *connection)
        .await?;
    let tags =
        sqlx::query_scalar("SELECT tag_id FROM catalog_clip_tags WHERE clip_id=? ORDER BY tag_id")
            .bind(clip_id)
            .fetch_all(connection)
            .await?;
    Ok(OrganizationState {
        clip_id: clip_id.into(),
        note: row.get(0),
        favorite: row.get(1),
        pinned: row.get(2),
        tags,
    })
}
async fn intent(connection: &mut SqliteConnection, clip_id: &str) -> Result<()> {
    sqlx::query("INSERT INTO assistant_index_intents VALUES(?,?,?) ON CONFLICT(clip_id) DO UPDATE SET token=excluded.token,requested_at=excluded.requested_at").bind(clip_id).bind(new_id()).bind(now_ms()).execute(connection).await?;
    Ok(())
}
fn action(operation: &str, clips: Vec<ClipRevision>, now: i64) -> ClipboardActionResult {
    ClipboardActionResult {
        api_version: 1,
        action_id: new_id(),
        operation: operation.into(),
        clips,
        removed_clip_ids: vec![],
        undo_available: true,
        expires_at: (now + RETENTION) as f64,
    }
}
async fn persist(
    connection: &mut SqliteConnection,
    actor: &Actor,
    request_id: &str,
    arguments: &str,
    result: &ClipboardActionResult,
    before: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO assistant_actions(id,actor_id,request_id,operation,arguments_sha256,result_json,before_json,after_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(&result.action_id).bind(&actor.id).bind(request_id).bind(&result.operation).bind(arguments).bind(serde_json::to_string(result)?).bind(before).bind(serde_json::to_string(&result.clips)?).bind(now_ms()).bind(result.expires_at as i64).execute(connection).await?;
    Ok(())
}

pub async fn process_index_intents(history: &crate::history::HistoryRepository) -> Result<u64> {
    sqlx::query("DELETE FROM assistant_actions WHERE expires_at<=?")
        .bind(now_ms())
        .execute(&history.pool)
        .await?;
    let rows = sqlx::query(
        "SELECT clip_id,token FROM assistant_index_intents ORDER BY requested_at LIMIT 100",
    )
    .fetch_all(&history.pool)
    .await?;
    let mut processed = 0;
    for row in rows {
        let id: String = row.get(0);
        let token: String = row.get(1);
        crate::search::upsert_projection(history, &id).await?;
        crate::search::semantic::enqueue_clip(history, &id).await?;
        processed += sqlx::query("DELETE FROM assistant_index_intents WHERE clip_id=? AND token=?")
            .bind(id)
            .bind(token)
            .execute(&history.pool)
            .await?
            .rows_affected();
    }
    Ok(processed)
}
