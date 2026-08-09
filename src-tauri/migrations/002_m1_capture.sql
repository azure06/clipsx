-- M1: a clip is observable only after its complete representation set is ready.
ALTER TABLE clip_items ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (lifecycle_state IN ('pending', 'ready', 'failed'));
ALTER TABLE clip_items ADD COLUMN capture_sha256 TEXT
  CHECK (capture_sha256 IS NULL OR (length(capture_sha256) = 64 AND capture_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE clip_items ADD COLUMN total_payload_bytes INTEGER NOT NULL DEFAULT 0
  CHECK (total_payload_bytes >= 0);

CREATE UNIQUE INDEX idx_clip_items_capture_sha256_ready
  ON clip_items(capture_sha256) WHERE lifecycle_state = 'ready';
CREATE INDEX idx_clip_items_ready_recency
  ON clip_items(lifecycle_state, captured_at DESC, id DESC);
CREATE INDEX idx_clip_items_ready_favorite
  ON clip_items(lifecycle_state, is_favorite, captured_at DESC);
CREATE INDEX idx_clip_items_ready_pinned
  ON clip_items(lifecycle_state, is_pinned, captured_at DESC);
CREATE INDEX idx_catalog_clip_tags_tag ON catalog_clip_tags(tag_id, clip_id);

CREATE TRIGGER clip_items_ready_requires_complete_snapshot
BEFORE UPDATE OF lifecycle_state ON clip_items
WHEN NEW.lifecycle_state = 'ready'
BEGIN
  SELECT CASE WHEN NEW.capture_sha256 IS NULL
    THEN RAISE(ABORT, 'ready clip requires capture fingerprint') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM clip_representations
    WHERE clip_id = NEW.id AND lifecycle_state != 'ready'
  ) THEN RAISE(ABORT, 'ready clip requires every representation to be ready') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM clip_representations WHERE clip_id = NEW.id
  ) THEN RAISE(ABORT, 'ready clip requires representations') END;
END;

INSERT OR IGNORE INTO config_device_values(key, value_json, updated_at) VALUES
 ('capture.max_ordinary_clips', '1000', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
 ('capture.max_age_days', 'null', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
 ('capture.max_managed_bytes', '1073741824', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
 ('capture.max_representation_bytes', '52428800', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
 ('capture.max_snapshot_bytes', '104857600', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
