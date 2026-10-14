ALTER TABLE clip_items ADD COLUMN assistant_revision INTEGER NOT NULL DEFAULT 0;
DROP INDEX idx_clip_items_capture_sha256_ready;
CREATE INDEX idx_clip_items_capture_sha256_ready ON clip_items(capture_sha256) WHERE lifecycle_state='ready';

CREATE TRIGGER assistant_clip_revision AFTER UPDATE OF note,is_pinned,is_favorite,captured_at,capture_sha256,source_app_id,source_app_name ON clip_items
WHEN NEW.note IS NOT OLD.note OR NEW.is_pinned!=OLD.is_pinned OR NEW.is_favorite!=OLD.is_favorite OR NEW.captured_at!=OLD.captured_at OR NEW.capture_sha256 IS NOT OLD.capture_sha256 OR NEW.source_app_id IS NOT OLD.source_app_id OR NEW.source_app_name IS NOT OLD.source_app_name
BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER assistant_tag_insert AFTER INSERT ON catalog_clip_tags BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=NEW.clip_id; END;
CREATE TRIGGER assistant_tag_delete AFTER DELETE ON catalog_clip_tags BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=OLD.clip_id; END;
CREATE TRIGGER assistant_tag_update AFTER UPDATE OF name,color ON catalog_tags
BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id IN (SELECT clip_id FROM catalog_clip_tags WHERE tag_id=NEW.id); END;
CREATE TRIGGER assistant_text_update AFTER UPDATE ON clip_text_values
BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=(SELECT clip_id FROM clip_representations WHERE id=NEW.representation_id); END;
CREATE TRIGGER assistant_rep_insert AFTER INSERT ON clip_representations BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=NEW.clip_id; END;
CREATE TRIGGER assistant_rep_update AFTER UPDATE ON clip_representations BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=NEW.clip_id; END;
CREATE TRIGGER assistant_rep_delete AFTER DELETE ON clip_representations BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=OLD.clip_id; END;
CREATE TRIGGER assistant_facet_insert AFTER INSERT ON content_clip_facets BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=NEW.clip_id; END;
CREATE TRIGGER assistant_facet_delete AFTER DELETE ON content_clip_facets BEGIN UPDATE clip_items SET assistant_revision=assistant_revision+1 WHERE id=OLD.clip_id; END;

CREATE TABLE assistant_clip_provenance (
 clip_id TEXT PRIMARY KEY REFERENCES clip_items(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('native_assistant','mcp_client')),
 sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
 model_json TEXT CHECK(model_json IS NULL OR json_valid(model_json)),
 attribution_source TEXT NOT NULL CHECK(attribution_source IN ('host_verified','client_supplied','none')),
 created_at INTEGER NOT NULL
);
-- No clip FK: activity and idempotency survive clip deletion until their retention deadline.
CREATE TABLE assistant_actions (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, request_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('create','organize','undo')),
 arguments_sha256 TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)), after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 undone_at INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 UNIQUE(actor_id,request_id)
);
CREATE INDEX assistant_actions_expiry ON assistant_actions(expires_at);
CREATE TABLE assistant_index_intents (
 clip_id TEXT PRIMARY KEY REFERENCES clip_items(id) ON DELETE CASCADE,
 token TEXT NOT NULL, requested_at INTEGER NOT NULL
);
CREATE TABLE system_schema_meta_next (
 schema_id TEXT PRIMARY KEY NOT NULL CHECK(schema_id='clipsx-local-v3'),
 schema_version INTEGER NOT NULL CHECK(schema_version>=15), created_at INTEGER NOT NULL
);
INSERT INTO system_schema_meta_next SELECT schema_id,16,created_at FROM system_schema_meta;
DROP TABLE system_schema_meta;
ALTER TABLE system_schema_meta_next RENAME TO system_schema_meta;
