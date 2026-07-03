// Search orchestration service.
//
// Query-time search orchestration extracted from
// `commands::search_objects_paginated`. Keyword retrieval now reads from the
// `search_documents` projection while text + visual ranking are fused at query
// time over the current embedding stores.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;

use crate::models::ClipItem;
use crate::repositories::ClipRepository;
use crate::services::semantic::SemanticService;
use crate::services::vector_store::VectorStore;
use crate::services::visual::VisualService;

/// Default cosine-similarity threshold for semantic ranking.
pub const DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD: f32 = 0.5;
// SigLIP2 cross-modal scores land noticeably lower than text-embedding cosine
// scores in practice, so visual retrieval needs a lower gate to avoid dropping
// obviously relevant image matches like "sea" or "beach".
pub const DEFAULT_VISUAL_SIMILARITY_THRESHOLD: f32 = 0.08;
const RRF_K: f32 = 60.0;
const FUSED_CANDIDATE_MULTIPLIER: i32 = 4;
const MIN_FUSED_CANDIDATES: i32 = 50;

#[derive(Debug, Clone)]
struct FusedSearchHit {
    clip_id: String,
    fused_score: f32,
    semantic_score: Option<f32>,
    semantic_rank: Option<usize>,
    visual_rank: Option<usize>,
    fts_rank: Option<usize>,
}

pub struct SearchService {
    repository: Arc<ClipRepository>,
    semantic_service: Arc<SemanticService>,
    vector_store: Arc<VectorStore>,
    visual_service: Arc<VisualService>,
}

impl SearchService {
    pub fn new(
        repository: Arc<ClipRepository>,
        semantic_service: Arc<SemanticService>,
        vector_store: Arc<VectorStore>,
        visual_service: Arc<VisualService>,
    ) -> Self {
        Self {
            repository,
            semantic_service,
            vector_store,
            visual_service,
        }
    }

    /// Paginated search. When semantic search is enabled and the query is not
    /// empty, runs FTS + text-vector + image-vector rank fusion; otherwise
    /// falls back to FTS only. Filters and pagination are applied identically
    /// in both paths.
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
        use_semantic_search: bool,
        similarity_threshold: f32,
    ) -> Result<Vec<ClipItem>> {
        if use_semantic_search && !query.trim().is_empty() {
            return self
                .fused_search(
                    query,
                    filter_types.clone(),
                    limit,
                    offset,
                    favorites_only,
                    pinned_only,
                    tag_filter,
                    similarity_threshold,
                )
                .await;
        }

        self.repository
            .search_paginated(
                query,
                filter_types,
                limit,
                offset,
                favorites_only,
                pinned_only,
                tag_filter,
            )
            .await
    }

    fn fused_candidate_limit(limit: i32, offset: i32) -> i32 {
        ((limit + offset).max(1) * FUSED_CANDIDATE_MULTIPLIER).max(MIN_FUSED_CANDIDATES)
    }

    fn reciprocal_rank(rank: usize) -> f32 {
        1.0 / (RRF_K + rank as f32 + 1.0)
    }

    fn normalize_visual_query(query: &str) -> String {
        query.to_lowercase()
    }

    fn fuse_ranked_hits(
        semantic_hits: &[(String, f32)],
        visual_hits: &[(String, f32)],
        fts_hits: &[String],
    ) -> Vec<FusedSearchHit> {
        let mut fused: HashMap<String, FusedSearchHit> = HashMap::new();

        for (index, (clip_id, semantic_score)) in semantic_hits.iter().enumerate() {
            let entry = fused
                .entry(clip_id.clone())
                .or_insert_with(|| FusedSearchHit {
                    clip_id: clip_id.clone(),
                    fused_score: 0.0,
                    semantic_score: None,
                    semantic_rank: None,
                    visual_rank: None,
                    fts_rank: None,
                });
            entry.fused_score += Self::reciprocal_rank(index);
            entry.semantic_score = Some(*semantic_score);
            entry.semantic_rank = Some(index);
        }

        for (index, (clip_id, _visual_score)) in visual_hits.iter().enumerate() {
            let entry = fused
                .entry(clip_id.clone())
                .or_insert_with(|| FusedSearchHit {
                    clip_id: clip_id.clone(),
                    fused_score: 0.0,
                    semantic_score: None,
                    semantic_rank: None,
                    visual_rank: None,
                    fts_rank: None,
                });
            entry.fused_score += Self::reciprocal_rank(index);
            entry.visual_rank = Some(index);
        }

        for (index, clip_id) in fts_hits.iter().enumerate() {
            let entry = fused
                .entry(clip_id.clone())
                .or_insert_with(|| FusedSearchHit {
                    clip_id: clip_id.clone(),
                    fused_score: 0.0,
                    semantic_score: None,
                    semantic_rank: None,
                    visual_rank: None,
                    fts_rank: None,
                });
            entry.fused_score += Self::reciprocal_rank(index);
            entry.fts_rank = Some(index);
        }

        let mut fused_hits: Vec<FusedSearchHit> = fused.into_values().collect();
        fused_hits.sort_by(|left, right| {
            right
                .fused_score
                .partial_cmp(&left.fused_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.fts_rank.is_some().cmp(&left.fts_rank.is_some()))
                .then_with(|| {
                    left.fts_rank
                        .unwrap_or(usize::MAX)
                        .cmp(&right.fts_rank.unwrap_or(usize::MAX))
                })
                .then_with(|| {
                    right
                        .semantic_rank
                        .is_some()
                        .cmp(&left.semantic_rank.is_some())
                })
                .then_with(|| {
                    left.semantic_rank
                        .unwrap_or(usize::MAX)
                        .cmp(&right.semantic_rank.unwrap_or(usize::MAX))
                })
                .then_with(|| right.visual_rank.is_some().cmp(&left.visual_rank.is_some()))
                .then_with(|| {
                    left.visual_rank
                        .unwrap_or(usize::MAX)
                        .cmp(&right.visual_rank.unwrap_or(usize::MAX))
                })
                .then_with(|| {
                    right
                        .semantic_score
                        .partial_cmp(&left.semantic_score)
                        .unwrap_or(Ordering::Equal)
                })
                .then_with(|| left.clip_id.cmp(&right.clip_id))
        });

        fused_hits
    }

    #[allow(clippy::too_many_arguments)]
    async fn fused_search(
        &self,
        query: &str,
        filter_types: Option<Vec<String>>,
        limit: i32,
        offset: i32,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        similarity_threshold: f32,
    ) -> Result<Vec<ClipItem>> {
        let mut semantic_hits = Vec::new();
        if let Some((model_name, _)) = self.semantic_service.get_model_info() {
            match self.semantic_service.embed(query.to_string()).await {
                Ok(query_vector) => {
                    semantic_hits = self
                        .vector_store
                        .rank_text_query(
                            &query_vector,
                            filter_types.clone(),
                            favorites_only,
                            pinned_only,
                            tag_filter,
                            &model_name,
                            similarity_threshold,
                        )
                        .await?;
                    semantic_hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
                }
                Err(error) => {
                    eprintln!(
                        "[WARN] Failed to generate semantic query embedding for search: {}",
                        error
                    );
                }
            }
        }

        let mut visual_hits = Vec::new();
        match self
            .visual_service
            .embed_query(Self::normalize_visual_query(query))
            .await
        {
            Ok(query_vector) => {
                let visual_model = self.visual_service.image_model_code();
                visual_hits = self
                    .vector_store
                    .rank_image_query(
                        &query_vector,
                        filter_types.clone(),
                        favorites_only,
                        pinned_only,
                        tag_filter,
                        &visual_model,
                        DEFAULT_VISUAL_SIMILARITY_THRESHOLD,
                    )
                    .await?;
                visual_hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
            }
            Err(error) => {
                eprintln!(
                    "[WARN] Failed to generate visual query embedding for search: {}",
                    error
                );
            }
        }

        let candidate_limit = Self::fused_candidate_limit(limit, offset);
        let fts_results = self
            .repository
            .search_paginated(
                query,
                filter_types,
                candidate_limit,
                0,
                favorites_only,
                pinned_only,
                tag_filter,
            )
            .await?;

        let fts_ids: Vec<String> = fts_results.into_iter().map(|clip| clip.id).collect();
        let fused_hits = Self::fuse_ranked_hits(&semantic_hits, &visual_hits, &fts_ids);

        let start = offset as usize;
        if start >= fused_hits.len() {
            return Ok(Vec::new());
        }
        let end = (start + limit as usize).min(fused_hits.len());
        let page_slice = &fused_hits[start..end];

        let page_ids: Vec<String> = page_slice.iter().map(|hit| hit.clip_id.clone()).collect();
        let mut clips = self.repository.get_clips_by_ids(&page_ids).await?;

        clips.sort_by_key(|clip| {
            page_ids
                .iter()
                .position(|id| id == &clip.id)
                .unwrap_or(usize::MAX)
        });

        for clip in &mut clips {
            if let Some(hit) = page_slice.iter().find(|hit| hit.clip_id == clip.id) {
                clip.similarity_score = hit.semantic_score;
            }
        }

        Ok(clips)
    }
}

#[cfg(test)]
mod tests {
    use super::SearchService;

    #[test]
    fn test_fuse_ranked_hits_prefers_combined_results() {
        let semantic_hits = vec![("alpha".to_string(), 0.91), ("beta".to_string(), 0.87)];
        let visual_hits = vec![("gamma".to_string(), 0.88), ("beta".to_string(), 0.85)];
        let fts_hits = vec!["beta".to_string(), "gamma".to_string(), "alpha".to_string()];

        let fused = SearchService::fuse_ranked_hits(&semantic_hits, &visual_hits, &fts_hits);
        let ids: Vec<&str> = fused.iter().map(|hit| hit.clip_id.as_str()).collect();

        assert_eq!(ids, vec!["beta", "gamma", "alpha"]);
        assert_eq!(fused[0].semantic_score, Some(0.87));
        assert_eq!(fused[1].semantic_score, None);
        assert_eq!(fused[2].semantic_score, Some(0.91));
    }

    #[test]
    fn test_fuse_ranked_hits_prefers_lexical_hit_on_rrf_tie() {
        let semantic_hits = vec![("semantic-only".to_string(), 0.93)];
        let visual_hits = vec![("visual-only".to_string(), 0.89)];
        let fts_hits = vec!["lexical-only".to_string()];

        let fused = SearchService::fuse_ranked_hits(&semantic_hits, &visual_hits, &fts_hits);
        let ids: Vec<&str> = fused.iter().map(|hit| hit.clip_id.as_str()).collect();

        assert_eq!(ids, vec!["lexical-only", "semantic-only", "visual-only"]);
    }

    #[test]
    fn test_fuse_ranked_hits_prefers_semantic_before_visual_on_non_lexical_tie() {
        let semantic_hits = vec![("semantic-only".to_string(), 0.93)];
        let visual_hits = vec![("visual-only".to_string(), 0.89)];
        let fts_hits = Vec::new();

        let fused = SearchService::fuse_ranked_hits(&semantic_hits, &visual_hits, &fts_hits);
        let ids: Vec<&str> = fused.iter().map(|hit| hit.clip_id.as_str()).collect();

        assert_eq!(ids, vec!["semantic-only", "visual-only"]);
    }

    #[test]
    fn test_fused_candidate_limit_scales_with_page_window() {
        assert_eq!(SearchService::fused_candidate_limit(10, 0), 50);
        assert_eq!(SearchService::fused_candidate_limit(20, 20), 160);
    }

    #[test]
    fn test_normalize_visual_query_lowercases_input() {
        assert_eq!(SearchService::normalize_visual_query("SEA"), "sea");
        assert_eq!(
            SearchService::normalize_visual_query("Beach Sunset"),
            "beach sunset"
        );
    }
}
