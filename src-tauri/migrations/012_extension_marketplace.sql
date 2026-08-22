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

-- Package settings follow stable package identity, rather than a transient install row.
CREATE TABLE extension_package_settings_v2 (
    package_id TEXT NOT NULL,
    setting_id TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (length(value_json) <= 8192),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (package_id, setting_id)
);

INSERT INTO extension_package_settings_v2(package_id, setting_id, value_json, updated_at)
SELECT i.package_id, s.setting_id, s.value_json, s.updated_at
FROM extension_package_settings s
JOIN extension_installs i ON i.id = s.extension_id;
