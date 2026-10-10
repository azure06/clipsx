CREATE TABLE ai_embedding_activation (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  intent_json TEXT NOT NULL CHECK(json_valid(intent_json)),
  updated_at INTEGER NOT NULL
);
UPDATE system_schema_meta SET schema_version=20;
