// Async indexing service.
//
// Indexing orchestration for the search refactor. Search documents/jobs are
// the active keyword-search projection, while text and image embeddings live
// in `search_embeddings`. Search documents are written synchronously so
// keyword updates are immediately visible; text and visual embeddings are
// generated in the background when available.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use tauri::{AppHandle, Emitter};

use crate::events::emit_clip_updated;
use crate::models::{ClipItem, IndexingOverview};
use crate::repositories::ClipRepository;
use crate::repositories::SEARCH_DOCUMENT_VERSION;
use crate::services::semantic::SemanticService;
use crate::services::vector_store::VectorStore;
use crate::services::visual::VisualService;

#[derive(Clone)]
struct TextIndexWork {
    index_text: String,
    model_name: String,
    dimensions: i32,
}

#[derive(Clone)]
struct VisualIndexWork {
    image_path: String,
    model_name: String,
    dimensions: i32,
}

struct BackgroundIndexingWork {
    repo: Arc<ClipRepository>,
    semantic_service: Arc<SemanticService>,
    vector_store: Arc<VectorStore>,
    visual_service: Arc<VisualService>,
    app_handle: AppHandle,
    clip_id: String,
    text_work: Option<TextIndexWork>,
    visual_work: Option<VisualIndexWork>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexStats {
    pub total_text_clips: i64,
    pub indexed_clips: i64,
    pub pending_clips: i64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStackProgressPayload {
    pub done: u64,
    pub total: u64,
}

pub struct IndexingService {
    repository: Arc<ClipRepository>,
    semantic_service: Arc<SemanticService>,
    vector_store: Arc<VectorStore>,
    visual_service: Arc<VisualService>,
    app_handle: AppHandle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClipIndexClassification {
    Indexed,
    Missing,
    Stale,
    Failed,
    Pending,
}

impl IndexingService {
    pub fn new(
        repository: Arc<ClipRepository>,
        semantic_service: Arc<SemanticService>,
        vector_store: Arc<VectorStore>,
        visual_service: Arc<VisualService>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            repository,
            semantic_service,
            vector_store,
            visual_service,
            app_handle,
        }
    }

    async fn sync_search_projection(&self, clip: &ClipItem) -> Result<()> {
        self.repository.upsert_search_document(clip).await?;
        self.repository.enqueue_search_job(&clip.id).await?;
        Ok(())
    }

    fn classify_index_state(
        row: &crate::repositories::ClipIndexStateRow,
    ) -> ClipIndexClassification {
        let required_embeddings_present =
            (!row.requires_text || row.has_text) && (!row.requires_image || row.has_image);
        let stale_projection = row.document_search_version.unwrap_or_default()
            != SEARCH_DOCUMENT_VERSION
            || row.job_search_version.unwrap_or_default() != SEARCH_DOCUMENT_VERSION;

        match row.job_status.as_deref() {
            Some("running" | "pending") => ClipIndexClassification::Pending,
            Some("failed") => ClipIndexClassification::Failed,
            _ if stale_projection => ClipIndexClassification::Stale,
            _ if required_embeddings_present && row.job_status.as_deref() == Some("completed") => {
                ClipIndexClassification::Indexed
            }
            _ => ClipIndexClassification::Missing,
        }
    }

    pub async fn get_indexing_overview(&self) -> Result<IndexingOverview> {
        let text_model = self
            .semantic_service
            .get_model_info()
            .map(|(name, _)| name)
            .unwrap_or_else(|| "BAAI/bge-m3".to_string());
        let image_model = self.visual_service.image_model_code();
        let rows = self
            .repository
            .get_clip_index_state_rows(&text_model, &image_model)
            .await?;

        let mut overview = IndexingOverview {
            total_eligible_clips: rows.len() as i64,
            indexed_clips: 0,
            missing_count: 0,
            stale_count: 0,
            failed_count: 0,
            pending_count: 0,
            active_stack_version: String::new(),
            last_error_summary: None,
        };

        for row in &rows {
            match Self::classify_index_state(row) {
                ClipIndexClassification::Indexed => overview.indexed_clips += 1,
                ClipIndexClassification::Missing => overview.missing_count += 1,
                ClipIndexClassification::Stale => overview.stale_count += 1,
                ClipIndexClassification::Failed => {
                    overview.failed_count += 1;
                    if overview.last_error_summary.is_none() {
                        overview.last_error_summary = row.last_error.clone();
                    }
                }
                ClipIndexClassification::Pending => overview.pending_count += 1,
            }
        }

        Ok(overview)
    }

    async fn finalize_without_embedding(&self, clip_id: &str) {
        if let Err(error) = self.repository.mark_search_job_completed(clip_id).await {
            eprintln!(
                "[ERROR] Failed to mark search job completed for {}: {}",
                clip_id, error
            );
        }
    }

    fn build_text_work(&self, clip: &ClipItem) -> Option<TextIndexWork> {
        if clip.index_text.is_empty() || clip.primary_text_source == "none" {
            return None;
        }

        let (model_name, dimensions) = self.semantic_service.get_model_info()?;
        Some(TextIndexWork {
            index_text: clip.index_text.clone(),
            model_name,
            dimensions,
        })
    }

    async fn build_visual_work(&self, clip: &ClipItem) -> Result<Option<VisualIndexWork>> {
        if !matches!(clip.content_type.as_str(), "image" | "office") {
            return Ok(None);
        }

        let Some(image_path) = clip
            .image_path
            .clone()
            .filter(|path| !path.trim().is_empty())
        else {
            return Ok(None);
        };

        let model_name = self.visual_service.image_model_code();
        if self
            .repository
            .get_search_embedding(&clip.id, "image", &model_name)
            .await?
            .is_some()
        {
            return Ok(None);
        }

        Ok(Some(VisualIndexWork {
            image_path,
            model_name,
            dimensions: self.visual_service.image_dimensions(),
        }))
    }

    async fn save_text_embedding(
        vector_store: &VectorStore,
        semantic_service: &SemanticService,
        clip_id: &str,
        work: &TextIndexWork,
    ) -> Result<()> {
        let vector = semantic_service.embed(work.index_text.clone()).await?;
        vector_store
            .save_text_embedding(clip_id, &vector, &work.model_name, work.dimensions)
            .await?;

        Ok(())
    }

    async fn save_visual_embedding(
        vector_store: &VectorStore,
        visual_service: &VisualService,
        clip_id: &str,
        work: &VisualIndexWork,
    ) -> Result<()> {
        let vector = visual_service
            .embed_image_path(work.image_path.clone())
            .await?;
        vector_store
            .save_image_embedding(clip_id, &vector, &work.model_name, work.dimensions)
            .await?;

        Ok(())
    }

    async fn emit_clip_updated(repo: &ClipRepository, app_handle: &AppHandle, clip_id: &str) {
        if let Err(error) = emit_clip_updated(app_handle, repo, clip_id).await {
            eprintln!(
                "[ERROR] Failed to emit clip-updated after indexing for {}: {}",
                clip_id, error
            );
        }
    }

    async fn run_background_indexing(work: BackgroundIndexingWork) {
        let BackgroundIndexingWork {
            repo,
            semantic_service,
            vector_store,
            visual_service,
            app_handle,
            clip_id,
            text_work,
            visual_work,
        } = work;

        if let Err(error) = repo.mark_search_job_running(&clip_id).await {
            eprintln!(
                "[ERROR] Failed to mark search job running for {}: {}",
                clip_id, error
            );
        }

        let mut text_error = None;
        if let Some(work) = &text_work {
            if let Err(error) = Self::save_text_embedding(
                vector_store.as_ref(),
                semantic_service.as_ref(),
                &clip_id,
                work,
            )
            .await
            {
                eprintln!(
                    "[ERROR] Failed to save text embedding for {}: {}",
                    clip_id, error
                );
                text_error = Some(error.to_string());
            }
        }

        let mut visual_error = None;
        if let Some(work) = &visual_work {
            if let Err(error) = Self::save_visual_embedding(
                vector_store.as_ref(),
                visual_service.as_ref(),
                &clip_id,
                work,
            )
            .await
            {
                eprintln!(
                    "[WARN] Failed to save visual embedding for {}: {}",
                    clip_id, error
                );
                visual_error = Some(error.to_string());
            }
        }

        let job_failure = text_error.or(visual_error);
        if let Some(message) = job_failure {
            if let Err(job_error) = repo.mark_search_job_failed(&clip_id, &message).await {
                eprintln!(
                    "[ERROR] Failed to mark search job failed for {}: {}",
                    clip_id, job_error
                );
            }
            Self::emit_clip_updated(repo.as_ref(), &app_handle, &clip_id).await;
            return;
        }

        if let Err(error) = repo.mark_search_job_completed(&clip_id).await {
            eprintln!(
                "[ERROR] Failed to mark search job completed for {}: {}",
                clip_id, error
            );
        }

        Self::emit_clip_updated(repo.as_ref(), &app_handle, &clip_id).await;
    }

    /// Dual-write a clip into `search_documents` / `search_jobs`, then spawn
    /// background embedding generation when there is indexable text or a
    /// raster preview for visual retrieval. Returns `true` if an embedding
    /// task was spawned.
    pub async fn enqueue_clip_indexing(&self, clip: &ClipItem, _notify_on_failure: bool) -> bool {
        if let Err(error) = self.sync_search_projection(clip).await {
            eprintln!(
                "[ERROR] Failed to sync search projection for {}: {}",
                clip.id, error
            );
            return false;
        }

        let text_work = self.build_text_work(clip);
        let visual_work = match self.build_visual_work(clip).await {
            Ok(work) => work,
            Err(error) => {
                eprintln!(
                    "[WARN] Failed to inspect visual indexing state for {}: {}",
                    clip.id, error
                );
                None
            }
        };

        if text_work.is_none() && visual_work.is_none() {
            self.finalize_without_embedding(&clip.id).await;
            return false;
        }

        let repo = self.repository.clone();
        let semantic_service = self.semantic_service.clone();
        let vector_store = self.vector_store.clone();
        let visual_service = self.visual_service.clone();
        let app_handle = self.app_handle.clone();
        let clip_id = clip.id.clone();

        tokio::spawn(async move {
            Self::run_background_indexing(BackgroundIndexingWork {
                repo,
                semantic_service,
                vector_store,
                visual_service,
                app_handle,
                clip_id,
                text_work,
                visual_work,
            })
            .await;
        });

        true
    }

    /// Full reindex of all eligible clips for the currently-loaded semantic
    /// model. Clears any existing embeddings for that model, then re-embeds
    /// every text candidate while backfilling visual embeddings for raster
    /// image/office clips. If text search is not loaded, only visual backfill
    /// runs.
    pub async fn reindex_all(&self) -> Result<SemanticIndexStats> {
        let model_info = self.semantic_service.get_model_info();
        let (model_name, _dimensions) = model_info
            .clone()
            .unwrap_or_else(|| ("BAAI/bge-m3".to_string(), 1024));
        let visual_model = self.visual_service.image_model_code();

        let text_model_loaded = model_info.is_some();

        self.vector_store
            .clear_text_embeddings_for_model(&model_name)
            .await?;
        self.vector_store
            .clear_image_embeddings_for_model(&visual_model)
            .await?;

        // Text embedding pass — skipped entirely when text search model is not loaded.
        if text_model_loaded {
            let text_candidates = self
                .repository
                .get_text_embedding_candidates_for_model(&model_name)
                .await?;
            let total = text_candidates.len() as u64;

            self.semantic_service.set_indexing_status(0, total);
            let _ = self.app_handle.emit("ai-capabilities-changed", ());

            for (index, clip) in text_candidates.into_iter().enumerate() {
                if let Some(clip_row) = self.repository.get_by_id(&clip.id).await? {
                    self.sync_search_projection(&clip_row).await?;
                    self.repository.mark_search_job_running(&clip.id).await?;

                    let text_work = self
                        .build_text_work(&clip_row)
                        .ok_or_else(|| anyhow!("Clip has no indexable text to embed"))?;

                    if let Err(error) = Self::save_text_embedding(
                        self.vector_store.as_ref(),
                        self.semantic_service.as_ref(),
                        &clip.id,
                        &text_work,
                    )
                    .await
                    {
                        let message = error.to_string();
                        let _ = self
                            .repository
                            .mark_search_job_failed(&clip.id, &message)
                            .await;
                        self.semantic_service
                            .set_error_status(Some(model_name.clone()), message.clone());
                        let _ = self.app_handle.emit("ai-capabilities-changed", ());
                        return Err(anyhow!(message));
                    }

                    if let Some(visual_work) = self.build_visual_work(&clip_row).await? {
                        if let Err(error) = Self::save_visual_embedding(
                            self.vector_store.as_ref(),
                            self.visual_service.as_ref(),
                            &clip.id,
                            &visual_work,
                        )
                        .await
                        {
                            eprintln!(
                                "[WARN] Failed to save visual embedding during reindex for {}: {}",
                                clip.id, error
                            );
                        }
                    }

                    self.repository.mark_search_job_completed(&clip.id).await?;
                }

                self.semantic_service
                    .set_indexing_status(index as u64 + 1, total);
                let _ = self.app_handle.emit(
                    "ai-stack-index-progress",
                    AiStackProgressPayload {
                        done: index as u64 + 1,
                        total,
                    },
                );
            }
        }

        // Visual embedding backfill — runs independently of text search.
        let visual_candidates = self
            .repository
            .get_visual_embedding_candidates_for_model(&visual_model)
            .await?;

        for candidate in visual_candidates {
            if let Some(clip_row) = self.repository.get_by_id(&candidate.id).await? {
                self.sync_search_projection(&clip_row).await?;
                self.repository
                    .mark_search_job_running(&candidate.id)
                    .await?;

                let mut visual_reindex_error = None;
                if let Some(visual_work) = self.build_visual_work(&clip_row).await? {
                    if let Err(error) = Self::save_visual_embedding(
                        self.vector_store.as_ref(),
                        self.visual_service.as_ref(),
                        &candidate.id,
                        &visual_work,
                    )
                    .await
                    {
                        eprintln!(
                            "[WARN] Failed to save visual-only embedding during reindex for {}: {}",
                            candidate.id, error
                        );
                        visual_reindex_error = Some(error.to_string());
                    }
                }

                if let Some(message) = visual_reindex_error {
                    self.repository
                        .mark_search_job_failed(&candidate.id, &message)
                        .await?;
                } else {
                    self.repository
                        .mark_search_job_completed(&candidate.id)
                        .await?;
                }
            }
        }

        self.semantic_service.set_ready_status();
        let _ = self.app_handle.emit("ai-capabilities-changed", ());

        let stats = self
            .repository
            .get_text_embedding_stats(&model_name)
            .await?;
        Ok(SemanticIndexStats {
            total_text_clips: stats.total_text_clips,
            indexed_clips: stats.indexed_clips,
            pending_clips: (stats.total_text_clips - stats.indexed_clips).max(0),
        })
    }

    pub async fn index_missing(&self) -> Result<IndexingOverview> {
        let text_model = self
            .semantic_service
            .get_model_info()
            .map(|(name, _)| name)
            .unwrap_or_else(|| "BAAI/bge-m3".to_string());
        let image_model = self.visual_service.image_model_code();
        let rows = self
            .repository
            .get_clip_index_state_rows(&text_model, &image_model)
            .await?;

        for row in rows {
            match Self::classify_index_state(&row) {
                ClipIndexClassification::Missing
                | ClipIndexClassification::Stale
                | ClipIndexClassification::Failed => {
                    if let Some(clip) = self.repository.get_by_id(&row.clip_id).await? {
                        let _ = self.enqueue_clip_indexing(&clip, true).await;
                    }
                }
                ClipIndexClassification::Indexed | ClipIndexClassification::Pending => {}
            }
        }

        self.get_indexing_overview().await
    }
}
