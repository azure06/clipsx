use std::cmp::Ordering;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::Result;

use crate::repositories::ClipRepository;
use crate::services::semantic::SemanticService;

type RankedVectorResults = Vec<(String, f32)>;
type VectorSearchFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RankedVectorResults>> + Send + 'a>>;

pub trait VectorSearchBackend: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    fn rank_text_query<'a>(
        &'a self,
        query_vector: &'a [f32],
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: &'a str,
        threshold: f32,
    ) -> VectorSearchFuture<'a>;

    #[allow(clippy::too_many_arguments)]
    fn rank_image_query<'a>(
        &'a self,
        query_vector: &'a [f32],
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: &'a str,
        threshold: f32,
    ) -> VectorSearchFuture<'a>;
}

pub struct InMemoryVectorBackend {
    repository: Arc<ClipRepository>,
}

impl InMemoryVectorBackend {
    pub fn new(repository: Arc<ClipRepository>) -> Self {
        Self { repository }
    }

    fn rank_embeddings(
        query_vector: &[f32],
        embeddings: Vec<(String, Vec<u8>)>,
        threshold: f32,
    ) -> Vec<(String, f32)> {
        let mut ranked: Vec<(String, f32)> = embeddings
            .into_iter()
            .filter_map(|(clip_id, vector_bytes)| {
                let vector = SemanticService::bytes_to_vector(&vector_bytes);
                let score = SemanticService::cosine_similarity(query_vector, &vector);
                if score >= threshold {
                    Some((clip_id, score))
                } else {
                    None
                }
            })
            .collect();

        ranked.sort_by(|left, right| right.1.partial_cmp(&left.1).unwrap_or(Ordering::Equal));
        ranked
    }
}

impl VectorSearchBackend for InMemoryVectorBackend {
    fn rank_text_query<'a>(
        &'a self,
        query_vector: &'a [f32],
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: &'a str,
        threshold: f32,
    ) -> VectorSearchFuture<'a> {
        Box::pin(async move {
            let embeddings = self
                .repository
                .get_text_search_embeddings_with_filters(
                    filter_types,
                    favorites_only,
                    pinned_only,
                    tag_filter,
                    Some(model),
                )
                .await?;

            Ok(Self::rank_embeddings(
                query_vector,
                embeddings
                    .into_iter()
                    .map(|embedding| (embedding.clip_id, embedding.vector))
                    .collect(),
                threshold,
            ))
        })
    }

    fn rank_image_query<'a>(
        &'a self,
        query_vector: &'a [f32],
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: &'a str,
        threshold: f32,
    ) -> VectorSearchFuture<'a> {
        Box::pin(async move {
            let embeddings = self
                .repository
                .get_search_embeddings_with_filters(
                    filter_types,
                    favorites_only,
                    pinned_only,
                    tag_filter,
                    "image",
                    model,
                )
                .await?;

            Ok(Self::rank_embeddings(
                query_vector,
                embeddings
                    .into_iter()
                    .map(|embedding| (embedding.clip_id, embedding.vector))
                    .collect(),
                threshold,
            ))
        })
    }
}

pub struct VectorStore {
    repository: Arc<ClipRepository>,
    backend: Arc<dyn VectorSearchBackend>,
}

impl VectorStore {
    pub fn new(repository: Arc<ClipRepository>) -> Self {
        let backend = Arc::new(InMemoryVectorBackend::new(repository.clone()));
        Self {
            repository,
            backend,
        }
    }

    #[allow(dead_code)]
    pub fn with_backend(
        repository: Arc<ClipRepository>,
        backend: Arc<dyn VectorSearchBackend>,
    ) -> Self {
        Self {
            repository,
            backend,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn rank_text_query(
        &self,
        query_vector: &[f32],
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: &str,
        threshold: f32,
    ) -> Result<Vec<(String, f32)>> {
        self.backend
            .rank_text_query(
                query_vector,
                filter_types,
                favorites_only,
                pinned_only,
                tag_filter,
                model,
                threshold,
            )
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn rank_image_query(
        &self,
        query_vector: &[f32],
        filter_types: Option<Vec<String>>,
        favorites_only: bool,
        pinned_only: bool,
        tag_filter: Option<i64>,
        model: &str,
        threshold: f32,
    ) -> Result<Vec<(String, f32)>> {
        self.backend
            .rank_image_query(
                query_vector,
                filter_types,
                favorites_only,
                pinned_only,
                tag_filter,
                model,
                threshold,
            )
            .await
    }

    pub async fn save_text_embedding(
        &self,
        clip_id: &str,
        vector: &[f32],
        model: &str,
        dimensions: i32,
    ) -> Result<()> {
        let vector_bytes = SemanticService::vector_to_bytes(vector);
        self.repository
            .upsert_search_embedding(clip_id, "text", vector_bytes, model, dimensions)
            .await?;
        Ok(())
    }

    pub async fn save_image_embedding(
        &self,
        clip_id: &str,
        vector: &[f32],
        model: &str,
        dimensions: i32,
    ) -> Result<()> {
        let vector_bytes = SemanticService::vector_to_bytes(vector);
        self.repository
            .upsert_search_embedding(clip_id, "image", vector_bytes, model, dimensions)
            .await?;
        Ok(())
    }

    pub async fn clear_text_embeddings_for_model(&self, model: &str) -> Result<()> {
        self.repository
            .delete_text_search_embeddings_for_model(model)
            .await?;
        Ok(())
    }

    pub async fn clear_image_embeddings_for_model(&self, model: &str) -> Result<()> {
        self.repository
            .delete_search_embeddings_for_model(model, "image")
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use anyhow::Result;

    use super::VectorStore;
    use crate::models::ClipItem;
    use crate::repositories::ClipRepository;

    #[tokio::test]
    async fn test_rank_text_query_orders_by_similarity() -> Result<()> {
        let repository = Arc::new(ClipRepository::new("sqlite::memory:").await?);
        let store = VectorStore::new(repository.clone());

        let alpha = ClipItem::from_text("alpha".to_string(), "text".to_string(), None);
        let beta = ClipItem::from_text("beta".to_string(), "text".to_string(), None);
        repository.insert(&alpha).await?;
        repository.insert(&beta).await?;

        store
            .save_text_embedding(&alpha.id, &[1.0, 0.0], "text-model", 2)
            .await?;
        store
            .save_text_embedding(&beta.id, &[0.8, 0.2], "text-model", 2)
            .await?;

        let ranked = store
            .rank_text_query(&[1.0, 0.0], None, false, false, None, "text-model", 0.0)
            .await?;

        assert_eq!(ranked[0].0, alpha.id);
        assert_eq!(ranked[1].0, beta.id);

        Ok(())
    }

    #[tokio::test]
    async fn test_rank_image_query_uses_search_embeddings_only() -> Result<()> {
        let repository = Arc::new(ClipRepository::new("sqlite::memory:").await?);
        let store = VectorStore::new(repository.clone());

        let mut image_clip = ClipItem::from_text("[Image]".to_string(), "image".to_string(), None);
        image_clip.content_type = "image".to_string();
        image_clip.detected_type = "image".to_string();
        image_clip.image_path = Some("/tmp/image.png".to_string());

        let mut image_clip_2 =
            ClipItem::from_text("[Image 2]".to_string(), "image".to_string(), None);
        image_clip_2.content_type = "image".to_string();
        image_clip_2.detected_type = "image".to_string();
        image_clip_2.image_path = Some("/tmp/image-2.png".to_string());

        repository.insert(&image_clip).await?;
        repository.insert(&image_clip_2).await?;

        store
            .save_image_embedding(&image_clip.id, &[1.0, 0.0], "image-model", 2)
            .await?;
        store
            .save_image_embedding(&image_clip_2.id, &[0.2, 0.9], "image-model", 2)
            .await?;

        let ranked = store
            .rank_image_query(&[1.0, 0.0], None, false, false, None, "image-model", 0.5)
            .await?;

        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].0, image_clip.id);

        Ok(())
    }
}
