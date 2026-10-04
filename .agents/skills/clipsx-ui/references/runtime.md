# Desktop interaction and diagnostics contracts

Rust owns every clipboard write; the webview never uses the browser clipboard. Keep host text in both English and Japanese catalogs with live language switching and interpolation. Do not translate command IDs, confirmation tokens, examples or user/package content.

## Desktop startup

React mounts immediately. Telemetry bootstrap runs independently; reporting stays
closed until authoritative policy and runtime metadata arrive. A newer settings
choice takes precedence over a delayed bootstrap response.

Storage recovery remains a gate. Once storage is ready, the webview loads saved
settings, applies the initial language and document direction, then mounts history.
Tray translation and initial language normalization persistence run without
blocking that mount. Subsequent saved language changes use the same synchronization
path. Incompatible storage shows the recovery screen before loading normal app state.

History, pagination, and ordinary clipboard previews are available immediately.
Settings, Extensions, Intelligence, and Recall load on navigation with local
loading fallbacks. Existing detection, indexing, artifact, and transformation
workers continue in the background.

Extension discovery reads manifests and metadata only: listing packages, setups,
icons, and view descriptors does not compile WebAssembly. After input, permission,
and availability eligibility checks, guest calls prepare only their package.
Installation still validates components. One shared Wasmtime engine retains the
in-memory component cache. A single preparation mutex serializes compilation on
blocking workers and is released before normal guest execution. Wasmtime's built-in
persistent cache uses the app-local cache directory and owns invalidation and
cleanup; unavailable caching emits a bounded diagnostic and runs without disk
caching. The epoch timer continues to enforce execution deadlines.

## Desktop appearance

The main webview's theme provider applies the saved Light/Dark choice to the
document; Auto follows system theme changes. The native window follows the OS.
On macOS, the main window's OS theme-change handler forwards the new theme to
Tauri so the webview's system color-scheme preference remains current.
CSS compares the document's theme class with the system color-scheme preference
and strengthens only the outer frame's background opacity when they differ:
Light over a dark system uses 85%; Dark over a light system uses 75%.
Matching combinations retain the original 30% Light / 60% Dark opacity.
All combinations use the original slate colors, internal surfaces and blur;
there are no alternative palettes or additional theme state/listeners.

## Diagnostics and error reporting

Provider, extension runtime, job scheduling and interactive actions share typed
host failures. A stable reason identifies the problem; an independent recovery
policy determines stop, wait, retry or cancellation. Jobs persist safe reason
codes, and the frontend maps them to reviewed explanations and next actions.
Wrapped failures retain their type instead of being classified from formatted
strings. Unknown failures stay explicitly unknown. Provider failures do not
contribute to guest quarantine, and delivery-review fencing remains independent
of failure presentation.

Text-generation diagnostics persist safe categories and reviewed messages rather
than provider response bodies. Reading legacy generation diagnostics replaces
stored raw messages with the reviewed description for their existing code;
other capabilities are untouched. Error presentation excludes input, prompts,
credentials, endpoint URLs and arbitrary provider/guest text.

The desktop has two independent diagnostic paths. A local Rust logger always
writes curated `info`, `warn`, and `error` events to Tauri's application log
directory. Verbose diagnostics adds allowlisted `debug` events until the user
turns it off. Files rotate at 2 MB and retain five generations. The webview can
emit only reviewed event names through typed IPC; arbitrary JavaScript logging
and `console.*` forwarding are outside the boundary.

Sentry receives actionable production failures when **Send error reports** is
enabled. The Rust host and React webview share the `clipsx-desktop` project and
use `layer=native|webview`. Signed-in events identify the Supabase account by
UUID, verified email, bounded display name, and controlled auth-provider tag.
Signed-out desktop events use a random installation ID and short support code.
Disabling reporting takes effect in both layers without disabling local logs.

The main webview bootstraps reporting through a restricted host command independently
of rendering. Reports use the host's app version, release, environment, OS/version,
architecture, and webview engine/version; unavailable versions are omitted.
Webview reporting remains disabled until the saved policy and runtime metadata
are available. The host retains a control-character-free user-agent, bounded to
1,024 characters. Both SDKs include it in runtime context and a reconstructed
User-Agent-only request header for Sentry's browser enrichment; no other request
information survives sanitization.

Extension reports carry host-snapshotted package ID/name/version/checksum,
registry/local source, contribution ID/version/kind, execution stage, classified
reason, and extension/provider/host origin. Package and contribution versions
are independent. Immediate operations report at the service boundary; durable
jobs report only after an authoritative terminal failure transition. Custom-view
failures report through validated host sessions. Extension metadata is local to
each event and never attached to unrelated app crashes. Expected cancellations,
input/permission/configuration failures, and transient provider retries do not
create error reports. Identical events are suppressed for 60 seconds in a
256-entry in-memory cache; changed packages and quarantine transitions can
report separately. Issue fingerprints omit versions so regressions can be
compared across releases. Neither reporting nor suppression changes execution,
retry, or quarantine policy.

Component validation failures are attributed once to the package; contribution
fields are omitted because no contribution has executed yet.

Neither path admits clipboard or OCR content, search queries, notes, tags,
Vault data, arbitrary URLs, query strings, file paths, window titles, secrets,
tokens, request bodies, screenshots, databases, or indexes. Manual diagnostic
exports contain only rotated logs, an allowlisted machine summary, and a README;
they are never uploaded automatically. The native SDK reports panics and errors
that reach its hooks, but cannot guarantee capture of every hard process crash.

## Views and output

Renderer choice is UI policy, never canonical clip state. Saved preferences
influence presentation without changing Original or Plain Text output.

```text
Ready representations + facets + enabled renderers + preferences
  -> ClipViewSet
     ├── primaryViewId: opened first and used for history identity
     └── other compatible views: tabs
```

Each view identifies its source, renderer, optional facet, purpose, and placement.

| Selection rule                                         | Order                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Saved preference                                       | Facet -> capability -> MIME                                                        |
| Images, files, documents, renderable Office alternates | Faithful view first                                                                |
| Text without preference                                | Structured -> semantic -> faithful -> source -> diagnostic                         |
| Deterministic ties                                     | Matcher specificity, facet priority, capture priority, native ordinal, renderer ID |

Opaque Office data remains reconstructable; an HTML, RTF, image, or PDF
alternate supplies its preview. Known built-in semantic views are additive.
An unknown facet gets generic key/value details unless an enabled compatible
extension claims that exact source/facet. The fallback returns when the
extension becomes unavailable. Renderer failure falls back to a compatible
built-in view.

Host `RenderModel` types cover text, code, Markdown, sanitized sandboxed
HTML/rich text, tables, trees, key/value data, images, files, documents,
semantic views, and errors. Custom extension UI follows the
[extension contract](../../../../docs/EXTENSION_API_V3.md).

| User action             | Source and result                                                   |
| ----------------------- | ------------------------------------------------------------------- |
| Copy / Original         | Reconstruct explicitly supported captured formats                   |
| Copy plain text         | Offered only for ready `text/plain`; copies exact stored characters |
| Transform               | Validate parameters; enqueue one durable clip-owned result job      |
| Save transformed result | New canonical clip with provenance; source unchanged                |
| Share                   | Explicit host-owned disclosure of supported source content          |

Copy plain text never substitutes OCR or rendered/extension content.
Self-writes use a consumable native change token before readback; the snapshot
fallback requires both matching token and fingerprint.

Transforms use native MIME-aware host previews. Result bytes are durable artifacts
with job provenance, and result tabs reload from SQLite. Raster results use an
opaque, no-store artifact URL; results are not canonical data until promoted.
The clip tab strip contains native views and extension jobs. Tools opens inside
the preview card and is the single entry point for transformer built-in and
saved setups; a setup stores parameters locally and produces a tab only when
run. Pins are device-local operation preferences: uninstall removes them, while
disablement hides them until the package is enabled again. A result adds one
compact toolbar row for output selection, view selection, and explicit controls.
The host owns typed previews, Original/Result comparison, retry, cancellation,
and deletion.
At clipboard write time, typed source text without a portable native format may
gain an identical plain-text companion. Stored representations remain
unchanged.
On Windows, a canonical PNG is reconstructed as both registered `PNG` and
standard `CF_DIBV5` clipboard formats so native applications and browsers can
consume the same image without changing the stored representation.

Sharing receives only a clip ID. Rust resolves a URL, exact plain text, live file
references, or a checksum-verified export in `share-staging`. Notes, tags,
source metadata, OCR, and extension renderings are excluded. ClipsX performs no
upload. Windows uses Share Sheet, macOS uses `NSSharingServicePicker`, and
Linux/X11 uses the desktop portal. Random export names prevent replacement;
startup removes files older than 24 hours without descending into directories.

### History presentation

Every `ClipSummary.historyPreview` contains a leading visual, title, optional
subtitle/badge, and accessibility label.

| Concern                  | Rule                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Title                    | Visible HTML/RTF text; image OCR or format label; meaningful file/document labels                      |
| Icon                     | Same resolved primary view as detail; thumbnail, color swatch, host icon, or validated extension glyph |
| Extension compact result | Nonempty title may replace the built-in preview; otherwise retain built-in text                        |
| Compact cache            | Content-only JSON, at most 2 KiB; resolve SVGs from enabled package metadata                           |
| Reading cached icons     | No WASM compilation/execution; no decoded-content disclosure                                           |
| Hydration                | Batch by category: tags, compact previews, OCR, file info, facets                                      |
| Refresh                  | Artifact completion, renderer preferences, extension lifecycle                                         |

Single-item reads use the same resolver. Rows are measured and virtualized with
bounded overscan. Selection uses clip IDs, and keyboard selection scrolls
unmounted rows into view. Each `End` keypress loads at most one older 50-item page.

Search input updates immediately; requests wait 300 ms after typing stops and
until IME composition ends. Its subscription is separate from history/layout
rendering. Unchanged preview models and statistics are reused with the applied
theme.

### Window activation, layout, and logging

| Entry point                         | Behaviour                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Global shortcut                     | Hide only if visible, focused, and not minimized; otherwise cancel blur-hide, restore, show, focus |
| Tray left-click                     | Open/focus Clipboard History                                                                       |
| Tray Open, second launch, deep link | Open; never toggle closed                                                                          |
| Explicit activation                 | Focus Search on History; preserve control on Settings/Extensions                                   |
| Alt+Tab / taskbar                   | Preserve previous editor focus                                                                     |

Windows uses actual OS foreground state. Native callbacks enqueue work and
return. One coordinator coalesces requests; a dedicated worker restores normal
Z-order, confirms foreground within a bound, then focuses the embedded webview.
OS refusal is visible. Stage/timing diagnostics and a watchdog report stalls
without releasing the single-flight guard or starting competing workers.

The device-local `window.history_split_ratio` defaults to 0.50; valid range is
0.20–0.80. Layout subtracts the separator and preserves 280 px history / 420 px
preview minimums where possible; narrow windows scale minima without rewriting
the saved ratio. Pointer gestures save on completion; keyboard changes save
per action.

Logging and reporting policy are defined in the diagnostics section above.

### Startup recovery and Mac native failures

Operational logging starts before storage preparation. Foundation and service initialization failures become a recovery state rather than a panic. Diagnostics summary/export and log-folder access do not require the history repository. Migration versions and precise compatibility reasons are shown without deleting data; retired schema and factory reset remain separate explicit actions.

Local logs retain bounded operational error chains, stages and panic backtraces. Diagnostics schema 2 exposes SDK configuration/initialization, reporting policy, startup failure and the last manual submission ID. An accepted HTTP submission does not prove processing in Sentry.

Diagnostics & support in Settings > Advanced owns automatic-reporting and verbose-local-logging preferences, support-code copying, local ZIP export, and explicit manual report review. The main screen never displays crash-report controls or startup notices. Report review expands inline with a contents summary, optional crash preview, attachment removal, optional logs and fresh consent after any attachment change. Less common actions live in More tools. Startup recovery reuses report review and local tools without requiring loaded settings or storage.

On macOS, the OS captures `.ips` reports. ClipsX discovers its own reports and permits manual selection, preview and explicit per-report consent, with logs excluded unless selected. Wrong-app, malformed, oversized or changed reports are rejected; network failures retain local files. No native crash-handler process is bundled. Fatal termination before the recovery UI starts requires Console/Finder or a subsequent working build.

Mac signing, cold-cache probes and symbols are specified by [release operations](../../clipsx-release/references/operations.md).
