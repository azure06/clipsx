CREATE TABLE ai_connections (
  id TEXT PRIMARY KEY,
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  credential_ref TEXT NOT NULL UNIQUE,
  last_test_at INTEGER,
  last_test_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE ai_model_presets (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ai_connections(id),
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ai_presets_connection ON ai_model_presets(connection_id);
CREATE TABLE ai_selections (
  selection_key TEXT PRIMARY KEY CHECK(selection_key IN ('default_chat','active_embedding','web_search','legacy_migrated')),
  selected_id TEXT
);
UPDATE system_schema_meta SET schema_version=18;
