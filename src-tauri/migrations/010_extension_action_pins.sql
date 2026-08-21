-- Host-owned placement preferences are local profile state, not package state.
CREATE TABLE extension_action_pins (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    action_id TEXT NOT NULL UNIQUE,
    pinned_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, action_id)
);

