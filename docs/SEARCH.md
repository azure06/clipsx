# Search

## Overview

ClipsX M4 uses SQLite FTS5 for full-text keyword search. Semantic (vector) search is
disabled in M4 and will be introduced in a later milestone with the Ollama provider.

## Pipeline

```text
clip captured
  ↓ produce_for_clip  (artifacts.rs)
    ↓ make_thumbnail  → artifact_binary_files (PNG, max 512px)
    ↓ platform_ocr    → artifact_text_values  (macOS Vision / Windows OCR / Tesseract)
  ↓ upsert_projection (search.rs)
    ↓ build_search_text: note + plain-text reps + OCR text
    ↓ INSERT/UPDATE search_documents  (projection_version = 1)
    ↓ FTS triggers sync search_documents_fts automatically
```

On startup, `rebuild_stale_projections` rebuilds any document whose
`projection_version` does not match the current constant (1).

## Search Document Sources

Priority order:

1. Clip note (user annotation)
2. Text representations with MIME `text/plain`, `text/html`, `text/rtf`, or
   `application/rtf`, ordered by `capture_priority ASC, ordinal ASC`
3. OCR text from `artifact_text_values` (if a ready OCR artifact exists)

## Syntax Modes

The profile setting `search.syntax_mode` controls how user input is translated
into FTS5 queries.

| Mode | Behaviour |
|------|-----------|
| `simple` | Each whitespace-delimited token is quoted and AND-joined: `hello world` → `"hello" "world"` |
| `advanced` | Input is passed to FTS5 verbatim. Supports `AND`, `OR`, `NOT`, phrase quotes, column filters, and prefix `*`. |

The active mode is shown as a toggle button ("Simple" / "Advanced") next to the
search field. Clicking it updates the setting immediately.

## Keyboard

| Key | Action |
|-----|--------|
| `⌘F` / `Ctrl+F` | Focus the search input |
| `Escape` (in search input) | Clear query and return to browse mode |

## OCR Platform Support

| Platform | Engine | Notes |
|----------|--------|-------|
| macOS | `VNRecognizeTextRequest` (Vision) | accuracy level 1; language-agnostic |
| Windows | `Windows.Media.Ocr.OcrEngine` | `en-US` language by default |
| Linux | `tesseract` CLI | reports `unsupported` if tesseract is not installed |

OCR is attempted for every raster-image representation (`image/*` MIME or
`PNG`/`JPEG`/`BMP`/`GIF`/`TIFF` format keys). Results are stored as
`artifact_records` with `artifact_kind = 'ocr'` and
`producer_id = 'builtin.artifact.ocr'`.

## Thumbnails

A stripped PNG thumbnail (max 512-pixel edge, Lanczos3) is generated for every
raster-image representation and stored as
`artifact_kind = 'thumbnail'` / `producer_id = 'builtin.artifact.thumbnail'`.

Thumbnails are served via the `clipsx-artifact://` URI scheme and referenced by
`RenderModel::Image { artifact_id }` where `artifact_id` is the
`artifact_binary_files.id` row.

## Tauri Commands

| Command | Description |
|---------|-------------|
| `search_clips(request)` | Returns `SearchPage` (items + total). Empty query returns empty page. |
| `get_search_settings()` | Returns current `SearchSettings`. |
| `update_search_settings(settings)` | Persists `syntaxMode` to `config_profile_values`. |

## Data Model (M4 additions)

```sql
-- artifact_records: new columns
input_manifest_sha256 TEXT  -- sha256 of ordered "rep_id:input_sha256" manifest

-- artifact_jobs: new columns
producer_id       TEXT
producer_version  TEXT
parameter_sha256  TEXT
produced_artifact_id TEXT REFERENCES artifact_records(id)

-- Unique constraint: one active job per producer/kind/representation
UNIQUE INDEX idx_artifact_jobs_one_active
  ON artifact_jobs(artifact_kind, target_representation_id, producer_id)
  WHERE status IN ('pending','running')

-- config_profile_values
search.syntax_mode = '"simple"'  -- or '"advanced"'
```

## Embedding Providers (M4 Status)

`DisabledTextEmbeddingProvider` is the only registered provider in M4.
It produces no vectors and schedules no embedding jobs. FTS is fully functional
without embeddings. Ollama-backed providers are planned for M4a.
