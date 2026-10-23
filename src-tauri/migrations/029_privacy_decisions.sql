-- Independent privacy assignment; older named configurations remain importable.
CREATE TABLE ai_selections_next (
  selection_key TEXT PRIMARY KEY CHECK(selection_key IN (
    'default_chat','active_embedding','web_search','legacy_migrated',
    'extension_generation','default_decision','active_rerank','privacy_decision'
  )), selected_id TEXT
);
INSERT INTO ai_selections_next SELECT selection_key,selected_id FROM ai_selections;
DROP TABLE ai_selections;
ALTER TABLE ai_selections_next RENAME TO ai_selections;
DROP TRIGGER semantic_secret_cleanup_insert;
DROP TRIGGER semantic_secret_cleanup_update;
CREATE TRIGGER semantic_secret_cleanup_insert AFTER INSERT ON content_clip_facets
WHEN NEW.facet_id IN ('core.security.secret','core.security.private')
BEGIN
  INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at) VALUES(NEW.clip_id,NEW.created_at);
END;
CREATE TRIGGER semantic_secret_cleanup_update AFTER UPDATE OF facet_id,clip_id ON content_clip_facets
WHEN NEW.facet_id IN ('core.security.secret','core.security.private')
BEGIN
  INSERT OR IGNORE INTO search_semantic_cleanup(clip_id,requested_at) VALUES(NEW.clip_id,NEW.created_at);
END;
UPDATE system_schema_meta SET schema_version=29;
