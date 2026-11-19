ALTER TABLE extension_activation_events ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX extension_activation_events_request
    ON extension_activation_events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX extension_activation_events_clip_activity
    ON extension_activation_events(source_clip_id, captured_at DESC, event_id DESC);

-- A deduplicated job remains eligible while any of its matching rules is enabled.
CREATE VIEW extension_jobs_with_enabled_automation AS
SELECT j.id AS job_id
FROM extension_jobs j
JOIN extension_automation_rules r ON r.package_id=j.package_id AND r.rule_id=j.automation_rule_id
WHERE r.enabled=1 AND (r.app_platform IS NULL OR (r.app_platform=j.app_platform AND r.app_id=j.app_id))
UNION ALL
SELECT d.job_id
FROM extension_automation_dispatches d
JOIN extension_activation_events e ON e.request_id=d.request_id
JOIN extension_automation_rules r ON r.package_id=e.package_id AND r.rule_id=e.rule_id
WHERE r.activation_id=e.activation_id AND r.enabled=1
  AND (r.app_platform IS NULL OR (r.app_platform=e.app_platform AND r.app_id=e.app_id));

UPDATE system_schema_meta SET schema_version=33;
