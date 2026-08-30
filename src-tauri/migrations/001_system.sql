PRAGMA foreign_keys = ON;

CREATE TABLE system_schema_meta (
    schema_id TEXT PRIMARY KEY NOT NULL CHECK (schema_id = 'clipsx-local-v2'),
    schema_version INTEGER NOT NULL CHECK (schema_version = 8),
    created_at INTEGER NOT NULL
);

INSERT INTO system_schema_meta (schema_id, schema_version, created_at)
VALUES ('clipsx-local-v2', 8, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE system_managed_file_deletions (
    relative_path TEXT PRIMARY KEY NOT NULL
        CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%' AND relative_path NOT LIKE '%\%'),
    queued_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at INTEGER,
    last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 512)
);
