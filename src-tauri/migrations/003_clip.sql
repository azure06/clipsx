CREATE TABLE clip_items (
    id TEXT PRIMARY KEY NOT NULL,
    source_app_name TEXT,
    source_app_id TEXT,
    note TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    captured_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    lifecycle_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (lifecycle_state IN ('pending', 'ready', 'failed')),
    capture_sha256 TEXT
        CHECK (capture_sha256 IS NULL OR (length(capture_sha256) = 64 AND capture_sha256 NOT GLOB '*[^0-9a-f]*')),
    total_payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_payload_bytes >= 0)
);

CREATE TABLE clip_binary_files (
    id TEXT PRIMARY KEY NOT NULL,
    sha256 TEXT NOT NULL UNIQUE
        CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    relative_path TEXT NOT NULL UNIQUE
        CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%' AND relative_path NOT LIKE '%\%'),
    lifecycle_state TEXT NOT NULL
        CHECK (lifecycle_state IN ('pending', 'ready', 'missing', 'quarantined')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE clip_representations (
    id TEXT PRIMARY KEY NOT NULL,
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    format_key TEXT NOT NULL,
    canonical_mime_type TEXT,
    native_type TEXT,
    capability_id TEXT NOT NULL,
    format_family TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('macos', 'windows', 'linux_x11')),
    storage_kind TEXT NOT NULL CHECK (storage_kind IN ('text', 'binary_asset', 'file_list')),
    binary_file_id TEXT REFERENCES clip_binary_files(id) ON DELETE RESTRICT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    capture_priority INTEGER NOT NULL DEFAULT 0,
    lifecycle_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (lifecycle_state IN ('pending', 'ready', 'failed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (clip_id, format_key),
    UNIQUE (clip_id, ordinal),
    CHECK (length(capability_id) BETWEEN 3 AND 120),
    CHECK (length(format_family) BETWEEN 2 AND 64),
    CHECK (
        (storage_kind = 'binary_asset' AND binary_file_id IS NOT NULL)
        OR (storage_kind IN ('text', 'file_list') AND binary_file_id IS NULL)
    )
);

CREATE TABLE clip_format_observations (
    clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 512),
    platform TEXT NOT NULL CHECK (platform IN ('macos', 'windows', 'linux_x11')),
    native_identifier TEXT NOT NULL CHECK (length(native_identifier) BETWEEN 1 AND 256),
    numeric_id INTEGER,
    medium TEXT CHECK (medium IS NULL OR length(medium) <= 64),
    byte_length INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
    capability_id TEXT CHECK (capability_id IS NULL OR length(capability_id) BETWEEN 3 AND 120),
    policy_version INTEGER NOT NULL CHECK (policy_version > 0),
    decision TEXT NOT NULL CHECK (decision IN ('captured', 'disabled', 'unsupported', 'redundant', 'unreadable', 'too_large')),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
    PRIMARY KEY (clip_id, ordinal)
);

CREATE TABLE clip_text_values (
    representation_id TEXT PRIMARY KEY NOT NULL
        REFERENCES clip_representations(id) ON DELETE CASCADE,
    text_value TEXT NOT NULL,
    utf8_byte_length INTEGER NOT NULL CHECK (utf8_byte_length >= 0),
    sha256 TEXT NOT NULL
        CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')
);

CREATE TABLE clip_file_list_entries (
    representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    file_reference TEXT NOT NULL,
    PRIMARY KEY (representation_id, ordinal)
);

CREATE TABLE clip_transform_provenance (
    clip_id TEXT PRIMARY KEY NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    source_clip_id TEXT REFERENCES clip_items(id) ON DELETE SET NULL,
    source_representation_id TEXT REFERENCES clip_representations(id) ON DELETE SET NULL,
    source_capture_sha256 TEXT NOT NULL CHECK (length(source_capture_sha256) = 64),
    source_format_key TEXT NOT NULL,
    source_mime_type TEXT,
    transformer_id TEXT NOT NULL,
    transformer_version TEXT NOT NULL,
    parameter_sha256 TEXT NOT NULL CHECK (length(parameter_sha256) = 64),
    created_at INTEGER NOT NULL
);

CREATE TRIGGER clip_representations_ready_requires_storage
BEFORE UPDATE OF lifecycle_state ON clip_representations
WHEN NEW.lifecycle_state = 'ready'
BEGIN
    SELECT CASE
        WHEN NEW.storage_kind = 'text' AND NOT EXISTS (
            SELECT 1 FROM clip_text_values WHERE representation_id = NEW.id
        ) THEN RAISE(ABORT, 'ready text representation requires a text value')
        WHEN NEW.storage_kind = 'file_list' AND NOT EXISTS (
            SELECT 1 FROM clip_file_list_entries WHERE representation_id = NEW.id
        ) THEN RAISE(ABORT, 'ready file-list representation requires entries')
        WHEN NEW.storage_kind = 'binary_asset' AND NOT EXISTS (
            SELECT 1 FROM clip_binary_files
            WHERE id = NEW.binary_file_id AND lifecycle_state = 'ready'
        ) THEN RAISE(ABORT, 'ready binary representation requires a ready binary file')
    END;
END;

CREATE TRIGGER clip_items_ready_requires_complete_snapshot
BEFORE UPDATE OF lifecycle_state ON clip_items
WHEN NEW.lifecycle_state = 'ready'
BEGIN
    SELECT CASE WHEN NEW.capture_sha256 IS NULL
        THEN RAISE(ABORT, 'ready clip requires capture fingerprint') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM clip_representations
        WHERE clip_id = NEW.id AND lifecycle_state != 'ready'
    ) THEN RAISE(ABORT, 'ready clip requires every representation to be ready') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM clip_representations WHERE clip_id = NEW.id
    ) THEN RAISE(ABORT, 'ready clip requires representations') END;
END;

CREATE UNIQUE INDEX idx_clip_items_capture_sha256_ready
    ON clip_items(capture_sha256) WHERE lifecycle_state = 'ready';
CREATE INDEX idx_clip_items_updated_at ON clip_items(updated_at DESC);
CREATE INDEX idx_clip_items_ready_recency
    ON clip_items(lifecycle_state, captured_at DESC, id DESC);
CREATE INDEX idx_clip_items_ready_favorite
    ON clip_items(lifecycle_state, is_favorite, captured_at DESC);
CREATE INDEX idx_clip_items_ready_pinned
    ON clip_items(lifecycle_state, is_pinned, captured_at DESC);
CREATE INDEX idx_clip_representations_clip_ready
    ON clip_representations(clip_id, lifecycle_state, ordinal);
CREATE INDEX idx_clip_format_observations_clip
    ON clip_format_observations(clip_id, ordinal);
CREATE INDEX idx_clip_binary_files_state ON clip_binary_files(lifecycle_state);
CREATE INDEX idx_clip_transform_provenance_source
    ON clip_transform_provenance(source_clip_id, source_representation_id);

CREATE TRIGGER clip_binary_files_enqueue_deletion
AFTER DELETE ON clip_binary_files
BEGIN
    INSERT INTO system_managed_file_deletions(relative_path, queued_at)
    VALUES (OLD.relative_path, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    ON CONFLICT(relative_path) DO UPDATE SET
        queued_at = excluded.queued_at,
        attempt_count = 0,
        last_attempt_at = NULL,
        last_error = NULL;
END;

CREATE TRIGGER clip_representations_remove_unreferenced_binary
AFTER DELETE ON clip_representations
WHEN OLD.binary_file_id IS NOT NULL
BEGIN
    DELETE FROM clip_binary_files
    WHERE id = OLD.binary_file_id
      AND NOT EXISTS (
          SELECT 1 FROM clip_representations
          WHERE binary_file_id = OLD.binary_file_id
      );
END;
