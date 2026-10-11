-- Decision-purpose presets and independent extension/decision assignments require
-- the named-model reader. Older binaries must refuse this configuration format.
CREATE TABLE ai_selections_next (
  selection_key TEXT PRIMARY KEY CHECK(selection_key IN (
    'default_chat','active_embedding','web_search','legacy_migrated',
    'extension_generation','default_decision'
  )),
  selected_id TEXT
);
INSERT INTO ai_selections_next(selection_key,selected_id)
  SELECT selection_key,selected_id FROM ai_selections;
DROP TABLE ai_selections;
ALTER TABLE ai_selections_next RENAME TO ai_selections;
UPDATE system_schema_meta SET schema_version=21;
