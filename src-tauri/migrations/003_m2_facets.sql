ALTER TABLE content_detection_jobs ADD COLUMN detector_version TEXT NOT NULL DEFAULT '0';
CREATE INDEX idx_content_detection_jobs_ready ON content_detection_jobs(status, detector_id, detector_version, requested_at);
CREATE INDEX idx_content_clip_facets_source ON content_clip_facets(source_representation_id, facet_id);
INSERT OR IGNORE INTO config_profile_values(key, value_json, updated_at)
VALUES ('renderer.preferences', '{}', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
