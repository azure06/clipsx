use crate::models::{OutboxOperation, OutboxOperationKind, VaultItem};
use anyhow::Result;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::{str::FromStr, time::Duration};

pub struct VaultRepository {
    pool: SqlitePool,
}

impl VaultRepository {
    pub async fn new(database_url: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .busy_timeout(Duration::from_secs(5))
            .foreign_keys(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn insert_item_and_enqueue(
        &self,
        source_clip_id: &str,
        item: &VaultItem,
        operation: &OutboxOperation,
    ) -> Result<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO vault_items (id, source_clip_id, collection_id, key_version, encrypted_payload, wrapped_item_key, created_at, updated_at, version, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&item.id)
        .bind(source_clip_id)
        .bind(&item.collection_id)
        .bind(item.key_version)
        .bind(serde_json::to_string(&item.encrypted_payload)?)
        .bind(serde_json::to_string(&item.wrapped_item_key)?)
        .bind(item.created_at)
        .bind(item.updated_at)
        .bind(item.version as i64)
        .bind(item.deleted_at)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO vault_outbox (id, operation_kind, collection_id, vault_item_id, payload, idempotency_key, attempt_count, next_attempt_at, last_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&operation.id)
        .bind(operation_kind_name(operation.kind))
        .bind(&operation.collection_id)
        .bind(&operation.vault_item_id)
        .bind(&operation.payload)
        .bind(&operation.idempotency_key)
        .bind(operation.attempt_count)
        .bind(operation.next_attempt_at)
        .bind(&operation.last_error)
        .bind(operation.created_at)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }
}

fn operation_kind_name(kind: OutboxOperationKind) -> &'static str {
    match kind {
        OutboxOperationKind::UpsertVaultItem => "upsert_vault_item",
        OutboxOperationKind::DeleteVaultItem => "delete_vault_item",
    }
}
