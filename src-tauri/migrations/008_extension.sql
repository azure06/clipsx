-- Package metadata only; extension bytes remain in the app-owned extension root.
CREATE TABLE extension_installs (
    id TEXT PRIMARY KEY NOT NULL,
    package_id TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL,
    api_version TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('registry', 'developer')),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    relative_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE extension_runtime_state (
    extension_id TEXT PRIMARY KEY NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('ready', 'quarantined', 'incompatible')),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE TABLE extension_contribution_runtime_state (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    contribution_id TEXT NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    last_error_code TEXT,
    last_error_message TEXT,
    last_failed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    PRIMARY KEY (extension_id, contribution_id)
);

CREATE INDEX idx_extension_installs_enabled
    ON extension_installs(enabled, package_id);
CREATE INDEX idx_extension_contribution_runtime_state_extension
    ON extension_contribution_runtime_state(extension_id);

CREATE TABLE extension_action_shortcuts (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    action_id TEXT NOT NULL UNIQUE,
    accelerator TEXT NOT NULL UNIQUE CHECK (length(accelerator) BETWEEN 1 AND 80),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    PRIMARY KEY (extension_id, action_id)
);

CREATE TABLE extension_package_revisions (
    package_id TEXT PRIMARY KEY NOT NULL,
    configuration_revision INTEGER NOT NULL DEFAULT 0 CHECK (configuration_revision >= 0),
    grant_revision INTEGER NOT NULL DEFAULT 0 CHECK (grant_revision >= 0),
    state_revision INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
    updated_at INTEGER NOT NULL
);

CREATE TABLE extension_automation_rules (
    package_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    activation_id TEXT NOT NULL,
    app_platform TEXT NOT NULL CHECK (app_platform IN ('windows', 'macos', 'linux_x11')),
    app_id TEXT NOT NULL CHECK (length(app_id) BETWEEN 1 AND 256),
    app_display_name TEXT NOT NULL CHECK (length(app_display_name) BETWEEN 1 AND 256),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (package_id, rule_id),
    UNIQUE (package_id, activation_id, app_platform, app_id)
);

CREATE TABLE extension_package_state (
    package_id TEXT NOT NULL,
    state_key TEXT NOT NULL CHECK (length(state_key) BETWEEN 1 AND 120),
    value_json TEXT NOT NULL CHECK (json_valid(value_json) AND length(value_json) <= 8192),
    byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 8192),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (package_id, state_key)
);

CREATE TABLE extension_activation_events (
    event_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    activation_id TEXT NOT NULL,
    source_clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    source_representation_id TEXT REFERENCES clip_representations(id) ON DELETE CASCADE,
    captured_at INTEGER NOT NULL,
    is_new_clip INTEGER NOT NULL CHECK (is_new_clip IN (0, 1)),
    app_platform TEXT CHECK (app_platform IS NULL OR app_platform IN ('windows', 'macos', 'linux_x11')),
    app_id TEXT CHECK (app_id IS NULL OR length(app_id) BETWEEN 1 AND 256),
    app_display_name TEXT CHECK (app_display_name IS NULL OR length(app_display_name) BETWEEN 1 AND 256),
    package_sha256 TEXT NOT NULL CHECK (length(package_sha256) = 64),
    configuration_revision INTEGER NOT NULL CHECK (configuration_revision >= 0),
    grant_revision INTEGER NOT NULL CHECK (grant_revision >= 0),
    rule_id TEXT NOT NULL,
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped', 'failed')),
    reason_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, package_id, activation_id)
);

CREATE TABLE extension_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    request_id TEXT,
    source_clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    source_representation_id TEXT NOT NULL REFERENCES clip_representations(id) ON DELETE CASCADE,
    package_id TEXT NOT NULL,
    contribution_id TEXT NOT NULL,
    contribution_version TEXT NOT NULL,
    package_sha256 TEXT NOT NULL CHECK (length(package_sha256) = 64),
    input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    parameter_sha256 TEXT NOT NULL CHECK (length(parameter_sha256) = 64),
    app_platform TEXT CHECK (app_platform IS NULL OR app_platform IN ('windows', 'macos', 'linux_x11')),
    app_id TEXT CHECK (app_id IS NULL OR length(app_id) BETWEEN 1 AND 256),
    app_display_name TEXT CHECK (app_display_name IS NULL OR length(app_display_name) BETWEEN 1 AND 256),
    settings_revision INTEGER NOT NULL CHECK (settings_revision >= 0),
    grant_revision INTEGER NOT NULL CHECK (grant_revision >= 0),
    state_revision INTEGER NOT NULL CHECK (state_revision >= 0),
    provider_revision INTEGER NOT NULL CHECK (provider_revision >= 0),
    priority INTEGER NOT NULL CHECK (priority IN (0, 1, 2)),
    result_lifetime TEXT NOT NULL CHECK (result_lifetime IN ('temporary', 'source_clip')),
    dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) = 64),
    regeneration_nonce TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_provider', 'completed', 'failed', 'cancelled')),
    reason_code TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    transient_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (transient_retry_count BETWEEN 0 AND 3),
    interruption_count INTEGER NOT NULL DEFAULT 0 CHECK (interruption_count >= 0),
    claim_generation INTEGER NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
    retry_at INTEGER,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX extension_jobs_active_dedupe ON extension_jobs(dedupe_key)
    WHERE regeneration_nonce IS NULL AND status IN ('pending', 'running', 'waiting_provider', 'completed');
CREATE UNIQUE INDEX extension_jobs_request_id ON extension_jobs(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX extension_jobs_queue ON extension_jobs(status, priority, retry_at, requested_at, id);
CREATE INDEX extension_jobs_source ON extension_jobs(source_clip_id, package_id, created_at DESC);

CREATE TABLE extension_result_outputs (
    job_id TEXT NOT NULL REFERENCES extension_jobs(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
    artifact_id TEXT NOT NULL UNIQUE REFERENCES artifact_records(id) ON DELETE CASCADE,
    format_key TEXT NOT NULL CHECK (length(format_key) BETWEEN 1 AND 256),
    mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 256),
    PRIMARY KEY (job_id, ordinal)
);

CREATE TABLE extension_result_promotions (
    job_id TEXT NOT NULL REFERENCES extension_jobs(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    promoted_clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (job_id, request_id),
    UNIQUE (promoted_clip_id)
);

CREATE TRIGGER extension_result_output_owner
BEFORE INSERT ON extension_result_outputs
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM extension_jobs j
        JOIN artifact_records a ON a.id = NEW.artifact_id
        WHERE j.id = NEW.job_id AND j.source_clip_id = a.owner_clip_id
    ) THEN RAISE(ABORT, 'extension output must belong to the source clip') END;
END;
