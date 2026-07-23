# ClipsX Product Direction

*Last updated: July 23, 2026*

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

## Free and Pro boundary

ClipsX Free is the complete local clipboard product. Clipboard capture, local
history, search, OCR, previews, organization, converters, and optional local AI
models remain available without an account.

Pro starts only at an explicit cloud boundary:

- Copying creates a local clip and never uploads it.
- **Add to Vault** creates an independent encrypted snapshot selected by the user.
- Personal vaults and shared collections use the same end-to-end encrypted
  collection model; a personal vault is a one-member collection.
- Native Office clipboard binaries never upload. Office vault items may contain
  deliberately saved encrypted text and safe previews.
- Hosted AI receives plaintext only for the item and action explicitly selected
  by the user.

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
- Keyboard workflow: configurable global launcher, search focus on open, Arrow Up/Down and Home/End selection, Enter activation, Cmd/Ctrl+1–9 quick activation, and keyboard shortcuts for copy, pin, favorite, delete, and content-specific actions
- In-app updater wiring for release builds

### Remaining before v0.1.0

- **Cross-platform smoke tests:** verify installed release artifacts on macOS, Windows, and Linux, including tray, global shortcut, capture, OCR, search, and updater flows.
- **Release signing and publishing:** provide the updater/signing secrets and complete the platform-specific signing steps in [RELEASE.md](./RELEASE.md).

### Known limitations (not v0.1.0 blockers unless selected below)

- **QR decoding:** the internal decoder deliberately returns no result and is not exposed in the UI.
- **Native file restoration on macOS:** file clips are currently copied back as newline-separated path text rather than native file references.
- **Vector ranking scale:** the current backend reads eligible embedding BLOBs into Rust and ranks them in memory. This is suitable for the initial release; `sqlite-vec` is a later performance evaluation, not a prerequisite.

## Roadmap

### Done

- Clipboard monitoring and multi-format storage
- SQLite history, FTS5, tags, notes, and OCR lifecycle state
- Hybrid search, semantic reindexing, and capability management
- Content-aware previews and actions
- Home/End navigation across the complete paginated history
- Optional Supabase account authentication with credential-vault session storage
- In-app updater wiring for release builds

### 0. Free v0.1 release

- Run release smoke tests across macOS, Windows, and Linux
- Freeze v0.1.0 scope and publish signed release artifacts

### 1. Entitlements and cloud boundary

- Add cached `free` / `pro` entitlement state and hosted-AI allowance metadata
- Keep checkout and subscription management on the website
- Allow ten successful native editable Office restorations for Free users
- Keep Office previews, OCR, search, and fallback restoration unlimited

### 2. Cryptographic identity

- Create a unique key pair for each authorized device
- Add a high-entropy recovery code and encrypted account recovery-key backup
- Support device enrollment, listing, and revocation
- Define a versioned authenticated encrypted-payload format

### 3. Encrypted personal vault

- Add the explicit Add to Vault action and independent encrypted snapshots
- Add per-item keys, collection-key versions, device key envelopes, and recovery envelopes
- Add an offline outbox, tombstones, sync cursors, retries, and conflict copies
- Store only ciphertext and authorization/synchronization metadata in Supabase

### 4. Attachments and recovery

- Encrypt deliberately uploaded images and confirmed file contents
- Enforce server-provided storage limits
- Restore encrypted vault data after device loss
- Exclude native Office binaries from every cloud payload

### 5. Encrypted share links

- Share one encrypted vault item with a caller-selected expiry
- Keep the decryption secret in the URL fragment
- Support revocation and an in-browser website viewer

### 6. Shared collections

- Add owner, editor, and viewer roles
- Share historical collection keys with newly authorized members
- Rotate collection keys immediately when a member is removed
- Use new key versions for future content and optionally rewrap historical item keys

### 7. Hosted AI transformations

- Add explicit translation, rewriting, summarization, and custom actions
- Verify Pro entitlement and allowance on the trusted backend
- Return output as a new local clip; never upload it automatically

### 8. Pro hardening

- Complete cryptography and authorization review
- Exercise account deletion, recovery, member removal, key rotation, conflicts, and partial uploads
- Roll out personal vault, sharing, and team features behind separate release flags

Detailed cryptographic, synchronization, and server boundaries are documented in
[CLOUD_SECURITY.md](./CLOUD_SECURITY.md).

### Deferred QR decoding

QR decoding remains internal infrastructure only. `qr_decoder` and `decode_qr_code` intentionally return no result until the feature is prioritized. Completing it requires a decoder dependency, image preprocessing, an image-preview action, an explicit persistence/search decision, and end-to-end tests. It must not be presented as shipped before then.

### Later

- Evaluate a `sqlite-vec` backend behind `VectorStore` when measured history size or semantic-search latency warrants it
- User scripts or lightweight extensibility hooks
- Plugin system and deeper external integrations
