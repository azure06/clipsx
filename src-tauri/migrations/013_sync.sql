-- Local-first configuration sync state. Clipboard content and all derived data
-- are deliberately absent from this schema.
CREATE TABLE sync_device_identity (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    device_id TEXT NOT NULL UNIQUE CHECK (length(device_id) BETWEEN 1 AND 120),
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    created_at INTEGER NOT NULL,
    last_physical_ms INTEGER NOT NULL DEFAULT 0,
    last_logical_counter INTEGER NOT NULL DEFAULT 0 CHECK (last_logical_counter >= 0)
);

CREATE TABLE sync_outbox (
    record_kind TEXT NOT NULL CHECK (record_kind IN (
        'profile_setting',
        'renderer_preference',
        'extension_intent',
        'extension_setting',
        'shortcut'
    )),
    record_key TEXT NOT NULL CHECK (length(record_key) BETWEEN 1 AND 512),
    payload_json TEXT CHECK (
        payload_json IS NULL OR
        (json_valid(payload_json) AND length(payload_json) <= 65536)
    ),
    tombstone INTEGER NOT NULL DEFAULT 0 CHECK (tombstone IN (0, 1)),
    revision_physical_ms INTEGER NOT NULL CHECK (revision_physical_ms >= 0),
    revision_counter INTEGER NOT NULL CHECK (revision_counter >= 0),
    source_device_id TEXT NOT NULL CHECK (length(source_device_id) BETWEEN 1 AND 120),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at INTEGER,
    last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 512),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (record_kind, record_key)
);

CREATE INDEX sync_outbox_due_idx
ON sync_outbox(next_attempt_at, updated_at);

CREATE TABLE sync_remote_state (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    active_user_id TEXT,
    server_cursor INTEGER NOT NULL DEFAULT 0 CHECK (server_cursor >= 0),
    last_attempt_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 512),
    updated_at INTEGER NOT NULL
);

INSERT INTO sync_remote_state(singleton, enabled, server_cursor, updated_at)
VALUES (1, 0, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE sync_remote_quarantine (
    id TEXT PRIMARY KEY NOT NULL,
    server_cursor INTEGER,
    record_kind TEXT,
    record_key TEXT,
    payload_json TEXT,
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 512),
    quarantined_at INTEGER NOT NULL
);

