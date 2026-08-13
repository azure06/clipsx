PRAGMA foreign_keys = ON;

CREATE TABLE system_schema_meta (
    schema_id TEXT PRIMARY KEY NOT NULL CHECK (schema_id = 'clipsx-local-v2'),
    schema_version INTEGER NOT NULL CHECK (schema_version = 2),
    created_at INTEGER NOT NULL
);

INSERT INTO system_schema_meta (schema_id, schema_version, created_at)
VALUES ('clipsx-local-v2', 2, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
