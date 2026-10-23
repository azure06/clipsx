//! One semantic-index policy, independent of model/provider selection.
use crate::history::HistoryRepository;

pub const NOT_SECRET: &str = "NOT EXISTS(SELECT 1 FROM content_clip_facets secret WHERE secret.clip_id=c.id AND secret.facet_id IN ('core.security.secret','core.security.private'))";

pub async fn clip_is_eligible(repo: &HistoryRepository, clip_id: &str) -> anyhow::Result<bool> {
    let sql = format!("SELECT EXISTS(SELECT 1 FROM clip_items c WHERE c.id=? AND c.lifecycle_state='ready' AND {NOT_SECRET})");
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(clip_id)
        .fetch_one(&repo.pool)
        .await?)
}

pub fn text_is_eligible(text: &str) -> bool {
    !crate::contributions::contains_secret(text)
}

/// Pending cleanup can contain vectors from an older eligibility policy.
pub async fn exclude_pending_cleanup(
    repo: &HistoryRepository,
    ids: &mut std::collections::HashMap<String, i64>,
) -> anyhow::Result<()> {
    let pending: Vec<String> = sqlx::query_scalar("SELECT clip_id FROM search_semantic_cleanup")
        .fetch_all(&repo.pool)
        .await?;
    for id in pending {
        ids.remove(&id);
    }
    Ok(())
}
