-- Protected credential stores cannot participate in SQLite transactions.
CREATE TABLE ai_credential_cleanup (
    connection_id TEXT PRIMARY KEY NOT NULL,
    requested_at INTEGER NOT NULL
);
UPDATE system_schema_meta SET schema_version=27;
