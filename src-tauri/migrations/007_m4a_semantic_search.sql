-- M4a: derived, generation-aware text chunks. Canonical clips remain untouched.
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
    UNIQUE(space_id, clip_id, generation, ordinal)
);
CREATE INDEX idx_search_chunks_space_clip ON search_chunks(space_id, clip_id, generation);
ALTER TABLE search_embeddings ADD COLUMN chunk_id TEXT REFERENCES search_chunks(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_search_embeddings_chunk ON search_embeddings(chunk_id) WHERE chunk_id IS NOT NULL;
ALTER TABLE search_index_jobs ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_index_jobs ADD COLUMN projection_sha256 TEXT;
ALTER TABLE search_index_jobs ADD COLUMN chunker_version TEXT;
CREATE UNIQUE INDEX idx_search_index_jobs_active
    ON search_index_jobs(space_id, clip_id, generation)
    WHERE status IN ('pending', 'running');
INSERT OR IGNORE INTO config_profile_values(key, value_json, updated_at)
VALUES ('search.embedding.provider', 'null', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
