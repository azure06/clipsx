CREATE TABLE artifact_records (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_kind TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    producer_version TEXT NOT NULL,
    parameter_sha256 TEXT NOT NULL CHECK (length(parameter_sha256) = 64),
    input_manifest_sha256 TEXT
        CHECK (input_manifest_sha256 IS NULL OR length(input_manifest_sha256) = 64),
    lifecycle_state TEXT NOT NULL
        CHECK (lifecycle_state IN ('pending', 'ready', 'failed', 'unsupported', 'invalidated')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE artifact_inputs (
    artifact_id TEXT NOT NULL REFERENCES artifact_records(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    input_artifact_id TEXT REFERENCES artifact_records(id) ON DELETE CASCADE,
    input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
    PRIMARY KEY (artifact_id, ordinal),
    CHECK ((representation_id IS NOT NULL) != (input_artifact_id IS NOT NULL))
);

CREATE TABLE artifact_text_values (
    artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES artifact_records(id) ON DELETE CASCADE,
    text_value TEXT NOT NULL,
    utf8_byte_length INTEGER NOT NULL CHECK (utf8_byte_length >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
);

CREATE TABLE artifact_binary_files (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_id TEXT NOT NULL REFERENCES artifact_records(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    relative_path TEXT NOT NULL UNIQUE
        CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%' AND relative_path NOT LIKE '%\%'),
    lifecycle_state TEXT NOT NULL
        CHECK (lifecycle_state IN ('pending', 'ready', 'missing', 'quarantined')),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    UNIQUE (artifact_id, sha256)
);

CREATE TABLE artifact_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_kind TEXT NOT NULL,
    target_representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    producer_id TEXT,
    producer_version TEXT,
    parameter_sha256 TEXT CHECK (parameter_sha256 IS NULL OR length(parameter_sha256) = 64),
    produced_artifact_id TEXT REFERENCES artifact_records(id) ON DELETE SET NULL,
    status TEXT NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unsupported', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
);

CREATE UNIQUE INDEX idx_artifact_jobs_one_active
    ON artifact_jobs(artifact_kind, target_representation_id, producer_id)
    WHERE status IN ('pending', 'running');
CREATE INDEX idx_artifact_jobs_status ON artifact_jobs(status, requested_at);
CREATE INDEX idx_artifact_records_ready_producer
    ON artifact_records(producer_id, producer_version, lifecycle_state);
