CREATE TABLE extension_package_settings (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    setting_id TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (length(value_json) <= 8192),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, setting_id)
);

