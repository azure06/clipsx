# ClipsX Architecture
This is the newcomer-friendly, stable architecture reference for ClipsX. It combines the primer, runtime architecture, data model, extension boundary, and search behavior; [ROADMAP.md](ROADMAP.md) separately tracks unfinished milestones and acceptance criteria.
## Start here: ClipsX in plain English

ClipsX is a local-first programmable clipboard: `Capture -> Understand -> Render / Transform -> Copy or Paste`. A clip is one coherent clipboard snapshot, not one content type. It can preserve several raw **representations**—for example plain text, HTML, PNG, and an exact Office format—and later gain semantic **facets** such as JSON or timestamp meaning.

This document defines stable boundaries, not delivery status. See
[ROADMAP.md](ROADMAP.md) for unfinished work and acceptance criteria, and
[RELEASE.md](RELEASE.md) for native desktop evidence and publication gates.

## Read in this order

These documents separate stable behavior from delivery planning. Begin here, then follow the question you have; each pillar links to related material instead of duplicating it.

| Question | Read |
| --- | --- |
| Runtime, capture, output, invariants | [runtime architecture](#runtime-architecture-capture-and-output) |
| Canonical data, derived data, persistence | [data model](#data-model-preserve-first-derive-later) |
| Built-ins and community extensions | [extensions](#extensions-contributions-without-privilege) |
| FTS, embeddings, providers, limitations | [search](#search-mandatory-fts-plus-optional-candidate-sources) |
| Unfinished milestones and acceptance criteria | [ROADMAP.md](ROADMAP.md) |

## Four pillars

Architecture gives React and Rust distinct responsibilities. The data model preserves raw inputs and makes indexes rebuildable; extensions add understanding and views without privilege; search reads derived projections. The roadmap tracks the remaining product work on top of those boundaries.

## Glossary

| Term | Meaning |
| --- | --- |
| **Clip** | One coherent clipboard ownership state (`clip_item`); it has no global content type. |
| **Representation** | One independent raw form of a clip, such as `text/plain`, HTML, PNG, Office/OLE, or file list. |
| **Facet** | Additive meaning from a representation, such as `data.json`, `value.number`, or `time.timestamp`; it never replaces raw data. |
| **Artifact** | Versioned reusable derived text/binary output, such as OCR or thumbnail, with provenance. |
| **Projection** | A deterministic rebuildable document assembled for FTS. |
| **Provider** | Trusted host-owned embedding, generation, or OCR integration; never a community extension. |
| **Embedding** | Fixed-size semantic-search vector in one compatible embedding space. |
| **Embedding space** | Immutable provider/model/modality/dimensions/normalization/metric identity. |
| **Extension** | Detector, renderer, transformer, or action contribution; built-ins are trusted Rust and community packages are host-governed WASM components. |
| **Renderer** | Contribution returning a structured model rendered by ClipsX-owned React UI. |
| **Transformer** | Contribution that produces representations from source data and validated parameters. |
| **Action** | Explicit contextual command returning only host-audited output, URL, or notification effects. |
| **Canonical / derived / ephemeral** | Preserved capture or durable user data / rebuildable output / session or in-memory state. |

## Rules to keep in mind

- Raw representations are canonical; facets, artifacts, search documents, chunks, embeddings, and compact presentation caches are derived; detail render models/previews are ephemeral unless a transformation is explicitly saved as a new clip.
- Binary payloads live in managed app files. SQLite contains metadata/validated relative paths, never generic payload BLOBs or JSON metadata.
- Platform adapters alone interpret native clipboard types; never guess UTI, OLE, or equivalent identifiers. Renderer selection is UI policy, not clip state.
- Use the fresh domain-prefixed schema and reset flow. Do not add v1 migrations, compatibility reads/writes, or dual schemas.

[platform-format-matrix.json](platform-format-matrix.json) is the bundled, executable capture and reconstruction policy. It is validated against [its JSON Schema](platform-format-matrix.schema.json) and Rust semantic rules before startup proceeds. The read-only `archive/v1-pre-m0` branch/tag can inform visual behavior, keyboard interaction, accessibility, and platform discovery, but never V2 schema, IPC, semantic models, sparse metadata, or compatibility behavior; see the [legacy reference policy](ROADMAP.md#legacy-v1-reference).

## Native capability policy

The matrix owns stable capability IDs and families, exact or explicitly bounded selectors, settings gates, codec names, storage contracts, MIME and renderer hints, capture/write priorities, error policy, and bundle membership for Windows, macOS, and X11. The document is app-owned and read-only at runtime. Existing user settings may disable a declared family, but cannot introduce a native format or codec.

The JSON is declarative policy; compiled, audited Rust codecs remain the only code allowed to read or write native clipboard data. Startup rejects unknown codecs, conflicting selectors, unsupported write-back combinations, and structurally invalid policy. Capture resolves a native advertisement through the matrix before reading bytes. Unknown, disabled, redundant, diagnostic-only, unreadable, and oversized formats are retained only as bounded observations, never as payload bytes.

Windows PNG, `CF_DIBV5`, and `CF_DIB` normalize to canonical PNG while retaining the observed capability and native identity. The Windows Office bundle accepts only declared Word, Excel, and PowerPoint candidates. Versioned PowerPoint matching and write-back require the `Slides Package` suffix; small `Internal Slides`, `Internal Theme`, and `Internal Color Scheme` advertisements are diagnostic metadata and cannot become the editable primary or reconstruction targets. The primary native representation is selected by matrix rank, then readable payload size; reconstruction writes that exact registered format first and follows with matrix-ordered useful alternatives. Private/control formats such as `DataObject*`, `Ole Private Data`, `AsyncFlag`, shell offsets, and drop-effect metadata are diagnostic-only. `FileName` and `FileNameW` are redundant when `CF_HDROP` is present. Generic OLE is not guessed.

macOS encodes the proven Microsoft package and `com.microsoft.ole.source.*` signal bundle explicitly. X11 uses the same resolver but does not claim editable Office support. Virtual-file descriptors, indexed contents, and Shell namespace payloads remain diagnostic-only until paired capture and reconstruction codecs are implemented together.


---

## Runtime architecture, capture, and output

ClipsX is one Rust desktop process plus one React webview. React owns interaction and rendering; Rust owns canonical data, all clipboard reads and writes, persistence, search, and provider calls. [ROADMAP.md](ROADMAP.md) tracks delivery and [data model](#data-model-preserve-first-derive-later) owns persistence detail.

## Runtime layers

This shows the route from the webview to privileged systems. The extension host and registry backend exist; the dashed hosted-provider path is deferred.

```mermaid
flowchart TB
  subgraph Webview["Webview: React and TypeScript"]
    UI["History, search, inspector, transforms, settings"]
  end
  subgraph Boundary["Tauri boundary"]
    Commands["invoke commands"]
    Events["backend events"]
    Protocols["clipsx-asset and clipsx-artifact protocols"]
  end
  subgraph Rust["Desktop process: Rust"]
    IPC["ipc: command handlers and current orchestration"]
    Services["history, contributions, artifacts, search, output"]
    Providers["host-owned provider contracts and adapters"]
    ExtensionHost["Host-governed WASM extension host"]
    Repository["HistoryRepository and SQLx"]
    Clipboard["ClipboardAdapter and platform implementations"]
  end
  UI --> Commands --> IPC --> Services
  Services --> Events --> UI
  UI --> Protocols --> Services
  Services --> Repository
  Services --> Clipboard
  Services --> Providers
  ExtensionHost -. "detector, renderer, transformer, action contributions" .-> Services
  Repository --> SQLite[(SQLite)]
  Repository --> Managed["Managed immutable files"]
  Clipboard <--> OS["OS clipboard and paste APIs"]
  Providers --> Ollama["Optional local Ollama"]
  Providers -. "explicit future consent" .-> Hosted["Future hosted providers"]
  Registry["Reviewed checksum-pinned registry"] --> ExtensionHost
```

React uses typed Tauri commands, invalidation events, and app-owned binary URI protocols. Events such as `clip-captured`, `clip-updated`, and `clip-facets-updated` are not replicated state: `HistoryPage` queries current data again. Tokio tasks poll clipboard and run derived work in-process, moving blocking detector/OCR tasks where needed. `StartupState` always owns roots and schema status so an incompatible database can reach the explicit reset UI; `HostState` owns process-level tray/updater handles; `AppState` exists only for a ready schema and owns the repository and in-memory `TransformService`.

The desktop composition root registers single-instance, deep-link, tray, autostart, updater, filesystem-dialog, global-shortcut, and platform window-chrome adapters. These are thin host boundaries: they show/hide/focus the webview and emit validated events, but never own clipboard representations or canonical data. A source-level contract test rejects frontend `invoke` command names that are absent from the Rust handler list and rejects browser clipboard writes or retired output commands.

## Clipboard ingestion

This shows what happens after a clipboard change. The system never exposes an incomplete capture, and derived failure never invalidates raw data.

```mermaid
sequenceDiagram
  participant OS as OS clipboard
  participant Monitor as Polling task in ipc
  participant Adapter as ClipboardAdapter
  participant Repo as HistoryRepository
  participant FS as Managed files
  participant DB as SQLite
  participant Work as Derived-work tasks
  participant UI as React HistoryPage
  loop every 350 ms
    Monitor->>Adapter: snapshot_token()
    Adapter->>OS: read platform change token
  end
  Monitor->>Adapter: capture_coherent()
  Adapter->>OS: token A, enumerate and read formats, token B
  alt token changed or a required format failed
    Adapter-->>Monitor: reject after bounded retries
    Monitor-->>UI: capture-rejected event
  else coherent snapshot
    Adapter-->>Monitor: immutable representations, observations, and source app
    Monitor->>Repo: capture(snapshot, limits)
    Repo->>Repo: fingerprint and duplicate check
    alt duplicate ready capture
      Repo->>DB: refresh timestamps, source app, and observations
      Monitor-->>UI: clip-updated event
    else new capture
      Repo->>DB: begin transaction and insert pending clip
      loop each representation
        alt binary asset
          Repo->>FS: stage, hash, fsync, atomic rename
        end
        Repo->>DB: insert representation and typed storage row
      end
      Repo->>DB: mark clip ready and commit
      Monitor-->>UI: clip-captured event
    end
    Monitor-)Work: spawn detection and derived work
    Work->>DB: facets and detection jobs
    Work->>DB: artifacts, search projection, embedding jobs/vectors
    Work-->>UI: clip-facets-updated event
    UI->>Repo: list_clips through Tauri command
    Repo-->>UI: current ready clips
  end
```

The adapter compares token A/B, rejects changed or required-format-failed reads after bounded retries, and returns immutable representations plus source app. Repository deduplicates ready captures or writes pending canonical rows, staging/hashing/fsyncing/atomically renaming binary bytes while the transaction is open, then marks ready and commits. Startup reconciles missing/pending/staged/unreferenced files; manual `capture_clipboard` uses the same adapter/repository and ordering. Self-writes are suppressed once by their short-lived platform change token before readback, with a representation-fingerprint check retained as fallback; this prevents OS-generated clipboard wrappers from creating history entries.

## Ownership and dependencies

This reference table maps responsibilities to code. The two listed coupling points are intentional current limits, not hidden architecture.

| Responsibility | Current code | What it owns |
| --- | --- | --- |
| Composition/state | `app/`, `main.rs` | Thin composition root and `AppState`. |
| Tauri adapter/orchestration | `ipc/mod.rs` | Commands, events, protocols, startup, polling, sequencing. |
| Canonical capture/catalog | `clipboard/`, `history/domain.rs`, `history/repository.rs` | Reads/writes, snapshots, representations, retention, reconstruction, tags, notes, recovery. |
| Understand/render | `contributions/host.rs`, `detector/`, `renderer/` | Built-in registry, bounded jobs, facets, resolver, `RenderModel`. |
| Transform | `contributions/transformer/mod.rs` | Registry, parameters, expiring cache, output, preferences, provenance. |
| Artifacts/search/providers/output/foundation | `artifacts/`; `search/`; `providers/`; `output/paste.rs`; `foundation/`, `migrations/` | Derived output; FTS/Ollama/fusion; contracts/adapters; reconstruction/paste; roots/schema/reset/files/credentials. |
| Wire contracts | `contracts.rs`, `src/shared/types/` | Serializable Tauri shapes. |

Intended flow is `React -> Tauri adapter -> domain capability -> storage/platform/provider boundary`. Domain modules do not import Tauri; canonical history does not depend on derived subsystems; only adapters interpret native identifiers; providers receive no arbitrary history/SQLite/clipboard/files. Two deliberate couplings remain: domain services accept concrete `HistoryRepository` and use its public pool, so persistence is not replaceable; `ipc/mod.rs` coordinates capture through indexing, rather than a separate application-service layer.

## Rendering, transformation, and output

Renderer choice is computed from ready representations, facets, installed contributions, and global preferences—never stored as canonical clip state. Saved overrides apply facet, then capability, then MIME scope. Otherwise image, file, document, and Office clips prefer faithful views; text-centric clips prefer structured, semantic, faithful, source, then diagnostic views. Within a purpose, matcher specificity, capture priority, native ordinal, and stable contribution ID decide order. This lets a valid JSON facet outrank an application-added HTML alternative while rich HTML leads when no more-specific meaning exists. Active detail renderer remains UI session state.

`TransformService` runs a built-in transformer from one representation plus validated parameters, caches exact outputs/preview under a short-lived result ID, and reuses exactly those bytes for preview/copy/paste/save. Save makes a new clip with `clip_transform_provenance`; it never overwrites source. The Rust output boundary is the exclusive clipboard-write owner: one typed command resolves original, plain-text, transformed, or literal renderer text; writes through the platform adapter; registers self-write suppression; touches an existing source clip when supplied; and optionally pastes. Literal renderer values never create or mutate canonical representations. Original output reconstructs every explicitly supported capture, plain output selects supported text, and transformed output uses cached result representations.

Immediately before ClipsX is shown, the host remembers the currently focused external application as a one-shot paste target. Paste writes first, consumes that target, hides ClipsX, restores and verifies the target when possible, then injects the platform paste shortcut; if no remembered target is valid, the platform adapter uses the window naturally refocused after hiding and never deliberately targets ClipsX. Clipboard content remains available if focus restoration or key injection fails.

Window behavior is native and Rust-owned. Effective `hide_on_blur` and `always_on_top` settings are cached in host state and applied at startup and settings updates. A real focus loss schedules a guarded hide, while native move/resize events invalidate pending hides and establish a short interaction guard; refocus, disabled hide-on-blur, and always-on-top also cancel or prevent the hide. Close-to-tray remains separate and unchanged.

### UI parity and interaction contract

The desktop UI is a product boundary, not a diagnostic surface for backend
capabilities. The history workspace automatically renders the resolver's first
view for a selected clip, exposes alternate representation and facet views as
tabs, and keeps raw representations in an advanced inspector. Selecting a
renderer never changes clipboard output.

Normal copy and paste reconstruct the original supported representation set.
Primary-action preferences may select original or plain-text output, but active
renderer selection may not. Transformations are explicit utilities that produce
different bytes; preview, copy, paste, and save of a transform reuse the same
result. Parsed meaning is rebuildable, versioned facet or artifact data, never
canonical clip metadata.

The archived v1 shell, keyboard behavior, previews, actions, settings, and
desktop integrations are parity references. Reintroduce them through v2
contracts, never through `ClipItem`, legacy IPC shapes, or the legacy schema.

The frontend list uses lightweight `ClipSummary` rows. Selecting an item builds
an ephemeral `ClipPresentation` from `ClipDetail`, `ClipViewSet`, and the chosen
`RenderModel`; it does not persist a UI-selected content type. A summary may
include one bounded cached compact presentation with a host icon, RGBA swatch,
managed input thumbnail, monogram, title, subtitle, badge, and accessibility
label. Compact models are versioned derived data computed after capture or
redetection; scrolling never invokes WASM or network activity. Invalid or absent
models use the core summary/icon fallback. This avoids loading every
representation for history rows and keeps renderer policy outside canonical
storage.

`ClipViewSet.primaryViewId` is the authoritative default. Each view declares a
stable `presentationKind` and `placement` (`primary`, `alternate`, or
`advanced`); React never infers behavior from a translated label. Resolver
preferences apply only when the requested renderer is actually available.
Otherwise candidates follow purpose and specificity policy, then the platform
adapter's capture priority, representation ordinal, and stable ID. Extensions
cannot buy primary placement with numeric priority. MIME/native identity always
remains adapter-owned.

A Source view is a useful human-readable alternate for formats such as HTML or
RTF. The complete representation inventory is a separate advanced inspector;
binary payloads and Base64 are never ordinary view tabs. One exhaustive React
dispatcher consumes the bounded `RenderModel` union directly. Tables, trees,
key/value data, semantic payloads, and file references remain structured;
semantic previews validate their payload before specialization and fall back to
generic details when malformed. A failed renderer falls back to the canonical
representation without affecting output policy.

Image presentation references a canonical managed `assetId` and carries a
discriminated OCR state: disabled, pending, running, ready (including empty
text), unsupported, or failed with a safe diagnostic. Artifact completion and
retry emit `clip-artifacts-updated` with clip and source IDs so the active model
can refresh without reloading canonical clip data. File presentation preserves
ordered path/name references only; it does not stat external files or invent
size or timestamp metadata.

The `clipsx-asset` protocol serves canonical image bytes with their declared
MIME type. Wry exposes it as `http://clipsx-asset.localhost/` on Windows and as
`clipsx-asset://localhost/` on macOS/Linux, so frontend URL construction is
platform-aware. A failed request renders an explicit preview error rather than
a silent broken-image element.

HTML is sanitized in the host and displayed in a sandboxed iframe. RTF input is
bounded to 1 MiB, rejects binary/object/field/image control groups, and is
parsed behind a failure boundary; its
derived HTML contains escaped text and only `p`, `br`, `strong`, `em`, `u`,
`s`, `sup`, and `sub`, otherwise falling back to escaped extracted/source text.
For Office/native snapshots, a valid user preference wins first, followed by
useful table/HTML, PDF/SVG/image, plain-text, and opaque Office detail classes,
while capture priority is retained within each class and every representation
remains available as an alternate and to Original output.

Search documents are derived from canonical textual representations, safe
extractions/artifacts, notes, and tag names. A note or tag mutation refreshes
the document and queues re-embedding when a text provider is configured.

## Invariants and code map

Canonical capture commits before detector/artifact/index work; derived data may be cleared/rebuilt. FTS works with providers disabled; hosted calls require explicit consent; secrets stay in OS secure storage and never logs/SQLite. Community code runs only as host-governed WASM components with no ambient imports; trusted provider adapters receive explicit immutable inputs.

| Concept | Start here |
| --- | --- |
| Startup, IPC | `src-tauri/src/main.rs`, `app/`, `ipc/mod.rs` |
| Clipboard/output | `clipboard/`, `output/`, `docs/platform-format-matrix.json`, `docs/platform-format-matrix.schema.json` |
| Data | `history/`, `migrations/`, `foundation/` |
| Contributions | `contributions/`, `features/transforms/` |
| Artifacts/search/providers | `artifacts/`, `search/`, `providers/` |
| UI | `src/features/app/AppLayout.tsx`, `features/clipboard/ClipboardHistory.tsx`, `features/clipboard/V2ViewPanel.tsx`, `features/clipboard/RenderModelView.tsx`, `shared/types/v2.ts` |

## Capture participant reference

This table expands the ingestion diagram into concrete ownership. It is useful when tracing a capture problem from a visible event back to platform data.

| Component | Purpose |
| --- | --- |
| OS clipboard | The operating system's clipboard, which owns native formats and its change token. |
| Polling task in `ipc` | Watches for clipboard changes, coordinates capture, and emits UI invalidation events. |
| `ClipboardAdapter` | Resolves advertised formats through the executable matrix, records bounded observations, and converts supported formats into immutable representations with compiled codecs. |
| `HistoryRepository` | Owns canonical capture: deduplication, transactional metadata writes, representation records, and ready-state transitions. |
| Managed files | Application-owned, content-addressed files that hold binary representation bytes outside SQLite. |
| SQLite | Stores clip metadata, representation rows, typed storage records, facets, jobs, and other durable relational state. |
| Derived-work tasks | Background work that creates non-canonical facets, artifacts, search projections, and optional embeddings. |
| React `HistoryPage` | Receives invalidation events and re-queries the current ready clips for display. |

## Detailed backend reference

This is the complete backend-responsibility lookup table. The shorter ownership discussion above explains dependency direction; use this table to locate the actual code owner.

| Responsibility | Current code | What it owns |
| --- | --- | --- |
| Composition and state | `src-tauri/src/app/`, `main.rs` | Starts Tauri and owns `AppState`. The composition root is intentionally thin. |
| Tauri adapter and orchestration | `src-tauri/src/ipc/mod.rs` | Commands, events, custom asset protocols, startup work, polling, and sequencing across services. |
| Canonical capture and catalog | `clipboard/`, `history/domain.rs`, `history/repository.rs` | Platform reads/writes, coherent snapshots, typed representations, retention, reconstruction, tags, notes, and managed-file recovery. |
| Understand and render | `contributions/host.rs`, `contributions/detector/`, `contributions/renderer/` | Built-in detector registry, bounded detection jobs, additive facets, renderer resolution, and structured `RenderModel` output. |
| Transform | `contributions/transformer/mod.rs` | Built-in transformer registry, parameters, expiring result cache, preview, output bytes, preferences, and save provenance. |
| Derived artifacts | `artifacts/` | Thumbnail and native OCR producers, jobs, provenance, and artifact retrieval. |
| Search | `search/mod.rs`, `search/semantic/mod.rs` | Search projections, FTS query construction, filters, Ollama indexing, cosine scoring, and fusion. |
| Provider boundary | `providers/contracts/`, `providers/registry.rs`, `providers/ollama/` | Capability contracts and host-owned adapters. The current semantic path still has its operational Ollama provider in `search/semantic`. |
| Output | `output/mod.rs`, `output/paste.rs`, clipboard writer | Unified original/plain/transformed/literal output, self-write suppression, remembered focus restoration, and synthetic paste. |
| Storage foundation | `foundation/mod.rs`, `migrations/` | App roots, fresh-schema validation/reset, migrations, managed-file primitives, and credential cleanup. |
| Shared wire/domain contracts | `contracts.rs`, `src/shared/types/` | Serializable shapes used across the Tauri boundary. |


---

## Data model: preserve first, derive later

The data model separates original clipboard data from everything ClipsX computes later. A clip is one coherent ownership state with many raw representations and additive facets; raw representations are canonical, while facets, artifacts, search documents, chunks, and embeddings are rebuildable.

This file is the stable persistence reference. [ROADMAP.md](ROADMAP.md) holds build scope and acceptance criteria.

## Entity relationships

This ERD shows the important persisted records. Canonical clip records are separate from derived work, user catalog data, and extension package/runtime state.

```mermaid
erDiagram
  clip_items ||--|{ clip_representations : owns
  clip_representations ||--o| clip_text_values : stores_text_as
  clip_representations ||--o{ clip_file_list_entries : stores_references_as
  clip_binary_files ||--o{ clip_representations : backs_binary

  clip_items ||--o{ content_clip_facets : has_derived
  clip_representations ||--o{ content_clip_facets : source_of
  clip_representations ||--o{ content_detection_jobs : schedules
  content_facet_definitions ||--o{ content_clip_facets : defines

  clip_items ||--o{ catalog_clip_tags : tagged_by
  catalog_tags ||--o{ catalog_clip_tags : groups
  clip_items ||--o| clip_transform_provenance : produced_clip
  clip_items ||--o{ clip_transform_provenance : source_clip

  artifact_records ||--|{ artifact_inputs : declares
  clip_representations ||--o{ artifact_inputs : raw_input
  artifact_records ||--o{ artifact_inputs : derived_input
  artifact_records ||--o| artifact_text_values : text_output
  artifact_records ||--o{ artifact_binary_files : binary_output

  clip_items ||--|| search_documents : projects_to
  clip_items ||--o{ search_chunks : chunked_as
  search_embedding_spaces ||--o{ search_chunks : versions
  search_chunks ||--o| search_embeddings : embedded_as

  clip_items ||--o{ content_compact_presentations : caches_row_model
  extension_installs ||--|| extension_runtime_state : has_state
  extension_installs ||--o{ extension_action_shortcuts : owns_shortcuts
```

`clip_items`, representations, and typed children are canonical. Text is normalized UTF-8, file lists are ordered external references, binary bytes are immutable managed files; facets/artifacts/search preserve source and producer/version provenance, while job tables record resumable work rather than content. Tags, notes, pins/favorites, and transform provenance are durable; an unsaved transform is in-memory, but a saved transform makes a new linked canonical clip.

`artifact_inputs` references raw representations or other artifacts. Search chunks instead reference clip, immutable embedding space, projection hash, chunker version, and generation. Compact presentation JSON is bounded, renderer/version keyed, disposable, and excluded from fingerprints. The fresh physical schema is version 6 and is organized by database ownership domain in `001_system.sql` through `008_extension.sql`; these are initialization files, not an upgrade history. A database from an earlier V2 development baseline is rejected and must use the explicit factory-reset flow; there is no dual extension schema or v1 compatibility path.

## Files and database tables

SQLite stores relationships, metadata, queries, and local non-secret configuration. Managed files hold binary payload bytes; paths are SHA-256-derived, validated relative paths below managed root, never user-controlled locations.

```text
clipboard_data/
  managed/
    binary/
      <first-two-sha256-hex>/
        <full-sha256-hex>
    derived/
      <first-two-sha256-hex>/
        <full-sha256-hex>
  staging/
```

The two-character directory is filesystem fan-out, not an abbreviated identity: the first SHA-256 byte selects one of 256 buckets so a large library does not accumulate in one directory. The complete 64-character SHA-256 remains the filename, integrity key, and deduplication identity, so unrelated payloads cannot be mixed merely because they share a bucket.

| Domain | Tables | Purpose |
| --- | --- | --- |
| System | `system_schema_meta` | Fresh-schema identity/version; rejects legacy databases. |
| Clip | `clip_items`, `clip_representations`, `clip_text_values`, `clip_binary_files`, `clip_file_list_entries`, `clip_format_observations` | Canonical catalog, raw references, capability metadata, managed-file metadata, and bounded capture diagnostics. |
| Content | `content_facet_definitions`, `content_clip_facets`, `content_detection_jobs`, `content_compact_presentations` | Facets, detection scheduling, and rebuildable compact row models. |
| Catalog | `catalog_tags`, `catalog_clip_tags` | User organization. |
| Artifact | `artifact_records`, `artifact_inputs`, `artifact_text_values`, `artifact_binary_files`, `artifact_jobs` | OCR/previews/approved output, provenance, derived files/invalidation. |
| Search | `search_documents`, `search_documents_fts`, `search_embedding_spaces`, `search_embeddings`, `search_index_jobs` | FTS and semantic retrieval. |
| Extension | `extension_installs`, `extension_runtime_state`, `extension_contribution_runtime_state`, `extension_action_shortcuts` | Packages, activation, failure streaks, quarantine, and device-local action shortcuts. |
| Config | `config_profile_values`, `config_device_values` | Local non-secret configuration. |

Binary capture writes unique staging bytes, hashes/fsyncs them, transactionally inserts/fetches a pending binary row and clip references, atomically renames to final hash path/fsyncs its parent, then marks ready. Startup reconciliation is idempotent across pending rows, stale staging, missing/unreferenced files, and empty bucket directories. It preserves every ready canonical and derived reference. Identical bytes may share one binary row/file across clips; deletion waits for the final canonical or derived reference.

## Representation and byte contract

Each `clip_representations` row contains `clip_id`; a stable `capability_id` and `format_family`; non-null `format_key` such as `mime:text/plain` or `macos:public.html`; MIME only when declared without guessing; optional exact native type; storage kind; exactly one matching reference; ordinal/capture priority; and pending-to-ready lifecycle. `(clip_id, format_key)` is unique, preserving native-only formats without SQLite NULL ambiguity or invented MIME. Generated representations use core-owned generated capability IDs rather than pretending to be native captures.

Every adapter-supported Office/native extra is its own binary representation. Adapters capture only matrix-authorized native types and write back only capabilities with a compiled writer codec. No code guesses UTI, OLE, or other native identifiers. `clip_format_observations` records advertised order, identifier, numeric ID or medium when available, matched capability, policy version, decision/reason, and known byte length with strict count and string bounds. Observations contain no payload, are excluded from fingerprints, cascade with the clip, and are refreshed when an identical clip is recaptured. One-to-one text children, ordinal file lists, `binary_file_id`, `CHECK` constraints, and a trigger that confirms children/references (and binary ready state) enforce correctness. Only ready data reaches UI, detectors, renderers, search, or reconstruction.

| Storage kind | Canonical storage | Read and processing contract | Clipboard reconstruction |
| --- | --- | --- | --- |
| `text` | `clip_text_values`: normalized UTF-8, byte length, SHA-256. | Detectors/renderers/FTS/transforms receive UTF-8 text. | Write normalized text only for explicit support; adapter regenerates wrappers such as HTML headers. |
| `binary_asset` | `clip_binary_files` reference to immutable managed bytes. | Validate path/ready state; treat opaque unless exact-format parser supports it. | Write captured exact type only if supported; never guess identifiers. |
| `file_list` | Ordered `clip_file_list_entries`; external content is not copied. | References may no longer exist. | Write supported file-list formats only. |

Normalized text is semantically—not byte-for-byte—preserved. Byte-exact adapter-supported formats use `binary_asset`, including Office/OLE and supported native data; the platform matrix decides each format’s rule. Deleting a clip cascades owned rows; only after no reference remains may the binary reconciler remove the managed file.

## What may be persisted

Do not persist JSON AST/formatted JSON, parsed URL/query structures, decoded JWTs, renderer trees/state, generic transformer output, or hex-encoded native binary data as canonical metadata. Reusable expensive output is `artifact_*`, with producer ID/version, input hash, parameter hash, creation time, ordered representation/artifact inputs, and tracked text/binary output; derived files are never untracked paths.

Detection follows raw capture and never selects a global type. Detectors declare accepted types, candidate checks, limits, timeouts, facets; routing uses MIME/prefix/length/lightweight signatures before parsing. `search_documents` is one rebuildable projection per clip, composing user note, preferred direct text (`text/plain`, else approved text), and eligible completed OCR/extraction; notes augment rather than replace captured content, sources/input hashes enable deterministic rebuild. HTML/RTF extraction is projection work or a versioned artifact, never clip metadata; rebuild eligible-source changes and all projections after projection-algorithm changes.

## Invariants

- SQLite has relationships/metadata, not generic payload BLOBs or JSON metadata. Binary paths are validated relative paths.
- Adapters alone interpret native types and regenerate only supported platform wrappers. File lists are references, not copies.
- Use fresh domain-prefixed schema/reset only: no v1 migrations, compatibility reads/writes, or dual schema.


---

## Extensions: contributions without privilege

Extensions add semantic understanding, typed presentations, transformations, and explicit contextual actions while preserving canonical capture. Built-ins are trusted Rust; community packages are untrusted WebAssembly Components behind host-owned policy. Providers are deliberately not extensions because credentials, consent, model runtimes, and vector-space integrity need a host-owned boundary.

## Built-in contribution system

Built-ins use the same conceptual contribution model. A detector adds meaning; a renderer describes a view; a transformer produces explicit new representations; an action exposes a bounded command.

- **Detector:** receives bounded immutable text after capture, uses candidate routing plus concurrency/timeout limits, and emits source-provenanced additive facets—not a global content type.
- **Renderer:** returns a host-owned typed detail or compact model; failure falls back to the original representation or core row. Detail includes text, code, Markdown, table, tree, key/value, image, card, and error. ClipsX owns React UI.
- **Transformer:** takes explicit user action and validated parameters, creates bounded cached results, and becomes canonical only after explicit save.
- **Action:** binds a transformer preset or runs bounded guest logic and requests only a declared preview, copy, paste, save, validated HTTPS URL, or notification effect.

Built-ins are enabled by default. Renderer tab categorization and primary selection use purpose, matcher specificity, capture order, and scoped preferences as described above. See [runtime architecture](#runtime-architecture-capture-and-output) for output behavior and [data model](#data-model-preserve-first-derive-later) for persistence.

## Extension API v2 WASM boundary

This diagram shows how community contributions participate without receiving privileged handles.

```mermaid
flowchart LR
  Registry["Reviewed registry manifest"] --> Verify["Download and verify version, checksum, compatibility"]
  Dev["Developer-mode local package"] --> Verify
  Verify --> Install[("App-owned packages and install records")]
  Install --> Load["Extension host loads enabled packages"]
  Load --> WASM["Resource-limited WASM instance"]

  Capture["Ready representation"] --> DetectHook["Detector hook"]
  Select["Selected clip/view"] --> RenderHook["Renderer hook"]
  Capture --> CompactHook["Cached compact-render hook"]
  Action["Explicit user action"] --> ExecuteHook["Transform or action hook"]

  DetectHook --> WASM
  RenderHook --> WASM
  CompactHook --> WASM
  ExecuteHook --> WASM
  WASM --> Validate["Host validates bounded structured output"]
  Validate --> Facets["Persist derived facets"]
  Validate --> Model["Typed detail model"]
  Validate --> Compact[("Derived compact model")]
  Validate --> Result["Exact transform result / audited effect"]
  WASM -. "trap, timeout, or repeated failure" .-> Quarantine[("extension_runtime_state")]
```

Normal installation accepts checksum-pinned reviewed GitHub releases with package ID/version, release URL, SHA-256, compatibility, permissions, and contribution metadata. Developer Mode accepts only validated `.clipsx` packages and discloses manifest permissions before confirmation. Packages use app-owned storage and relative `extension_installs` paths, while enabled/runtime/quarantine state is SQLite.

The v2 manifest uses clauses that are ORed, fields within a clause that are ANDed, and values within a field that are ORed. Fields are facet ID, capability ID, format family, format key, MIME, and storage kind. Renderers and actions require a non-empty matcher. Renderers declare a purpose (`faithful`, `structured`, `semantic`, `source`, or `diagnostic`) and detail/compact surfaces rather than numeric priority. Compact outputs are cached after capture/redetection and invalidated for source, contribution-version, enablement, or relevant preference changes.

WASM gets only host-approved captured representation/facet data and explicit hook context: no history, native clipboard, SQLite/database, filesystem, shell, environment, React/frontend code/components, secrets, providers, or raw network. The v2 world imports no APIs and retains the 1 MiB input boundary plus fresh stores, fuel, memory, stack, transfer, deadline, validation, failure-streak, and quarantine controls. Native format resolution and codecs remain core-owned. Actions cannot mutate existing clips, tags, or notes or launch arbitrary programs.

Manifests may declare exact HTTPS origins, methods, response limits, and named credential slots for the future capability broker. Only explicitly invoked actions and capability-backed transformers are eligible; detectors and renderers remain permanently offline. Until the broker exists, these contributions are visible but unavailable without disabling local contributions. The future host owns origin/method/redirect/timeout/size/private-network enforcement, approval renewal, OS-secure credential storage, and credential injection; WASM never receives credential values.

Extension API v2 is defined by [`EXTENSION_API_V2.md`](EXTENSION_API_V2.md) and its WIT world; the v1 document is historical only. V1 packages are rejected rather than loaded through a dual ABI. Typed action outputs reuse the exact transform-result pipeline for preview, Copy, Paste, and Save. User-assigned shortcuts are app-local, device-scoped, target the selected clip, and are checked against other action assignments, core history commands, and the configured global ClipsX shortcut; system-global action shortcuts remain deferred.

The repository includes a generated-binding Rust template and buildable Color Tools package that exercises HEX/RGB/HSL detection, a semantic card, a cached row swatch, format transformers, and Copy preset actions. The app-owned packaging tool validates and creates `.clipsx` archives.

## Provider separation

`TextEmbeddingProvider`, `MultimodalEmbeddingProvider`, `GenerationProvider`, `OcrProvider` are Rust host-owned capabilities. Ollama, later OpenAI-compatible integrations, and optional local visual provider implement that interface; generic provider integrations, rather than community WASM, are the supported route to other services. The host owns consent/scheduling/retries/space validation/rebuilds; providers own invocation/tokenization/preprocessing/vector production and receive immutable input, never repository access. See [search](#search-mandatory-fts-plus-optional-candidate-sources).


---

## Search: mandatory FTS plus optional candidate sources

Search is derived from preserved clips, not a replacement for them. A host-owned search planner resolves canonical filters once, runs mandatory FTS5 plus any enabled optional candidate sources, unions clip IDs, and performs one final fusion and pagination pass. Ollama text embeddings are the first optional source. Optional local visual search, OpenAI-compatible/hosted providers, and generation are deferred.

## Index and query flow

This diagram shows ingestion-time indexes and provider-agnostic query planning. FTS is always enabled but is not a gate for other sources.

```mermaid
flowchart LR
  subgraph Ingest["Ingestion-time derived data"]
    Sources["Ready text + note + completed OCR"] --> Projection["Versioned search_documents projection"]
    Projection --> FTS[(FTS5 external-content index)]
    Projection --> Chunker["Hard-bounded text chunker"]
    Chunker --> DocEmbed["Ollama embed_documents"]
    DocEmbed --> Vectors[("Space-scoped chunk vectors")]
  end

  subgraph QueryPath["Query time"]
    React["Typed query + enabled source IDs"] --> Filters["Resolve eligible clips once"]
    Filters --> FTSQuery["Mandatory FTS source"]
    Filters --> SemanticQuery["Optional text-semantic source"]
    Filters -.-> Future["Future trusted visual/other source"]
    FTS --> FTSQuery
    Vectors --> SemanticQuery
    FTSQuery --> Union["Union candidates by clip ID"]
    SemanticQuery --> Union
    Future -.-> Union
    Union --> RRF["Equal-weight RRF; k=60"]
    RRF --> Page["Deterministic fused pagination + hydration"]
  end
```

Projection uses user note, ready plain/HTML/RTF in priority order, completed OCR, and tag names. Facets, binary bytes, and unsaved/generated previews are not independently indexed as result documents; tags can also be applied as SQL filters. Simple syntax escapes whitespace tokens as FTS5 prefix terms and uses implicit AND, so `doc` matches `document`; advanced mode passes FTS syntax unchanged, while scope/tag/representation/facet filters are SQL and filter-only queries do not depend on a completed search projection.

The current generic text chunker normalizes line endings and produces ordered, overlapping windows capped at 2,048 UTF-8 bytes. It prefers paragraph, line, and whitespace boundaries but always falls back to a Unicode-safe hard boundary, so minified markup and long unbroken text cannot bypass the cap. Ollama receives no more than 16 chunks per request with truncation disabled. A reported context overflow isolates the failing chunk and recursively subdivides it within bounded depth; unrelated provider errors are not misclassified. Format-specific semantic extraction and chunking for Markdown, visible HTML, RTF, code, and tables are deferred behind this versioned chunker boundary.

Enabling/changing Ollama creates an immutable space and a pending index generation. Reindexing stores the replacement generation alongside the active one; semantic queries continue using only the active generation. Promotion occurs only after every job in the pending space and generation succeeds, after which superseded chunks and jobs are removed. Failed work remains retryable without poisoning later generations or partially replacing the active index.

## Candidate-source contract

Search sources are trusted host capabilities that accept a typed query plus the shared eligible clip set and return an independently ranked, bounded candidate list. Sources do not hydrate UI models, paginate independently, or decide global rank. A match records its source rank and may expose a source-local display score; the text-semantic source uses its normalized cosine score for the result percentage, but source-local scores never affect cross-source fusion. The planner unions results, applies equal-weight reciprocal-rank fusion, and only then paginates and hydrates clips. A source failure is isolated: optional failures produce diagnostics and FTS results, while invalid advanced FTS syntax is a correctable query error. The 5,000-candidate per-source bound is disclosed through `isExhaustive`.

`builtin.search.fts` is mandatory. `builtin.search.semantic_text` can return semantic-only clips and is independently enabled for querying; disabling it does not stop its rebuildable index. Future visual sources register through the same internal planner contract but remain host-owned provider capabilities rather than community extensions.

Note and tag mutations call the shared projection refresh path, then enqueue and process embedding work when a text provider is configured. The canonical mutation and derived refresh are separate operations, so a refresh failure degrades search without rolling back the user's catalog edit; the normal stale-projection rebuild repairs it later.

## Providers, spaces, privacy

Desktop connects directly to providers; V2 has no model proxy/server. Default disabled embedding leaves FTS functional. Ollama is the implemented text-embedding backend. OpenAI-compatible providers and an optional local visual provider are deferred; any local visual provider must own its runtime, tokenizer, preprocessing, and model and must never be auto-installed or downloaded.

Embedding providers implement `describe`, `embed_documents`, `embed_query`; multimodal also `embed_images`. `describe` gives immutable kind, canonical endpoint when applicable, model/revision/digest when available, modality, dimensions, normalization, metric; descriptor/config change creates space and host rejects mismatched vectors.

| Scope | Examples |
| --- | --- |
| Profile | Capability, provider/model, safe label, renderer preference, transform favorite. |
| Device | Ollama endpoint/model, local path, GPU/runtime choice. |
| Secret | API keys/auth tokens in OS secure storage only. |

No auto downloads; remote generation is user-invoked, remote indexing requires explicit opt-in, no silent hosted clipboard transmission, endpoints/local paths/credentials never leave device. `search_*` is disposable local index state: users clear spaces/all semantic data and rebuild; OCR/summaries/expensive output are versioned artifacts. OCR is native/local only and records `unsupported` rather than hosted fallback. Ollama probes capability rather than model names, and unavailable/unsuitable/disabled service leaves FTS alone; BGE code/artifacts/auto-download removal follows acceptance tests, while visual code becomes optional package and capture/preview/OCR remain independent.
