PRAGMA foreign_keys = ON;

CREATE TABLE system_schema_meta (
    schema_id TEXT PRIMARY KEY NOT NULL CHECK (schema_id = 'clipsx-local-v2'),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    created_at INTEGER NOT NULL
);
INSERT INTO system_schema_meta (schema_id, schema_version, created_at)
VALUES ('clipsx-local-v2', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE clip_items (
    id TEXT PRIMARY KEY NOT NULL,
    source_app_name TEXT,
    source_app_id TEXT,
    note TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    captured_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE clip_binary_files (
    id TEXT PRIMARY KEY NOT NULL,
    sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    relative_path TEXT NOT NULL UNIQUE CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%' AND relative_path NOT LIKE '%\\%'),
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('pending', 'ready', 'missing', 'quarantined')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE clip_representations (
    id TEXT PRIMARY KEY NOT NULL,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    format_key TEXT NOT NULL,
    canonical_mime_type TEXT,
    native_type TEXT,
    platform TEXT NOT NULL CHECK (platform IN ('macos', 'windows', 'linux_x11')),
    storage_kind TEXT NOT NULL CHECK (storage_kind IN ('text', 'binary_asset', 'file_list')),
    binary_file_id TEXT REFERENCES clip_binary_files(id) ON DELETE RESTRICT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    capture_priority INTEGER NOT NULL DEFAULT 0,
    lifecycle_state TEXT NOT NULL DEFAULT 'pending' CHECK (lifecycle_state IN ('pending', 'ready', 'failed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (clip_id, format_key),
    UNIQUE (clip_id, ordinal),
    CHECK ((storage_kind = 'binary_asset' AND binary_file_id IS NOT NULL) OR (storage_kind IN ('text', 'file_list') AND binary_file_id IS NULL))
);

CREATE TABLE clip_text_values (
    representation_id TEXT PRIMARY KEY NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    text_value TEXT NOT NULL,
    utf8_byte_length INTEGER NOT NULL CHECK (utf8_byte_length >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')
);

CREATE TABLE clip_file_list_entries (
    representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    file_reference TEXT NOT NULL,
    PRIMARY KEY (representation_id, ordinal)
);

CREATE TRIGGER clip_representations_ready_requires_storage
BEFORE UPDATE OF lifecycle_state ON clip_representations
WHEN NEW.lifecycle_state = 'ready'
BEGIN
    SELECT CASE
      WHEN NEW.storage_kind = 'text' AND NOT EXISTS (SELECT 1 FROM clip_text_values WHERE representation_id = NEW.id)
      THEN RAISE(ABORT, 'ready text representation requires a text value')
      WHEN NEW.storage_kind = 'file_list' AND NOT EXISTS (SELECT 1 FROM clip_file_list_entries WHERE representation_id = NEW.id)
      THEN RAISE(ABORT, 'ready file-list representation requires entries')
      WHEN NEW.storage_kind = 'binary_asset' AND NOT EXISTS (SELECT 1 FROM clip_binary_files WHERE id = NEW.binary_file_id AND lifecycle_state = 'ready')
      THEN RAISE(ABORT, 'ready binary representation requires a ready binary file')
    END;
END;

CREATE TABLE content_facet_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    version TEXT NOT NULL,
    display_name TEXT NOT NULL,
    UNIQUE (owner_id, id)
);
CREATE TABLE content_clip_facets (
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    facet_id TEXT NOT NULL REFERENCES content_facet_definitions(id) ON DELETE RESTRICT,
    source_representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    detector_id TEXT NOT NULL,
    detector_version TEXT NOT NULL,
    payload_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (clip_id, facet_id, source_representation_id, detector_id, detector_version)
);
CREATE TABLE content_detection_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    detector_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unsupported', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    UNIQUE (representation_id, detector_id)
);

CREATE TABLE catalog_tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE catalog_clip_tags (
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES catalog_tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (clip_id, tag_id)
);

CREATE TABLE artifact_records (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_kind TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    producer_version TEXT NOT NULL,
    parameter_sha256 TEXT NOT NULL CHECK (length(parameter_sha256) = 64),
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('pending', 'ready', 'failed', 'unsupported', 'invalidated')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE artifact_inputs (
    artifact_id TEXT NOT NULL REFERENCES artifact_records(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    input_artifact_id TEXT REFERENCES artifact_records(id) ON DELETE CASCADE,
    input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
    PRIMARY KEY (artifact_id, ordinal),
    CHECK ((representation_id IS NOT NULL) != (input_artifact_id IS NOT NULL))
);
CREATE TABLE artifact_text_values (
    artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES artifact_records(id) ON DELETE CASCADE,
    text_value TEXT NOT NULL,
    utf8_byte_length INTEGER NOT NULL CHECK (utf8_byte_length >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
);
CREATE TABLE artifact_binary_files (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_id TEXT NOT NULL REFERENCES artifact_records(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    relative_path TEXT NOT NULL UNIQUE CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%' AND relative_path NOT LIKE '%\\%'),
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('pending', 'ready', 'missing', 'quarantined')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (artifact_id, sha256)
);
CREATE TABLE artifact_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_kind TEXT NOT NULL,
    target_representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unsupported', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
);

CREATE TABLE search_documents (
    clip_id TEXT PRIMARY KEY NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    search_text TEXT NOT NULL,
    projection_version INTEGER NOT NULL,
    source_manifest_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE search_documents_fts USING fts5(clip_id UNINDEXED, search_text, content = search_documents, content_rowid = rowid);
CREATE TRIGGER search_documents_fts_insert AFTER INSERT ON search_documents BEGIN INSERT INTO search_documents_fts(rowid, clip_id, search_text) VALUES (NEW.rowid, NEW.clip_id, NEW.search_text); END;
CREATE TRIGGER search_documents_fts_delete AFTER DELETE ON search_documents BEGIN INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text) VALUES ('delete', OLD.rowid, OLD.clip_id, OLD.search_text); END;
CREATE TRIGGER search_documents_fts_update AFTER UPDATE ON search_documents BEGIN INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text) VALUES ('delete', OLD.rowid, OLD.clip_id, OLD.search_text); INSERT INTO search_documents_fts(rowid, clip_id, search_text) VALUES (NEW.rowid, NEW.clip_id, NEW.search_text); END;
CREATE TABLE search_embedding_spaces (
    id TEXT PRIMARY KEY NOT NULL,
    provider_kind TEXT NOT NULL,
    descriptor_json TEXT NOT NULL,
    descriptor_sha256 TEXT NOT NULL UNIQUE CHECK (length(descriptor_sha256) = 64),
    modality TEXT NOT NULL CHECK (modality IN ('text', 'image', 'multimodal')),
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    normalization TEXT NOT NULL,
    distance_metric TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE search_embeddings (
    id TEXT PRIMARY KEY NOT NULL,
    space_id TEXT NOT NULL REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    artifact_id TEXT REFERENCES artifact_records(id) ON DELETE CASCADE,
    vector BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK ((representation_id IS NOT NULL) != (artifact_id IS NOT NULL))
);
CREATE TRIGGER search_embeddings_dimension_matches_space
BEFORE INSERT ON search_embeddings
WHEN length(NEW.vector) != (SELECT dimensions * 4 FROM search_embedding_spaces WHERE id = NEW.space_id)
BEGIN SELECT RAISE(ABORT, 'embedding vector dimensions do not match its space'); END;
CREATE TABLE search_index_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    space_id TEXT REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    clip_id TEXT REFERENCES clip_items(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
);

CREATE TABLE extension_installs (
    id TEXT PRIMARY KEY NOT NULL,
    package_id TEXT NOT NULL,
    version TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    relative_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    installed_at INTEGER NOT NULL,
    UNIQUE (package_id, version)
);
CREATE TABLE extension_runtime_state (
    extension_id TEXT PRIMARY KEY NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('ready', 'quarantined', 'disabled')),
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at INTEGER NOT NULL
);
CREATE TABLE config_profile_values (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE config_device_values (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE INDEX idx_clip_items_updated_at ON clip_items(updated_at DESC);
CREATE INDEX idx_clip_representations_clip_ready ON clip_representations(clip_id, lifecycle_state, ordinal);
CREATE INDEX idx_clip_binary_files_state ON clip_binary_files(lifecycle_state);
CREATE INDEX idx_detection_jobs_status ON content_detection_jobs(status, requested_at);
CREATE INDEX idx_artifact_jobs_status ON artifact_jobs(status, requested_at);
CREATE INDEX idx_search_embeddings_space_clip ON search_embeddings(space_id, clip_id);
CREATE INDEX idx_search_index_jobs_status ON search_index_jobs(status, requested_at);
