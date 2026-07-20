# Search Feature

## Responsibilities

- Search input, semantic-search status, and type/filter controls in `SearchBar.tsx`.
- Query state, pagination, and result merging in `src/stores/clipboardStore.ts`.
- Backend retrieval through the `search_objects_paginated` Tauri command and Rust `SearchService`.

## Retrieval model

- Empty queries browse recent clips.
- Keyword queries use SQLite FTS5 projections.
- When Text Search is enabled and ready, results use hybrid FTS and text-vector ranking.
- Image vectors participate only when Image Search is installed and enabled.
- Browse, keyword, and vector retrieval use the same favorites, pinned, tag, and type filters.
