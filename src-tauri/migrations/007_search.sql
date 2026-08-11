CREATE TABLE search_documents (
    clip_id TEXT PRIMARY KEY NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    search_text TEXT NOT NULL,
    projection_version INTEGER NOT NULL,
    source_manifest_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
    clip_id UNINDEXED,
    search_text,
    content = search_documents,
    content_rowid = rowid
);

CREATE TRIGGER search_documents_fts_insert
AFTER INSERT ON search_documents
BEGIN
    INSERT INTO search_documents_fts(rowid, clip_id, search_text)
    VALUES (NEW.rowid, NEW.clip_id, NEW.search_text);
END;

CREATE TRIGGER search_documents_fts_delete
AFTER DELETE ON search_documents
BEGIN
    INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text)
    VALUES ('delete', OLD.rowid, OLD.clip_id, OLD.search_text);
END;

CREATE TRIGGER search_documents_fts_update
AFTER UPDATE ON search_documents
BEGIN
    INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text)
    VALUES ('delete', OLD.rowid, OLD.clip_id, OLD.search_text);
    INSERT INTO search_documents_fts(rowid, clip_id, search_text)
    VALUES (NEW.rowid, NEW.clip_id, NEW.search_text);
END;

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

CREATE TABLE search_chunks (
    id TEXT PRIMARY KEY NOT NULL,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    chunk_kind TEXT NOT NULL,
    text_value TEXT NOT NULL,
    text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
    source_manifest_json TEXT NOT NULL,
    projection_sha256 TEXT NOT NULL CHECK (length(projection_sha256) = 64),
    chunker_id TEXT NOT NULL,
    chunker_version TEXT NOT NULL,
    generation INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (space_id, clip_id, generation, ordinal)
);

CREATE TABLE search_embeddings (
    id TEXT PRIMARY KEY NOT NULL,
    space_id TEXT NOT NULL REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    artifact_id TEXT REFERENCES artifact_records(id) ON DELETE CASCADE,
    vector BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    chunk_id TEXT REFERENCES search_chunks(id) ON DELETE CASCADE
);

CREATE TRIGGER search_embeddings_dimension_matches_space
BEFORE INSERT ON search_embeddings
WHEN length(NEW.vector) != (
    SELECT dimensions * 4 FROM search_embedding_spaces WHERE id = NEW.space_id
)
BEGIN
    SELECT RAISE(ABORT, 'embedding vector dimensions do not match its space');
END;

CREATE TABLE search_index_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    space_id TEXT REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    clip_id TEXT REFERENCES clip_items(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    generation INTEGER NOT NULL DEFAULT 0,
    projection_sha256 TEXT,
    chunker_version TEXT
);

CREATE INDEX idx_search_chunks_space_clip
    ON search_chunks(space_id, clip_id, generation);
CREATE INDEX idx_search_embeddings_space_clip
    ON search_embeddings(space_id, clip_id);
CREATE UNIQUE INDEX idx_search_embeddings_chunk
    ON search_embeddings(chunk_id) WHERE chunk_id IS NOT NULL;
CREATE INDEX idx_search_index_jobs_status
    ON search_index_jobs(status, requested_at);
CREATE UNIQUE INDEX idx_search_index_jobs_active
    ON search_index_jobs(space_id, clip_id, generation)
    WHERE status IN ('pending', 'running');
