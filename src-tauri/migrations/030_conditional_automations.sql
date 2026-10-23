CREATE TABLE extension_automation_rules_next (
    package_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    activation_id TEXT NOT NULL,
    app_platform TEXT CHECK (app_platform IS NULL OR app_platform IN ('windows', 'macos', 'linux_x11')),
    app_id TEXT CHECK (app_id IS NULL OR length(app_id) BETWEEN 1 AND 256),
    app_display_name TEXT CHECK (app_display_name IS NULL OR length(app_display_name) BETWEEN 1 AND 256),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    setup_kind TEXT NOT NULL DEFAULT 'builtin' CHECK (setup_kind IN ('builtin', 'saved')),
    setup_ref TEXT NOT NULL DEFAULT 'default' CHECK (length(setup_ref) BETWEEN 1 AND 120),
    setup_label TEXT NOT NULL DEFAULT '' CHECK (length(setup_label) <= 120),
    default_view TEXT NOT NULL DEFAULT 'result_only' CHECK (default_view IN ('result_only', 'compare')),
    reason_code TEXT,
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at INTEGER NOT NULL,
    condition_question TEXT CHECK (condition_question IS NULL OR length(condition_question) BETWEEN 1 AND 2048),
    rule_order INTEGER NOT NULL DEFAULT 0 CHECK (rule_order >= 0),
    CHECK ((app_platform IS NULL AND app_id IS NULL AND app_display_name IS NULL) OR (app_platform IS NOT NULL AND app_id IS NOT NULL AND app_display_name IS NOT NULL)),
    PRIMARY KEY (package_id, rule_id)
);
INSERT INTO extension_automation_rules_next(package_id,rule_id,activation_id,app_platform,app_id,app_display_name,enabled,setup_kind,setup_ref,setup_label,default_view,reason_code,parameters_json,revision,updated_at,rule_order)
SELECT package_id,rule_id,activation_id,app_platform,app_id,app_display_name,enabled,setup_kind,setup_ref,setup_label,default_view,reason_code,parameters_json,revision,updated_at,ROW_NUMBER() OVER(PARTITION BY package_id ORDER BY lower(COALESCE(app_display_name,'')),rule_id)-1 FROM extension_automation_rules;
DROP TABLE extension_automation_rules;
ALTER TABLE extension_automation_rules_next RENAME TO extension_automation_rules;
ALTER TABLE extension_activation_events ADD COLUMN candidates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(candidates_json));
ALTER TABLE extension_activation_events ADD COLUMN decision_answers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(decision_answers_json));
ALTER TABLE extension_activation_events ADD COLUMN decision_revision TEXT;
ALTER TABLE extension_activation_events ADD COLUMN evaluation_claim INTEGER NOT NULL DEFAULT 0;
ALTER TABLE extension_activation_events ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE extension_activation_events ADD COLUMN selected_rule_id TEXT;
CREATE TABLE extension_automation_dispatches (
    request_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES extension_jobs(id) ON DELETE CASCADE
);
CREATE INDEX extension_automation_dispatches_job ON extension_automation_dispatches(job_id);
UPDATE system_schema_meta SET schema_version=30;
