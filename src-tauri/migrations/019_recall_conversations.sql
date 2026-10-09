CREATE TABLE recall_threads (
  id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  preset_id TEXT,
  web_enabled INTEGER NOT NULL DEFAULT 0 CHECK(web_enabled IN (0,1)),
  head_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX recall_threads_recent ON recall_threads(archived,updated_at DESC,id);
CREATE TABLE recall_messages (
  thread_id TEXT NOT NULL REFERENCES recall_threads(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  status_json TEXT CHECK(status_json IS NULL OR json_valid(status_json)),
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(thread_id,id),
  FOREIGN KEY(thread_id,parent_id) REFERENCES recall_messages(thread_id,id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX recall_messages_parent ON recall_messages(thread_id,parent_id);
CREATE TABLE recall_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  state TEXT NOT NULL CHECK(state IN ('running','completed','cancelled','error','interrupted')),
  sequence INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY(thread_id,message_id) REFERENCES recall_messages(thread_id,id) ON DELETE CASCADE
);
CREATE TABLE recall_source_snapshots (
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  asset_hash TEXT,
  PRIMARY KEY(thread_id,message_id,id),
  FOREIGN KEY(thread_id,message_id) REFERENCES recall_messages(thread_id,id) ON DELETE CASCADE
);
CREATE INDEX recall_snapshot_assets ON recall_source_snapshots(asset_hash);
UPDATE system_schema_meta SET schema_version=19;
