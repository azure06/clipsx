ALTER TABLE search_embedding_spaces ADD COLUMN provider_binding_json TEXT
    CHECK(provider_binding_json IS NULL OR json_valid(provider_binding_json));
UPDATE system_schema_meta SET schema_version=28;
