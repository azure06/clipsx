CREATE TABLE content_facet_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    version TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    UNIQUE (owner_id, id)
);

CREATE TABLE content_clip_facets (
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    facet_id TEXT NOT NULL REFERENCES content_facet_definitions(id) ON DELETE RESTRICT,
    source_representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    detector_id TEXT NOT NULL,
    detector_version TEXT NOT NULL,
    payload_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    PRIMARY KEY (clip_id, facet_id, source_representation_id, detector_id, detector_version)
);

CREATE TABLE content_detection_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    detector_id TEXT NOT NULL,
    detector_version TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unsupported', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    UNIQUE (representation_id, detector_id)
);

CREATE INDEX idx_content_detection_jobs_ready
    ON content_detection_jobs(status, detector_id, detector_version, requested_at);
CREATE INDEX idx_detection_jobs_status
    ON content_detection_jobs(status, requested_at);
CREATE INDEX idx_content_clip_facets_source
    ON content_clip_facets(source_representation_id, facet_id);

-- Compact presentations are bounded, rebuildable UI data. They never
-- participate in capture fingerprints or canonical reconstruction.
CREATE TABLE content_compact_presentations (
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    source_representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    renderer_id TEXT NOT NULL,
    renderer_version TEXT NOT NULL,
    facet_id TEXT NOT NULL DEFAULT '',
    model_json TEXT NOT NULL CHECK (length(model_json) BETWEEN 2 AND 2048),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    PRIMARY KEY (clip_id, source_representation_id, renderer_id, facet_id)
);

CREATE INDEX idx_content_compact_presentations_clip
    ON content_compact_presentations(clip_id, updated_at DESC);
