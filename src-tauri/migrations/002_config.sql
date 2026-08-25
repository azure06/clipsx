CREATE TABLE config_profile_values (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE TABLE config_device_values (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE TABLE provider_runtime_diagnostics (
    provider_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    last_checked_at INTEGER,
    last_success_at INTEGER,
    last_error_code TEXT,
    last_error_message TEXT CHECK (last_error_message IS NULL OR length(last_error_message) <= 512),
    PRIMARY KEY (provider_id, capability)
);

INSERT INTO config_device_values (key, value_json, created_at, updated_at) VALUES
    ('capture.max_ordinary_clips', '1000', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('capture.max_age_days', 'null', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('capture.max_managed_bytes', '1073741824', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('capture.max_representation_bytes', '52428800', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('capture.max_snapshot_bytes', '104857600', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

INSERT INTO config_device_values (key, value_json, created_at, updated_at) VALUES
    ('providers.text_embedding.active', 'null', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

INSERT INTO config_profile_values (key, value_json, created_at, updated_at) VALUES
    ('renderer.preferences', '{}', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('search.syntax_mode', '"simple"', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('search.enabled_sources', '["builtin.search.fts"]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('artifacts.ocr.enabled', 'true', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('artifacts.ocr.language', '"auto"', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
