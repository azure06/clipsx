# Search Behavior Matrix

This doc describes the current search behavior in ClipsX as of April 30, 2026.

## At a Glance

| Area | Browse | FTS search | Semantic search |
| --- | --- | --- | --- |
| Trigger | Empty query | Non-empty query with semantic toggle off, or semantic unavailable | Non-empty query with semantic toggle on and model ready |
| Primary match source | No text matching; newest clips first | SQLite FTS5 over `content_text` and `note` | Embedding similarity over clip `content_text` only |
| Result order | `updated_at DESC` | FTS rank, then `updated_at DESC` | Similarity score DESC |
| Type filters like `/image` | No | Yes | Yes |
| Favorites tab scope | Yes | Yes | Yes |
| Pinned tab scope | Yes | Yes | Yes |
| Active tag filter | Yes | Yes | Yes |
| Notes searchable | N/A | Yes | No |
| Tag names searchable as text | No | No | No |

## What Each Mode Actually Does

### Browse

- Browse mode is active when the search box is empty.
- Results come from `get_recent_clips_paginated`.
- The list is chronological, newest first.
- Active tab filters still apply:
  - `All` shows all clips.
  - `Favorites` only shows favorited clips.
  - `Pinned` only shows pinned clips.
- Active tag filter still applies in every browse tab.

### FTS Search

- FTS mode runs when the query is non-empty and semantic search is off, unavailable, or not ready.
- Backend uses SQLite FTS5 on:
  - `content_text`
  - `note`
- Type slash filters such as `/image`, `/url`, `/text`, `/office`, `/file`, `/files`, and `/code` are parsed before the query is sent.
- Scope slash commands `/all`, `/favorites`, and `/pinned` switch tabs and are not treated as search text.
- Favorites, pinned, and active tag filters are still applied after the text match.

### Semantic Search

- Semantic mode runs only when:
  - the query is non-empty,
  - semantic toggle is on,
  - and the semantic runtime is ready.
- Backend embeds the typed query and compares it against stored clip embeddings.
- Embeddings are generated from clip `content_text` only.
- Notes are not part of the semantic index.
- Tag names are not part of the semantic index.
- Type filters, favorites/pinned scope, and the active tag filter all constrain the candidate set before similarity ranking.
- If semantic mode is requested but the runtime is not ready, the backend falls back to FTS behavior.

## Notes, Tags, and Filters

| Input | Browse | FTS | Semantic |
| --- | --- | --- | --- |
| Clip body text | Not searched | Searched | Searched semantically |
| Clip note | Not searched | Searched | Not searched |
| Tag name | Filter only | Filter only, not text-searched | Filter only, not meaning-searched |
| Type slash filter | Not applicable | Narrows result set | Narrows result set |

## Examples

### Note search

- Clip A:
  - `content_text = "deploy checklist"`
  - `note = "talk to finance before Friday"`
- Query `finance`
  - FTS: matches Clip A because notes are indexed.
  - Semantic: does not match based on the note alone.

### Tag behavior

- Clip B has tag `urgent`.
- Query `urgent`
  - FTS: does not match only because of the tag name.
  - Semantic: does not match only because of the tag name.
- If the `urgent` tag is selected in the UI, both FTS and semantic search are restricted to clips carrying that tag.

### Semantic on/off

- Clip C:
  - `content_text = "quarterly revenue spreadsheet"`
  - `note = "numbers approved by legal"`
- Query `legal`
  - FTS with semantic off: can match Clip C via the note.
  - Semantic with semantic on: usually will not match via the note because only clip text is embedded.
- Query `spreadsheet`
  - FTS: matches by text.
  - Semantic: also participates because the clip text is embedded.

### Favorites, pinned, and tag scope

- In `Favorites`, search only returns favorited clips.
- In `Pinned`, search only returns pinned clips.
- With an active tag filter, both browse and search only return clips that carry that tag.
- These scopes combine. Example:
  - active tab = `Favorites`
  - active tag = `work`
  - query = `invoice`
  - result set = only favorited clips tagged `work` that also match `invoice` in the active search mode.

## Non-Goals In Current Behavior

- Semantic search does not index notes.
- Semantic search does not index tag names.
- Tag names are not searched as free text in FTS.
- Slash scope commands are navigation shortcuts, not text filters.
