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
    detector_version TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unsupported', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
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
