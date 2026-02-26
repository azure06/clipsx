-- =====================================================
-- TABLE: clips
-- PURPOSE: Stores all clipboard history items
-- NOTE: This is the main table - every copied item becomes a clip
-- =====================================================
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY NOT NULL,
    content_type TEXT NOT NULL,
    -- Type: 'text', 'html', 'rtf', 'image', 'files', 'office'
    content_text TEXT,
    -- Plain text version (always populated for search)
    content_html TEXT,
    -- Raw HTML markup (if copied from browser/rich editor)
    content_rtf TEXT,
    -- RTF format (if copied from Word/Pages)
    svg_path TEXT,
    -- SVG file path: clipboard_data/svg/{id}.svg
    pdf_path TEXT,
    -- PDF file path: clipboard_data/pdf/{id}.pdf
    image_path TEXT,
    -- Image file path: clipboard_data/images/{id}.{ext}
    attachment_path TEXT,
    -- Office native format file path: clipboard_data/office/{id}.bin
    attachment_type TEXT,
    -- UTI type string used to write OLE data back to pasteboard, e.g. "com.microsoft.PowerPoint-14.0-Slides-Package"
    file_paths TEXT,
    -- JSON array of file paths (e.g., from Finder drag-drop)
    -- INTELLIGENCE FIELDS
    detected_type TEXT DEFAULT 'text',
    -- 'url', 'email', 'color', 'code', 'jwt', 'image', 'file_list'
    metadata TEXT,
    -- JSON object with content-specific metadata:
    -- Text: {"line_count": 5, "word_count": 42}
    -- URL: {"url": "...", "domain": "...", "protocol": "https"}
    -- Email: {"email": "...", "domain": "..."}
    -- Color: {"format": "hex|rgb|hsl", "hex": "#FF0000", ...}
    -- Code: {"language": "rust", "score": 12, "keyword_hits": 8, "line_count": 50}
    -- JWT: {"parts": 3, "header_preview": "..."}
    -- JSON: {"kind": "object|array", "size": 5, "line_count": 10}
    -- Path: {"path": "...", "filename": "...", "extension": "...", "platform": "unix|windows"}
    -- Secret: {"kind": "aws_access_key|github_token|...", "warning": "..."}
    -- Image: {"format": "image/png"}
    -- Files: {"count": 3, "files": [{"path": "...", "name": "...", "size": 1024, "created": ..., "modified": ...}, ...]}
    -- Office: {"source_app": "Microsoft Word|Excel|PowerPoint"}
    app_name TEXT,
    -- Source app name (e.g., "Safari", "VS Code")
    is_pinned INTEGER DEFAULT 0,
    -- Pin to top (0=false, 1=true) - temporary priority
    is_favorite INTEGER DEFAULT 0,
    -- Mark as favorite (0=false, 1=true) - permanent save
    access_count INTEGER DEFAULT 0,
    -- How many times this clip was used/copied
    content_hash TEXT,
    -- SHA hash for duplicate detection
    created_at INTEGER NOT NULL,
    -- Unix timestamp when first copied
    updated_at INTEGER NOT NULL -- Last access/bump timestamp (for recency sorting)
);
-- =====================================================
-- TABLE: tags
-- PURPOSE: Labels for quick filtering (multi-label system)
-- EXAMPLES: #work, #urgent, #code, #personal, #design
-- NOTE: One clip can have multiple tags
-- =====================================================
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    -- Tag name (lowercase, no spaces recommended)
    color TEXT,
    -- Hex color code for UI (#FF6B6B, #4ECDC4, etc.)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
-- =====================================================
-- TABLE: clip_tags (Junction Table)
-- PURPOSE: Many-to-many relationship between clips and tags
-- EXAMPLE: Clip "API docs" can have tags #work, #code, #reference
-- =====================================================
CREATE TABLE IF NOT EXISTS clip_tags (
    clip_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    -- When this tag was added to the clip
    PRIMARY KEY (clip_id, tag_id),
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
-- =====================================================
-- TABLE: collections
-- PURPOSE: Project-based folders/groups for organizing clips
-- EXAMPLES: "Project Alpha", "Meeting Notes 2024", "Code Snippets - Python"
-- NOTE: Think of these as folders - more structured than tags
-- =====================================================
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    -- Collection name
    icon TEXT,
    -- Emoji or Lucide icon name (e.g., "📁", "folder")
    description TEXT,
    -- Optional longer description
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
-- =====================================================
-- TABLE: clip_collections (Junction Table)
-- PURPOSE: Many-to-many relationship between clips and collections
-- EXAMPLE: Same clip can be in multiple collections (rare but possible)
-- =====================================================
CREATE TABLE IF NOT EXISTS clip_collections (
    clip_id TEXT NOT NULL,
    collection_id INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    -- When clip was added to this collection
    PRIMARY KEY (clip_id, collection_id),
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);
-- =====================================================
-- TABLE: embeddings
-- PURPOSE: Vector embeddings for semantic/AI-powered search
-- EXAMPLE: Search "authentication code" finds clips about login, JWT, OAuth
-- NOTE: Uses OpenAI/local embedding models to convert text → vectors
-- =====================================================
CREATE TABLE IF NOT EXISTS embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id TEXT NOT NULL UNIQUE,
    -- One embedding per clip
    vector BLOB NOT NULL,
    -- Serialized float array (e.g., 1536 dimensions for OpenAI)
    model TEXT NOT NULL,
    -- Model used (e.g., "text-embedding-3-small", "all-MiniLM-L6-v2")
    dimensions INTEGER NOT NULL,
    -- Vector size (768, 1536, etc.)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    -- Re-compute if clip content changes
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);
-- =====================================================
-- INDEXES: Performance optimization
-- =====================================================
-- Clips: Chronological and recency sorting
CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_updated_at ON clips(updated_at DESC);
-- Clips: Filter by type, pinned, favorites
CREATE INDEX IF NOT EXISTS idx_clips_content_type ON clips(content_type);
CREATE INDEX IF NOT EXISTS idx_clips_pinned ON clips(is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_favorite ON clips(is_favorite DESC, updated_at DESC);
-- Clips: Duplicate detection
CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash);
-- Clips: Usage tracking
CREATE INDEX IF NOT EXISTS idx_clips_access ON clips(access_count DESC);
-- Clips: Attachment/Office content queries
CREATE INDEX IF NOT EXISTS idx_clips_attachment ON clips(attachment_path)
WHERE attachment_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clips_svg ON clips(svg_path)
WHERE svg_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clips_pdf ON clips(pdf_path)
WHERE pdf_path IS NOT NULL;
-- Tags: Quick lookup by name
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
-- Junction tables: Efficient queries
CREATE INDEX IF NOT EXISTS idx_clip_tags_clip ON clip_tags(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_tags_tag ON clip_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_clip_collections_clip ON clip_collections(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_collections_collection ON clip_collections(collection_id);
-- Collections: Lookup by name
CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
-- Embeddings: Fast vector lookup
CREATE INDEX IF NOT EXISTS idx_embeddings_clip ON embeddings(clip_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
-- =====================================================
-- FULL-TEXT SEARCH (FTS5): Keyword-based search
-- PURPOSE: Fast text search with ranking (complements semantic search)
-- EXAMPLE: Search "database" finds all clips containing that word
-- =====================================================
CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
    id UNINDEXED,
    content_text,
    content = clips,
    content_rowid = rowid
);
-- Triggers to keep FTS table in sync with clips table
CREATE TRIGGER IF NOT EXISTS clips_fts_insert
AFTER
INSERT ON clips BEGIN
INSERT INTO clips_fts(rowid, id, content_text)
VALUES (new.rowid, new.id, new.content_text);
END;
CREATE TRIGGER IF NOT EXISTS clips_fts_delete
AFTER DELETE ON clips BEGIN
DELETE FROM clips_fts
WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS clips_fts_update
AFTER
UPDATE ON clips BEGIN
DELETE FROM clips_fts
WHERE rowid = old.rowid;
INSERT INTO clips_fts(rowid, id, content_text)
VALUES (new.rowid, new.id, new.content_text);
END;