-- Configuration sync v1. Canonical local settings and this outbox commit together.
CREATE TABLE sync_device_identity (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), device_id TEXT NOT NULL,
 display_name TEXT NOT NULL, created_at INTEGER NOT NULL,
 last_physical_ms INTEGER NOT NULL DEFAULT 0, last_logical_counter INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_remote_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL DEFAULT 0,
 active_user_id TEXT, generation INTEGER NOT NULL DEFAULT 0, server_cursor INTEGER NOT NULL DEFAULT 0,
 local_epoch INTEGER NOT NULL DEFAULT 0, applying_remote INTEGER NOT NULL DEFAULT 0,
 clock_offset_ms INTEGER NOT NULL DEFAULT 0, restoring INTEGER NOT NULL DEFAULT 0,
 last_attempt_at INTEGER,last_success_at INTEGER,last_error TEXT,updated_at INTEGER NOT NULL
);
INSERT INTO sync_remote_state(singleton,updated_at) VALUES(1,0);
CREATE TABLE sync_values (
 record_kind TEXT NOT NULL, record_key TEXT NOT NULL, payload_json TEXT,
 tombstone INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(record_kind,record_key)
);
CREATE TABLE sync_outbox (
 user_id TEXT NOT NULL, generation INTEGER NOT NULL,
 record_kind TEXT NOT NULL, record_key TEXT NOT NULL, payload_json TEXT, tombstone INTEGER NOT NULL,
 revision_physical_ms INTEGER NOT NULL,revision_counter INTEGER NOT NULL,source_device_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,generation,record_kind,record_key)
);
CREATE INDEX sync_outbox_due ON sync_outbox(user_id,generation,next_attempt_at,updated_at);
CREATE TABLE sync_revisions (
 user_id TEXT NOT NULL,generation INTEGER NOT NULL,record_kind TEXT NOT NULL,record_key TEXT NOT NULL,
 revision_physical_ms INTEGER NOT NULL,revision_counter INTEGER NOT NULL,source_device_id TEXT NOT NULL,
 PRIMARY KEY(user_id,generation,record_kind,record_key)
);
CREATE TABLE sync_remote_quarantine (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,generation INTEGER NOT NULL,server_cursor INTEGER,
 record_kind TEXT,record_key TEXT,payload_json TEXT,reason TEXT NOT NULL,quarantined_at INTEGER NOT NULL
);
CREATE TABLE sync_pending_effects (
 record_kind TEXT NOT NULL,record_key TEXT NOT NULL,payload_json TEXT,tombstone INTEGER NOT NULL,
 reason TEXT NOT NULL DEFAULT 'Waiting for package or command',PRIMARY KEY(record_kind,record_key)
);
CREATE TABLE sync_portable_extension_settings (
 package_id TEXT NOT NULL,setting_id TEXT NOT NULL,PRIMARY KEY(package_id,setting_id)
);
CREATE TABLE config_command_shortcuts (
 command_id TEXT PRIMARY KEY, accelerator TEXT NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TRIGGER sync_values_insert AFTER INSERT ON sync_values
WHEN (SELECT enabled=1 AND applying_remote=0 AND active_user_id IS NOT NULL FROM sync_remote_state WHERE singleton=1)
BEGIN
 UPDATE sync_device_identity SET last_logical_counter=CASE WHEN (CAST(strftime('%s','now') AS INTEGER)*1000)+(SELECT clock_offset_ms FROM sync_remote_state)>last_physical_ms THEN 0 ELSE last_logical_counter+1 END,
 last_physical_ms=max(last_physical_ms,(CAST(strftime('%s','now') AS INTEGER)*1000)+(SELECT clock_offset_ms FROM sync_remote_state)) WHERE singleton=1;
 INSERT INTO sync_outbox(user_id,generation,record_kind,record_key,payload_json,tombstone,revision_physical_ms,revision_counter,source_device_id,created_at,updated_at)
 SELECT r.active_user_id,r.generation,NEW.record_kind,NEW.record_key,NEW.payload_json,NEW.tombstone,d.last_physical_ms,d.last_logical_counter,d.device_id,(CAST(strftime('%s','now') AS INTEGER)*1000),(CAST(strftime('%s','now') AS INTEGER)*1000)
 FROM sync_remote_state r,sync_device_identity d WHERE r.singleton=1 AND d.singleton=1
 ON CONFLICT(user_id,generation,record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone,
 revision_physical_ms=excluded.revision_physical_ms,revision_counter=excluded.revision_counter,source_device_id=excluded.source_device_id,attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;

CREATE TRIGGER sync_values_update AFTER UPDATE ON sync_values
WHEN (SELECT enabled=1 AND applying_remote=0 AND active_user_id IS NOT NULL FROM sync_remote_state WHERE singleton=1) AND (NEW.payload_json IS NOT OLD.payload_json OR NEW.tombstone<>OLD.tombstone)
BEGIN
 UPDATE sync_device_identity SET last_logical_counter=CASE WHEN (CAST(strftime('%s','now') AS INTEGER)*1000)+(SELECT clock_offset_ms FROM sync_remote_state)>last_physical_ms THEN 0 ELSE last_logical_counter+1 END,
 last_physical_ms=max(last_physical_ms,(CAST(strftime('%s','now') AS INTEGER)*1000)+(SELECT clock_offset_ms FROM sync_remote_state)) WHERE singleton=1;
 INSERT INTO sync_outbox(user_id,generation,record_kind,record_key,payload_json,tombstone,revision_physical_ms,revision_counter,source_device_id,created_at,updated_at)
 SELECT r.active_user_id,r.generation,NEW.record_kind,NEW.record_key,NEW.payload_json,NEW.tombstone,d.last_physical_ms,d.last_logical_counter,d.device_id,(CAST(strftime('%s','now') AS INTEGER)*1000),(CAST(strftime('%s','now') AS INTEGER)*1000)
 FROM sync_remote_state r,sync_device_identity d WHERE r.singleton=1 AND d.singleton=1
 ON CONFLICT(user_id,generation,record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone,
 revision_physical_ms=excluded.revision_physical_ms,revision_counter=excluded.revision_counter,source_device_id=excluded.source_device_id,attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;

CREATE TRIGGER sync_profile_insert AFTER INSERT ON config_profile_values WHEN NEW.key IN ('ui.theme','ui.language','ui.default_output_format','ui.show_copy_toast','search.syntax_mode','search.enabled_sources','artifacts.ocr.enabled','artifacts.ocr.language') BEGIN
 INSERT INTO sync_values VALUES('profile_setting',NEW.key,NEW.value_json,0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_renderer_insert AFTER INSERT ON config_profile_values WHEN NEW.key='renderer.preferences' BEGIN
 INSERT INTO sync_values SELECT 'renderer_preference','mime:'||key,json_quote(value),0 FROM json_each(NEW.value_json,'$.byMimeType') WHERE true ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=0;
 INSERT INTO sync_values SELECT 'renderer_preference','facet:'||key,json_quote(value),0 FROM json_each(NEW.value_json,'$.byFacetId') WHERE true ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=0;
 INSERT INTO sync_values SELECT 'renderer_preference','capability:'||key,json_quote(value),0 FROM json_each(NEW.value_json,'$.byCapabilityId') WHERE true ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=0;
END;

CREATE TRIGGER sync_extension_insert AFTER INSERT ON extension_installs WHEN NEW.source='registry' BEGIN
 INSERT INTO sync_values VALUES('extension_intent',NEW.package_id,json_object('enabled',json(CASE NEW.enabled WHEN 1 THEN 'true' ELSE 'false' END)),0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_extension_setting_insert AFTER INSERT ON extension_package_settings_v2
WHEN EXISTS(SELECT 1 FROM sync_portable_extension_settings WHERE package_id=NEW.package_id AND setting_id=NEW.setting_id) BEGIN
 INSERT INTO sync_values VALUES('extension_setting',NEW.package_id||'/'||NEW.setting_id,NEW.value_json,0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_command_insert AFTER INSERT ON config_command_shortcuts BEGIN
 INSERT INTO sync_values VALUES('shortcut',NEW.command_id,json_quote(NEW.accelerator),0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_profile_update AFTER UPDATE ON config_profile_values WHEN NEW.key IN ('ui.theme','ui.language','ui.default_output_format','ui.show_copy_toast','search.syntax_mode','search.enabled_sources','artifacts.ocr.enabled','artifacts.ocr.language') BEGIN
 INSERT INTO sync_values VALUES('profile_setting',NEW.key,NEW.value_json,0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_renderer_update AFTER UPDATE ON config_profile_values WHEN NEW.key='renderer.preferences' BEGIN
 UPDATE sync_values SET payload_json=NULL,tombstone=1 WHERE record_kind='renderer_preference' AND record_key NOT IN (SELECT 'mime:'||key FROM json_each(NEW.value_json,'$.byMimeType') UNION ALL SELECT 'facet:'||key FROM json_each(NEW.value_json,'$.byFacetId') UNION ALL SELECT 'capability:'||key FROM json_each(NEW.value_json,'$.byCapabilityId'));
 INSERT INTO sync_values SELECT 'renderer_preference','mime:'||key,json_quote(value),0 FROM json_each(NEW.value_json,'$.byMimeType') WHERE true ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=0;
 INSERT INTO sync_values SELECT 'renderer_preference','facet:'||key,json_quote(value),0 FROM json_each(NEW.value_json,'$.byFacetId') WHERE true ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=0;
 INSERT INTO sync_values SELECT 'renderer_preference','capability:'||key,json_quote(value),0 FROM json_each(NEW.value_json,'$.byCapabilityId') WHERE true ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=0;
END;

CREATE TRIGGER sync_extension_update AFTER UPDATE ON extension_installs WHEN NEW.source='registry' BEGIN
 INSERT INTO sync_values VALUES('extension_intent',NEW.package_id,json_object('enabled',json(CASE NEW.enabled WHEN 1 THEN 'true' ELSE 'false' END)),0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_extension_setting_update AFTER UPDATE ON extension_package_settings_v2
WHEN EXISTS(SELECT 1 FROM sync_portable_extension_settings WHERE package_id=NEW.package_id AND setting_id=NEW.setting_id) BEGIN
 INSERT INTO sync_values VALUES('extension_setting',NEW.package_id||'/'||NEW.setting_id,NEW.value_json,0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_command_update AFTER UPDATE ON config_command_shortcuts BEGIN
 INSERT INTO sync_values VALUES('shortcut',NEW.command_id,json_quote(NEW.accelerator),0)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_profile_delete AFTER DELETE ON config_profile_values WHEN OLD.key IN ('ui.theme','ui.language','ui.default_output_format','ui.show_copy_toast','search.syntax_mode','search.enabled_sources','artifacts.ocr.enabled','artifacts.ocr.language') BEGIN
 INSERT INTO sync_values VALUES('profile_setting',OLD.key,NULL,1)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_renderer_delete AFTER DELETE ON config_profile_values WHEN OLD.key='renderer.preferences' BEGIN
 UPDATE sync_values SET payload_json=NULL,tombstone=1 WHERE record_kind='renderer_preference';
END;

CREATE TRIGGER sync_extension_delete AFTER DELETE ON extension_installs WHEN OLD.source='registry' BEGIN
 INSERT INTO sync_values VALUES('extension_intent',OLD.package_id,NULL,1)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_extension_setting_delete AFTER DELETE ON extension_package_settings_v2
WHEN EXISTS(SELECT 1 FROM sync_portable_extension_settings WHERE package_id=OLD.package_id AND setting_id=OLD.setting_id) BEGIN
 INSERT INTO sync_values VALUES('extension_setting',OLD.package_id||'/'||OLD.setting_id,NULL,1)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

CREATE TRIGGER sync_command_delete AFTER DELETE ON config_command_shortcuts BEGIN
 INSERT INTO sync_values VALUES('shortcut',OLD.command_id,NULL,1)
 ON CONFLICT(record_kind,record_key) DO UPDATE SET payload_json=excluded.payload_json,tombstone=excluded.tombstone;
END;

INSERT INTO sync_values SELECT 'profile_setting',key,value_json,0 FROM config_profile_values WHERE key IN ('ui.theme','ui.language','ui.default_output_format','ui.show_copy_toast','search.syntax_mode','search.enabled_sources','artifacts.ocr.enabled','artifacts.ocr.language');

-- A multi-page first restore is staged before replacing portable local values.
CREATE TABLE sync_bootstrap_records(server_cursor INTEGER PRIMARY KEY,payload_json TEXT NOT NULL);
