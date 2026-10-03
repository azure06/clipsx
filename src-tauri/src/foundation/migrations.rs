//! Published SQL is immutable. Only its known LF/CRLF checksums are equivalent.
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha384};
use sqlx::{migrate::Migrator, AssertSqlSafe, Connection, SqlSafeStr, SqliteConnection};
use std::{borrow::Cow, path::Path};

pub(super) fn canonical() -> Migrator {
    let mut migrator = sqlx::migrate!("./migrations");
    for migration in migrator.migrations.to_mut() {
        let sql = migration.sql.as_str().replace("\r\n", "\n");
        migration.checksum = Cow::Owned(Sha384::digest(sql.as_bytes()).to_vec());
        migration.sql = AssertSqlSafe(sql).into_sql_str();
    }
    migrator
}

fn known_line_ending_pair(version: i64, expected: &[u8], actual: &[u8]) -> bool {
    let baseline: serde_json::Value =
        serde_json::from_str(include_str!("../../migrations/published-v0.1.0.json"))
            .expect("published migration checksum inventory is valid");
    let Some(pair) = baseline.get(version.to_string()) else {
        return false;
    };
    pair["lf"] == hex(expected) && pair["crlf"] == hex(actual)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) async fn repair_line_endings(
    connection: &mut SqliteConnection,
    database: &Path,
    migrator: &Migrator,
) -> Result<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='_sqlx_migrations' AND type='table')",
    )
    .fetch_one(&mut *connection)
    .await?;
    if !exists {
        return Ok(());
    }
    let rows: Vec<(i64, bool, Vec<u8>)> =
        sqlx::query_as("SELECT version,success,checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut *connection)
            .await?;
    let mut repairs = Vec::new();
    // Validate the complete ledger before changing anything. SQLx reports real mismatches.
    for (version, success, actual) in rows {
        let Some(migration) = migrator.iter().find(|item| item.version == version) else {
            return Ok(());
        };
        if !success {
            return Ok(());
        }
        if actual == migration.checksum.as_ref() {
            continue;
        }
        if !known_line_ending_pair(version, &migration.checksum, &actual) {
            return Ok(());
        }
        repairs.push((version, actual, migration.checksum.to_vec()));
    }
    if repairs.is_empty() {
        return Ok(());
    }
    // SQLite produces a consistent snapshot including committed WAL contents.
    let backup = database.with_file_name(format!(
        "clips-before-checksum-repair-{}.db",
        uuid::Uuid::now_v7()
    ));
    sqlx::query("VACUUM INTO ?")
        .bind(backup.to_string_lossy().as_ref())
        .execute(&mut *connection)
        .await
        .context("Cannot back up database before checksum repair")?;
    let mut transaction = connection.begin().await?;
    for (version, previous, checksum) in &repairs {
        let result = sqlx::query(
            "UPDATE _sqlx_migrations SET checksum=? WHERE version=? AND checksum=? AND success=1",
        )
        .bind(checksum)
        .bind(version)
        .bind(previous)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            bail!("Migration ledger changed during checksum repair");
        }
    }
    transaction.commit().await?;
    log::info!(target: "clipsx::storage",
        "storage.migration.line_endings_repaired count={} backup_created=true",
        repairs.len()
    );
    Ok(())
}
