-- Chunk embeddings are derived from a projection, not necessarily one source
-- representation or artifact. Rebuild this disposable table without the v2.0
-- source-exclusive check while retaining existing rows for upgrades.
CREATE TABLE search_embeddings_rebuilt (
    id TEXT PRIMARY KEY NOT NULL,
    space_id TEXT NOT NULL REFERENCES search_embedding_spaces(id) ON DELETE CASCADE,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    artifact_id TEXT REFERENCES artifact_records(id) ON DELETE CASCADE,
    vector BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    chunk_id TEXT REFERENCES search_chunks(id) ON DELETE CASCADE
);
INSERT INTO search_embeddings_rebuilt(id,space_id,clip_id,representation_id,artifact_id,vector,created_at,chunk_id)
SELECT id,space_id,clip_id,representation_id,artifact_id,vector,created_at,chunk_id FROM search_embeddings;
DROP TABLE search_embeddings;
ALTER TABLE search_embeddings_rebuilt RENAME TO search_embeddings;
CREATE TRIGGER search_embeddings_dimension_matches_space
BEFORE INSERT ON search_embeddings
WHEN length(NEW.vector) != (SELECT dimensions * 4 FROM search_embedding_spaces WHERE id = NEW.space_id)
BEGIN SELECT RAISE(ABORT, 'embedding vector dimensions do not match its space'); END;
CREATE INDEX idx_search_embeddings_space_clip ON search_embeddings(space_id, clip_id);
CREATE UNIQUE INDEX idx_search_embeddings_chunk ON search_embeddings(chunk_id) WHERE chunk_id IS NOT NULL;
