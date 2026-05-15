# Search Behavior Matrix

This doc describes the search behavior in ClipsX as of May 2026.

## Scope Model

Candidate set is built in this evaluation order:

1. Start from all clips.
2. Apply tab scope: `All` (no extra filter), `Favorites` (`is_favorite = true`), or `Pinned` (`is_pinned = true`).
3. Apply selected tag filter if present (strict AND).
4. Apply type filters if present (`/image`, `/code`, `/office`, etc.).
5. If parsed text query is empty: return filtered results ordered by `updated_at DESC` (browse / filter-only mode).
6. If parsed text query is non-empty: run FTS or hybrid semantic inside the filtered candidate set.

### Scope Result Matrix

| Tab | Tag selected | Query text | Returned set |
| --- | --- | --- | --- |
| `All` | No | Empty | All clips, newest first |
| `All` | Yes | Empty | Tagged clips only, newest first |
| `Favorites` | No | Empty | Favorite clips only, newest first |
| `Pinned` | No | Empty | Pinned clips only, newest first |
| Any | Any | `/image` only | Scoped clips of type image, newest first |
| Any | Any | Text query | Scoped clips matching active search mode |
| Any | Any | Text + type filter | Scoped clips matching type filter and active search mode |

## Scope UX

- The active tab (`All` / `Favorites` / `Pinned`) is reflected as a removable scope pill in the search bar when a non-`All` scope is active.
- `/favorites` and `/pinned` are available as keyboard slash commands to apply scope; the command is stripped from the input after application.
- `/all` is not offered as a slash command; returning to `All` is done by clicking X on the scope pill or pressing `Backspace` on an empty input when a scope pill is active.
- `Escape` clears search text / current search state.

## Search Modes

### Browse

- Active when the search box is empty.
- Results from `get_recent_clips_paginated`, ordered by `updated_at DESC`.
- Tab scope and tag filter still apply.

### FTS Search

- Active when the search box is non-empty and semantic search is off or unavailable.
- Backend uses SQLite FTS5 on derived `index_text`.
- `index_text` is the retrieval source of truth: best available clip text plus note when present.
- Type slash filters are parsed before the query is sent.
- Tab scope, tag filter, and type filters are applied before text matching.
- If parsing removes all free-text terms, returns a filter-only result set ordered by `updated_at DESC`.

### Hybrid Semantic Search

- Active when the search box is non-empty, semantic toggle is on, and the runtime has a loaded model.
- Execution:
  1. Build scoped candidate set (tab + tag + type filters).
  2. Run semantic ranking (cosine similarity) on candidates with embeddings derived from `index_text`.
  3. Run FTS on the same scoped candidate set using the same parsed text query.
  4. Merge: semantic-ranked hits first (similarity DESC), then FTS-only hits not already returned (FTS order).
  5. Pagination applies to the merged ordered list.
- If a clip's retrieval text changed and its embedding was invalidated, it can still appear through FTS until reindex/manual embedding regenerates the vector.
- If the runtime is not ready, falls back to FTS.

## Notes, Tags, and Filters

| Input | Browse | FTS | Hybrid Semantic |
| --- | --- | --- | --- |
| Clip body text | Not searched | Searched | Searched (semantic block) |
| Clip note | Not searched | Searched | Searched after embedding exists for the latest `index_text`; otherwise may appear via FTS backfill |
| Tag name | Filter only | Filter only, not text-searched | Filter only |
| Type slash filter | Not applicable | Narrows candidate set | Narrows candidate set |

## Retrieval Source Of Truth

- `index_text` is the single retrieval field used by both FTS and semantic embeddings.
- `index_text` is recomputed from canonical clip text plus note.
- Editing a note or promoting OCR updates `index_text` and invalidates the old embedding when the retrieval text changed.
- Reindex/manual embedding regenerates the fresh vector; note edits do not auto-reembed immediately today.

## Tag Behavior

- Tags are structured filters only. Typing `urgent` does not match a clip only because it has the `urgent` tag.
- Selecting the `urgent` tag chip restricts the candidate set to clips carrying that tag.
- Tag filtering combines with tab scope and text search using strict AND.

## Examples

### Note search with semantic on

- Clip A: `content_text = "deploy checklist"`, `note = "talk to finance before Friday"`
- Query `finance` with semantic on:
  - If Clip A has an embedding for the latest `index_text`, semantic can match because the note is part of retrieval text.
  - If the note was edited and the clip has not been re-embedded yet, FTS still matches because `index_text` is updated immediately.
  - Result: Clip A can appear in semantic results or FTS backfill depending on embedding freshness.

### Tag behavior

- Clip B has tag `urgent`.
- Query `urgent` → does not match because of the tag name alone (FTS indexes content and note, not tags).
- Selecting the `urgent` tag chip → restricts results to clips with that tag.

### Filter-only slash query

- Query `/image`:
  - Parser removes `/image` from the text query, passes `filterTypes = ["image"]`.
  - Backend does not run semantic (parsed text is empty).
  - Result: image clips only, ordered by `updated_at DESC`.

### Combined scope + tag + query

- Active tab `Favorites`, active tag `work`, query `invoice`:
  - Returns only favorite clips tagged `work` that match `invoice` in the active search mode.

## Non-Goals

- Tag names are not searched as free text.
- `/all` is not a slash command; scope is cleared with the pill X button or `Backspace`.
