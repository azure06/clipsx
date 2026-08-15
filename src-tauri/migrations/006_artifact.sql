CREATE TABLE artifact_records (
    id TEXT PRIMARY KEY NOT NULL,
    owner_clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
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
CREATE INDEX idx_artifact_records_owner
    ON artifact_records(owner_clip_id, artifact_kind, lifecycle_state);

CREATE TRIGGER artifact_inputs_representation_owner
BEFORE INSERT ON artifact_inputs
WHEN NEW.representation_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM artifact_records a
        JOIN clip_representations r ON r.id = NEW.representation_id
        WHERE a.id = NEW.artifact_id AND a.owner_clip_id = r.clip_id
    ) THEN RAISE(ABORT, 'artifact representation input must belong to its owning clip') END;
END;

CREATE TRIGGER artifact_inputs_artifact_owner
BEFORE INSERT ON artifact_inputs
WHEN NEW.input_artifact_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM artifact_records output
        JOIN artifact_records input ON input.id = NEW.input_artifact_id
        WHERE output.id = NEW.artifact_id
          AND output.owner_clip_id = input.owner_clip_id
    ) THEN RAISE(ABORT, 'artifact input must belong to its owning clip') END;
END;

CREATE TRIGGER artifact_binary_files_enqueue_deletion
AFTER DELETE ON artifact_binary_files
BEGIN
    INSERT INTO system_managed_file_deletions(relative_path, queued_at)
    VALUES (OLD.relative_path, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    ON CONFLICT(relative_path) DO UPDATE SET
        queued_at = excluded.queued_at,
        attempt_count = 0,
        last_attempt_at = NULL,
        last_error = NULL;
END;
