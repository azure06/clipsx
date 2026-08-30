CREATE TABLE search_documents (
    clip_id TEXT PRIMARY KEY NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    search_text TEXT NOT NULL,
    projection_version INTEGER NOT NULL,
    source_manifest_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
    clip_id UNINDEXED,
    search_text,
    content = search_documents,
    content_rowid = rowid
);

CREATE TRIGGER search_documents_fts_insert AFTER INSERT ON search_documents BEGIN
    INSERT INTO search_documents_fts(rowid, clip_id, search_text)
    VALUES (NEW.rowid, NEW.clip_id, NEW.search_text);
END;
CREATE TRIGGER search_documents_fts_delete AFTER DELETE ON search_documents BEGIN
    INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text)
    VALUES ('delete', OLD.rowid, OLD.clip_id, OLD.search_text);
END;
CREATE TRIGGER search_documents_fts_update AFTER UPDATE ON search_documents BEGIN
    INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text)
    VALUES ('delete', OLD.rowid, OLD.clip_id, OLD.search_text);
    INSERT INTO search_documents_fts(rowid, clip_id, search_text)
    VALUES (NEW.rowid, NEW.clip_id, NEW.search_text);
END;

CREATE TABLE search_embedding_spaces (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL,
    provider_version TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    compatibility_sha256 TEXT NOT NULL UNIQUE CHECK (length(compatibility_sha256) = 64),
    modality TEXT NOT NULL CHECK (modality IN ('text', 'image', 'multimodal')),
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    normalization TEXT NOT NULL,
    distance_metric TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE search_index_generations (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    space_id TEXT NOT NULL REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    pipeline_version TEXT NOT NULL,
    backend_id TEXT NOT NULL DEFAULT 'builtin.quantized-flat.v1',
    vector_encoding TEXT NOT NULL DEFAULT 'int8_scan_float32_rerank'
        CHECK (vector_encoding = 'int8_scan_float32_rerank'),
    candidate_limit INTEGER NOT NULL DEFAULT 100 CHECK (candidate_limit BETWEEN 10 AND 1000),
    sidecar_relative_path TEXT,
    sidecar_byte_length INTEGER CHECK (sidecar_byte_length IS NULL OR sidecar_byte_length >= 0),
    sidecar_sha256 TEXT CHECK (sidecar_sha256 IS NULL OR length(sidecar_sha256) = 64),
    status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded', 'cancelled')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    activated_at INTEGER,
    completed_at INTEGER,
    UNIQUE (source_id, generation)
);

CREATE UNIQUE INDEX idx_search_generations_one_active
    ON search_index_generations(source_id) WHERE status = 'active';
CREATE UNIQUE INDEX idx_search_generations_one_building
    ON search_index_generations(source_id) WHERE status = 'building';
CREATE INDEX idx_search_generations_space
    ON search_index_generations(space_id, status, generation DESC);

CREATE TABLE search_chunks (
    id TEXT PRIMARY KEY NOT NULL,
    generation_id TEXT NOT NULL REFERENCES search_index_generations(id) ON DELETE CASCADE,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    artifact_id TEXT REFERENCES artifact_records(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    chunk_kind TEXT NOT NULL,
    text_value TEXT NOT NULL,
    text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
    source_manifest_json TEXT NOT NULL,
    projection_sha256 TEXT NOT NULL CHECK (length(projection_sha256) = 64),
    chunker_id TEXT NOT NULL,
    chunker_version TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (generation_id, clip_id, ordinal),
    CHECK (representation_id IS NULL OR artifact_id IS NULL)
);

CREATE TABLE search_embeddings (
    chunk_id TEXT PRIMARY KEY NOT NULL REFERENCES search_chunks(id) ON DELETE CASCADE,
    vector BLOB NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TRIGGER search_chunks_representation_owner
BEFORE INSERT ON search_chunks
WHEN NEW.representation_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM clip_representations r
        WHERE r.id = NEW.representation_id AND r.clip_id = NEW.clip_id
    ) THEN RAISE(ABORT, 'search chunk representation must belong to its clip') END;
END;

CREATE TRIGGER search_chunks_artifact_owner
BEFORE INSERT ON search_chunks
WHEN NEW.artifact_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM artifact_records a
        WHERE a.id = NEW.artifact_id AND a.owner_clip_id = NEW.clip_id
    ) THEN RAISE(ABORT, 'search chunk artifact must belong to its clip') END;
END;

CREATE TRIGGER search_embeddings_dimension_matches_space
BEFORE INSERT ON search_embeddings
WHEN length(NEW.vector) != (
    SELECT s.dimensions * 4
    FROM search_chunks c
    JOIN search_index_generations g ON g.id = c.generation_id
    JOIN search_embedding_spaces s ON s.id = g.space_id
    WHERE c.id = NEW.chunk_id
)
BEGIN
    SELECT RAISE(ABORT, 'embedding vector dimensions do not match its space');
END;

CREATE TABLE search_index_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    generation_id TEXT NOT NULL REFERENCES search_index_generations(id) ON DELETE CASCADE,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    projection_sha256 TEXT,
    UNIQUE (generation_id, clip_id)
);

CREATE INDEX idx_search_chunks_generation_clip
    ON search_chunks(generation_id, clip_id, ordinal);
CREATE INDEX idx_search_chunks_clip
    ON search_chunks(clip_id, generation_id);
CREATE INDEX idx_search_index_jobs_status
    ON search_index_jobs(generation_id, status, requested_at);
