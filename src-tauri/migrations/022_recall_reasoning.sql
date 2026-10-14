ALTER TABLE recall_threads ADD COLUMN reasoning_json TEXT
    CHECK (reasoning_json IS NULL OR json_valid(reasoning_json));
