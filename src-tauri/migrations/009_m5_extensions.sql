-- M5: installed extension packages and their runtime state. These tables store
-- package metadata only; extension bytes remain in the app-owned extension root.
DROP TABLE IF EXISTS extension_contribution_runtime_state;
DROP TABLE IF EXISTS extension_runtime_state;
DROP TABLE IF EXISTS extension_installs;

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
    updated_at INTEGER NOT NULL
);

CREATE TABLE extension_contribution_runtime_state (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    contribution_id TEXT NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    last_error_code TEXT,
    last_error_message TEXT,
    last_failed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, contribution_id)
);

CREATE INDEX idx_extension_installs_enabled ON extension_installs(enabled, package_id);
CREATE INDEX idx_extension_contribution_runtime_state_extension ON extension_contribution_runtime_state(extension_id);
