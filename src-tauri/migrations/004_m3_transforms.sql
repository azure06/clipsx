CREATE TABLE clip_transform_provenance (
    clip_id TEXT PRIMARY KEY NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    source_clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE RESTRICT,
    source_representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE RESTRICT,
    transformer_id TEXT NOT NULL,
    transformer_version TEXT NOT NULL,
    parameter_sha256 TEXT NOT NULL CHECK (length(parameter_sha256) = 64),
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_clip_transform_provenance_source
ON clip_transform_provenance(source_clip_id, source_representation_id);
