# ClipsX Product Direction

*Last updated: July 22, 2026*

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
- **Optional account sign-in:** browser-based Supabase login, stored through the operating-system credential vault. It does not upload clipboard data, enable sync, or gate local features.

## Search behavior

- Empty queries browse recent clips.
- Keyword queries use SQLite FTS5.
- Semantic mode fuses FTS, text-vector, and available image-vector results through reciprocal-rank fusion.
- The same type, favorites, pinned, and tag filters apply across all retrieval modes.

## Release-readiness inventory

### Implemented

- Clipboard monitoring, multi-format capture, local SQLite history, FTS5, tags, notes, pins, and favorites
- Content-aware previews and actions, including copy and paste routing
- Automatic OCR for eligible image and office clips, with platform-specific engine handling
- Hybrid text and image search, semantic reindexing, and local model capability management
- English and Japanese UI localization
- Keyboard workflow: configurable global launcher, search focus on open, Arrow Up/Down selection, Enter activation, Cmd/Ctrl+1–9 quick activation, and keyboard shortcuts for copy, pin, favorite, delete, and content-specific actions
- In-app updater wiring for release builds

### Remaining before v0.1.0

- **Boundary navigation:** add Home/End-style commands to select the newest/oldest clip. The oldest command must continue loading history until it reaches the actual oldest item, not merely the oldest currently-rendered page.
- **Cross-platform smoke tests:** verify installed release artifacts on macOS, Windows, and Linux, including tray, global shortcut, capture, OCR, search, and updater flows.
- **Release signing and publishing:** provide the updater/signing secrets and complete the platform-specific signing steps in [RELEASE.md](./RELEASE.md).

### Known limitations (not v0.1.0 blockers unless selected below)

- **QR decoding:** the internal decoder deliberately returns no result and is not exposed in the UI.
- **Native file restoration on macOS:** file clips are currently copied back as newline-separated path text rather than native file references.
- **Vector ranking scale:** the current backend reads eligible embedding BLOBs into Rust and ranks them in memory. This is suitable for the initial release; `sqlite-vec` is a later performance evaluation, not a prerequisite.

## Pre-release feature decision

Before feature freeze, select **one** optional feature only if it can be completed with focused tests and does not delay the release-readiness work:

1. **Keyboard history boundaries (recommended):** Home selects the newest clip; End loads and selects the oldest clip. This completes the existing keyboard workflow with low product and technical risk.
2. **QR decoding:** detect QR codes in image previews and offer an explicit copy/open action. This needs a decoder dependency, image preprocessing, UI design, and end-to-end tests.
3. **Native macOS file restoration:** restore captured file clips as true macOS file references. This improves clipboard fidelity but is platform-specific and requires native pasteboard work and macOS testing.

Do not start more than one pre-release feature. Once the selected feature and its tests are complete, freeze functionality and proceed with the release checklist.

## Roadmap

### Done

- Clipboard monitoring and multi-format storage
- SQLite history, FTS5, tags, notes, and OCR lifecycle state
- Hybrid search, semantic reindexing, and capability management
- Content-aware previews and actions
- In-app updater wiring for release builds

### Next

- Choose and complete one pre-release feature from the decision above
- Run release smoke tests across macOS, Windows, and Linux
- Freeze v0.1.0 scope and publish signed release artifacts

### Deferred QR decoding

QR decoding remains internal infrastructure only. `qr_decoder` and `decode_qr_code` intentionally return no result until the feature is prioritized. Completing it requires a decoder dependency, image preprocessing, an image-preview action, an explicit persistence/search decision, and end-to-end tests. It must not be presented as shipped before then.

### Later

- Evaluate a `sqlite-vec` backend behind `VectorStore` when measured history size or semantic-search latency warrants it
- User scripts or lightweight extensibility hooks
- Plugin system and deeper external integrations

### Out of scope

- Cloud sync, team features, and generative text transforms

Optional account login is already available for future account-backed features; its setup and security boundary are documented in [SUPABASE_AUTH.md](./SUPABASE_AUTH.md).
