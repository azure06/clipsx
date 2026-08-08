# ADR 0001: local representation storage

Status: Accepted

ClipsX v2 stores the clip catalog and relationships in SQLite. Text is stored in
representation child rows; binary clipboard bytes live in immutable managed
files and SQLite stores only their hash, size, lifecycle state, and relative
path. The v1 schema is not migrated or supported.
