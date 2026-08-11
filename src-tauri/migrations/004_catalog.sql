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

CREATE INDEX idx_catalog_clip_tags_tag ON catalog_clip_tags(tag_id, clip_id);
