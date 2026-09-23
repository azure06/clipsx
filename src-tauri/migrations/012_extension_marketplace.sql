-- Reviewed marketplace metadata is a registry snapshot, never archive-owned data.
CREATE TABLE extension_registry_snapshots (
    package_id TEXT PRIMARY KEY NOT NULL,
    version TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK (length(metadata_json) <= 65536),
    recorded_at INTEGER NOT NULL
);
-- Profile preferences survive package archive replacement and can be synchronized.
CREATE TABLE extension_update_preferences (
    package_id TEXT PRIMARY KEY NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('inherit', 'enabled', 'disabled')),
    updated_at INTEGER NOT NULL
);
