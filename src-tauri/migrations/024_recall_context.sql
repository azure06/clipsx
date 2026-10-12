CREATE TABLE ai_model_observations (
    identity TEXT PRIMARY KEY NOT NULL,
    information_json TEXT NOT NULL,
    observed_at INTEGER NOT NULL
);
CREATE TABLE recall_context_summaries (
    thread_id TEXT NOT NULL REFERENCES recall_threads(id) ON DELETE CASCADE,
    covered_message_id TEXT NOT NULL,
    input_fingerprint TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    PRIMARY KEY(thread_id, covered_message_id, input_fingerprint),
    FOREIGN KEY(thread_id, covered_message_id) REFERENCES recall_messages(thread_id,id) ON DELETE CASCADE
);
UPDATE system_schema_meta SET schema_version = 24;
