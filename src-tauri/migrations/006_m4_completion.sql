-- M4 completion: explicit artifact controls and persisted FTS provenance.
INSERT OR IGNORE INTO config_profile_values(key, value_json, updated_at)
VALUES ('artifacts.ocr.enabled', 'true', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE INDEX IF NOT EXISTS idx_artifact_records_ready_producer
    ON artifact_records(producer_id, producer_version, lifecycle_state);
