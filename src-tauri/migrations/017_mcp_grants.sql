CREATE TABLE assistant_mcp_grants (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
 token_sha256 TEXT NOT NULL UNIQUE CHECK(length(token_sha256)=64),
 can_write INTEGER NOT NULL CHECK(can_write IN (0,1)), created_at INTEGER NOT NULL,
 rotated_at INTEGER, revoked_at INTEGER
);
UPDATE system_schema_meta SET schema_version=17;
