CREATE TABLE extension_package_settings (
    package_id TEXT NOT NULL,
    setting_id TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (length(value_json) <= 8192),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (package_id, setting_id)
);

