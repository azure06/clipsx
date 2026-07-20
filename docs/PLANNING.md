# ClipsX Product Direction

*Last updated: July 20, 2026*

## Current product

ClipsX is a local-first clipboard manager focused on reliable capture, fast retrieval, content-aware previews, and lightweight organization.

The supported architecture is:

```text
React feature UI + Zustand stores
        ↕ Tauri IPC and events
Tauri commands → Rust services → SQLite / FTS5 / vector storage
```

- `ClipboardService` captures clipboard formats and queues background work.
- `ClipRepository` persists clips and maintains FTS projections.
- `IndexingService` and `SearchService` provide asynchronous indexing and hybrid retrieval.
- Text Search uses local BGE-M3 embeddings; Image Search uses downloadable SigLIP2 assets.
- OCR uses platform-native engines: Apple Vision, Windows OCR, and Tesseract on Linux.

## Active capabilities

- **Text Search:** cache-managed local text embeddings. It is installed and enabled independently.
- **Image Search:** checksum-verified visual-model assets, optionally kept in memory.
- **OCR:** automatic for eligible image and office clips. Linux requires the `tesseract` executable; unavailable engines are reported as failed OCR rather than blocking clip capture.

## Search behavior

- Empty queries browse recent clips.
- Keyword queries use SQLite FTS5.
- Semantic mode fuses FTS, text-vector, and available image-vector results through reciprocal-rank fusion.
- The same type, favorites, pinned, and tag filters apply across all retrieval modes.

## Roadmap

### Done

- Clipboard monitoring and multi-format storage
- SQLite history, FTS5, tags, notes, and OCR lifecycle state
- Hybrid search, semantic reindexing, and capability management
- Content-aware previews and actions
- In-app updater wiring for release builds

### Next

- Keyboard-first navigation and quick actions
- Release smoke tests across macOS, Windows, and Linux
- Evaluate a later `sqlite-vec` backend behind `VectorStore`

### Deferred QR decoding

QR decoding remains internal infrastructure only. `qr_decoder` and `decode_qr_code` intentionally return no result until the feature is prioritized. Completing it requires a decoder dependency, image preprocessing, an image-preview action, an explicit persistence/search decision, and end-to-end tests. It must not be presented as shipped before then.

### Later

- User scripts or lightweight extensibility hooks
- Plugin system and deeper external integrations

### Out of scope

- Cloud sync, team features, and generative text transforms
