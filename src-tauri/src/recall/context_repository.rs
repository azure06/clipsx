//! Branch-scoped summaries are derived data; transcripts and action records remain authoritative.
use super::contracts::*;
use crate::history::{sha256, HistoryRepository};
use anyhow::{bail, Result};
use sqlx::{Row, SqliteConnection};

async fn fingerprint(
    connection: &mut SqliteConnection,
    thread: &str,
    covered: &str,
) -> Result<String> {
    let mut id = Some(covered.to_string());
    let mut records = Vec::new();
    while let Some(current) = id {
        if records.len() >= 2000 {
            bail!("invalid_summary_ancestry");
        }
        let row=sqlx::query("SELECT parent_id,role,content_json,status_json FROM recall_messages WHERE thread_id=? AND id=?").bind(thread).bind(&current).fetch_one(&mut *connection).await?;
        let status: Option<String> = row.get("status_json");
        if row.get::<String, _>("role") == "assistant"
            && !status
                .as_ref()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                .is_some_and(|s| s["type"] == "complete" || s["type"] == "incomplete")
        {
            bail!("summary_contains_unfinished_message");
        }
        records.push((
            current,
            row.get::<String, _>("role"),
            row.get::<String, _>("content_json"),
        ));
        id = row.get("parent_id");
    }
    records.reverse();
    Ok(sha256(&serde_json::to_vec(&records)?))
}
pub async fn load(
    repo: &HistoryRepository,
    thread: &str,
    covered: &str,
) -> Result<RecallContextCoverage> {
    let mut tx = repo.pool.begin().await?;
    let input_fingerprint = fingerprint(&mut tx, thread, covered).await?;
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT summary_json FROM recall_context_summaries WHERE thread_id=?")
            .bind(thread)
            .fetch_all(&mut *tx)
            .await?;
    let summaries: Vec<RecallContextSummary> = rows
        .into_iter()
        .map(|v| serde_json::from_str(&v))
        .collect::<std::result::Result<_, _>>()?;
    let mut current = Some(covered.to_string());
    let mut summary = None;
    let mut depth = 0;
    while let Some(id) = current {
        depth += 1;
        if depth > 2000 {
            bail!("invalid_summary_ancestry");
        }
        if let Some(candidate) = summaries.iter().find(|s| s.covered_message_id == id) {
            if fingerprint(&mut tx, thread, &id).await? == candidate.input_fingerprint {
                summary = Some(candidate.clone());
                break;
            }
        }
        current =
            sqlx::query_scalar("SELECT parent_id FROM recall_messages WHERE thread_id=? AND id=?")
                .bind(thread)
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
    }
    Ok(RecallContextCoverage {
        input_fingerprint,
        summary,
    })
}
pub async fn save(repo: &HistoryRepository, summary: RecallContextSummary) -> Result<()> {
    if summary.text.trim().is_empty()
        || summary.text.len() > 32 * 1024
        || summary.provider.len() > 64
        || summary.model.len() > 256
        || !summary.created_at.is_finite()
    {
        bail!("invalid_context_summary");
    }
    let mut tx = repo.pool.begin_with("BEGIN IMMEDIATE").await?;
    if fingerprint(&mut tx, &summary.thread_id, &summary.covered_message_id).await?
        != summary.input_fingerprint
    {
        bail!("stale_context_summary");
    }
    sqlx::query("DELETE FROM recall_context_summaries WHERE thread_id=? AND covered_message_id=?")
        .bind(&summary.thread_id)
        .bind(&summary.covered_message_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO recall_context_summaries(thread_id,covered_message_id,input_fingerprint,summary_json) VALUES(?,?,?,?)").bind(&summary.thread_id).bind(&summary.covered_message_id).bind(&summary.input_fingerprint).bind(serde_json::to_string(&summary)?).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM recall_context_summaries WHERE thread_id=? AND rowid NOT IN (SELECT rowid FROM recall_context_summaries WHERE thread_id=? ORDER BY rowid DESC LIMIT 16)").bind(&summary.thread_id).bind(&summary.thread_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn summaries_are_branch_bound_fingerprinted_and_cascade_deleted() {
        let (_root, service) = crate::recall::service_tests::repository().await;
        let repo = &service.history;
        let thread = crate::recall::conversations::initialize(repo, "summary-test")
            .await
            .unwrap();
        for (id, parent, text) in [
            ("a", None, "first"),
            ("b", Some("a"), "second"),
            ("c", Some("a"), "branch"),
            ("d", Some("b"), "later turn"),
        ] {
            crate::recall::conversations::append(
                repo,
                &thread.id,
                RecallMessage {
                    id: id.into(),
                    parent_id: parent.map(str::to_string),
                    role: "user".into(),
                    content_json: serde_json::json!([{"type":"text","text":text}]).to_string(),
                    status_json: None,
                    metadata_json: "{}".into(),
                    created_at: 0,
                },
            )
            .await
            .unwrap();
        }
        let coverage = load(repo, &thread.id, "b").await.unwrap();
        let summary = RecallContextSummary {
            thread_id: thread.id.clone(),
            covered_message_id: "b".into(),
            input_fingerprint: coverage.input_fingerprint,
            text: "Retained goal".into(),
            provider: "ollama".into(),
            model: "m".into(),
            created_at: 0.0,
        };
        save(repo, summary.clone()).await.unwrap();
        let mut reopened = repo.clone();
        reopened.pool =
            sqlx::SqlitePool::connect_with(repo.pool.connect_options().as_ref().clone())
                .await
                .unwrap();
        assert!(load(&reopened, &thread.id, "b")
            .await
            .unwrap()
            .summary
            .is_some());
        assert!(load(repo, &thread.id, "b").await.unwrap().summary.is_some());
        assert!(load(repo, &thread.id, "c").await.unwrap().summary.is_none());
        assert_eq!(
            load(repo, &thread.id, "d")
                .await
                .unwrap()
                .summary
                .unwrap()
                .covered_message_id,
            "b"
        );
        sqlx::query("UPDATE recall_messages SET content_json='[]' WHERE thread_id=? AND id='a'")
            .bind(&thread.id)
            .execute(&repo.pool)
            .await
            .unwrap();
        assert!(load(repo, &thread.id, "b").await.unwrap().summary.is_none());
        assert!(save(repo, summary).await.is_err());
        sqlx::query("DELETE FROM recall_threads WHERE id=?")
            .bind(&thread.id)
            .execute(&repo.pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM recall_context_summaries")
                .fetch_one(&repo.pool)
                .await
                .unwrap(),
            0
        );
    }
}
