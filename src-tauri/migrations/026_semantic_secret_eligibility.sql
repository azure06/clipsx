-- Purge existing derived vectors; captured clips and local FTS remain unchanged.
INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at)
SELECT DISTINCT clip_id,created_at FROM content_clip_facets WHERE facet_id='core.security.secret';

-- Existing vectors predate the full-input policy (including notes and OCR).
-- Remove them before rebuilding through the deterministic eligibility gate.
INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at)
SELECT DISTINCT clip_id,requested_at FROM search_index_jobs;
UPDATE search_index_jobs SET status='pending',started_at=NULL,completed_at=NULL,
    projection_sha256=NULL,last_error=NULL,attempt_count=0;

CREATE TRIGGER semantic_secret_cleanup_insert AFTER INSERT ON content_clip_facets
WHEN NEW.facet_id='core.security.secret'
BEGIN
  INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at) VALUES(NEW.clip_id,NEW.created_at);
END;

CREATE TRIGGER semantic_secret_cleanup_update AFTER UPDATE OF facet_id,clip_id ON content_clip_facets
WHEN NEW.facet_id='core.security.secret'
BEGIN
  INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at) VALUES(NEW.clip_id,NEW.created_at);
END;

UPDATE system_schema_meta SET schema_version=26;
