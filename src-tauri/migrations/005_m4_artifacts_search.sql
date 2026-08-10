-- M4: artifact/job provenance, one-active-job constraint, and search settings.

-- Record what hashes/versions produced each artifact.
ALTER TABLE artifact_records ADD COLUMN input_manifest_sha256 TEXT
    CHECK (input_manifest_sha256 IS NULL OR length(input_manifest_sha256) = 64);

-- Link each completed job to the artifact it produced.
ALTER TABLE artifact_jobs ADD COLUMN producer_id TEXT;
ALTER TABLE artifact_jobs ADD COLUMN producer_version TEXT;
ALTER TABLE artifact_jobs ADD COLUMN parameter_sha256 TEXT
    CHECK (parameter_sha256 IS NULL OR length(parameter_sha256) = 64);
ALTER TABLE artifact_jobs ADD COLUMN produced_artifact_id TEXT
    REFERENCES artifact_records(id) ON DELETE SET NULL;

-- Enforce one active (pending/running) job per producer/kind/input combination.
CREATE UNIQUE INDEX idx_artifact_jobs_one_active
    ON artifact_jobs(artifact_kind, target_representation_id, producer_id)
    WHERE status IN ('pending', 'running');

-- Search profile setting (SimpleSyntax | AdvancedSyntax).
INSERT OR IGNORE INTO config_profile_values(key, value_json, updated_at)
VALUES ('search.syntax_mode', '"simple"', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
