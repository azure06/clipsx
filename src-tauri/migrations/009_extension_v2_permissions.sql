-- Extension API v2 grants are deliberately tied to immutable package bytes.
-- Updating, disabling, or replacing a package removes these records.
CREATE TABLE extension_permission_grants (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    package_sha256 TEXT NOT NULL CHECK (length(package_sha256) = 64),
    permission_kind TEXT NOT NULL CHECK (permission_kind IN ('external_navigation', 'http', 'provider')),
    permission_value TEXT NOT NULL,
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, package_sha256, permission_kind, permission_value)
);

CREATE INDEX idx_extension_permission_grants_extension
    ON extension_permission_grants(extension_id, package_sha256);
