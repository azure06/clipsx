-- Local-only encrypted-vault queue. Every payload column contains serialized
-- ciphertext; plaintext clip fields and native Office binaries are excluded.
CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY NOT NULL,
    source_clip_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    encrypted_payload TEXT NOT NULL,
    wrapped_item_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_vault_items_collection_updated
ON vault_items(collection_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS vault_outbox (
    id TEXT PRIMARY KEY NOT NULL,
    operation_kind TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    vault_item_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (vault_item_id) REFERENCES vault_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_outbox_due
ON vault_outbox(next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS vault_sync_cursors (
    collection_id TEXT PRIMARY KEY NOT NULL,
    cursor TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_tombstones (
    collection_id TEXT NOT NULL,
    vault_item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (collection_id, vault_item_id)
);
