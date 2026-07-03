CREATE TABLE IF NOT EXISTS search_documents (
    clip_id TEXT PRIMARY KEY NOT NULL,
    title TEXT,
    visible_text TEXT,
    ocr_text TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    source_app TEXT,
    thumbnail_path TEXT,
    search_version INTEGER NOT NULL DEFAULT 1,
    indexed_at INTEGER NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_documents_source_app ON search_documents(source_app);
CREATE INDEX IF NOT EXISTS idx_search_documents_indexed_at ON search_documents(indexed_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
    clip_id UNINDEXED,
    search_text,
    content = search_documents,
    content_rowid = rowid
);

CREATE TRIGGER IF NOT EXISTS search_documents_fts_insert
AFTER INSERT ON search_documents BEGIN
    INSERT INTO search_documents_fts(rowid, clip_id, search_text)
    VALUES (new.rowid, new.clip_id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS search_documents_fts_delete
AFTER DELETE ON search_documents BEGIN
    INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text)
    VALUES ('delete', old.rowid, old.clip_id, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS search_documents_fts_update
AFTER UPDATE ON search_documents BEGIN
    INSERT INTO search_documents_fts(search_documents_fts, rowid, clip_id, search_text)
    VALUES ('delete', old.rowid, old.clip_id, old.search_text);
    INSERT INTO search_documents_fts(rowid, clip_id, search_text)
    VALUES (new.rowid, new.clip_id, new.search_text);
END;

CREATE TABLE IF NOT EXISTS search_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id TEXT NOT NULL,
    modality TEXT NOT NULL,
    model TEXT NOT NULL,
    vector BLOB NOT NULL,
    dimensions INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (clip_id, modality, model),
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_embeddings_clip ON search_embeddings(clip_id);
CREATE INDEX IF NOT EXISTS idx_search_embeddings_modality_model ON search_embeddings(modality, model);

CREATE TABLE IF NOT EXISTS search_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL,
    search_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_jobs_status_updated_at ON search_jobs(status, updated_at DESC);

INSERT OR IGNORE INTO search_documents (
    clip_id,
    title,
    visible_text,
    ocr_text,
    search_text,
    source_app,
    thumbnail_path,
    search_version,
    indexed_at
)
SELECT
    clips.id,
    CASE
        WHEN clips.content_text IS NOT NULL AND clips.content_text != '' THEN substr(clips.content_text, 1, 160)
        WHEN clips.note IS NOT NULL AND clips.note != '' THEN substr(clips.note, 1, 160)
        ELSE NULL
    END,
    clips.content_text,
    clips.ocr_text,
    clips.index_text,
    clips.app_name,
    COALESCE(clips.image_path, clips.svg_path, clips.pdf_path),
    1,
    clips.updated_at
FROM clips;

INSERT INTO search_documents_fts(search_documents_fts) VALUES('rebuild');

INSERT OR IGNORE INTO search_embeddings (
    clip_id,
    modality,
    model,
    vector,
    dimensions,
    created_at,
    updated_at
)
SELECT
    clip_id,
    'text',
    model,
    vector,
    dimensions,
    created_at,
    updated_at
FROM embeddings;
