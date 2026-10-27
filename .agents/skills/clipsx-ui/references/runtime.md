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
Windows and macOS use native backdrop effects. CSS strengthens the outer frame's
opacity when the document theme differs from the system: Light over a dark system
uses 85%; Dark over a light system uses 75%. Matching combinations use 30% Light /
60% Dark opacity. Linux uses an opaque outer frame in the same slate colors because
Tauri's native backdrop effects are unavailable there. Search, history and preview
use a shared raised-surface fill on Linux: white in Light, a 5% slate tint in Dark.
Search has an inset outline and violet focus indicator. Internal blur remains shared;
no additional theme state or listeners are used.

Windows and Linux render minimize, maximize/restore and close controls in the
existing titlebar. Linux uses SVG icons; Windows retains its native-font glyphs
and Snap overlay. macOS uses native window buttons. Close hides the window;
Quit from the tray exits the app.

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

Image previews and Mermaid diagrams start fitted and centered without enlarging
small content. Zoom uses natural dimensions, with 10–800% manual zoom and smaller
fit scales where needed. Drag pans; pinch or Ctrl/Command+wheel zooms around the
pointer. Native WebKit gesture events provide modifier-free trackpad pinch on
macOS; Chromium-style pinch uses browser-generated Ctrl+wheel events without
requiring the user to hold Ctrl. On Windows the host enables WebView2 native
pinch recognition for every webview while retaining disabled browser zoom
hotkeys. An all-frame, non-passive capture listener cancels page scaling without
stopping canvas handlers; ordinary two-finger scrolling remains unchanged.
The main frontend also installs the guard directly. Same-origin HTML/rich-text
preview frames receive the guard from their trusted parent's load handler,
without enabling scripts in the sandbox. Nonvisual clips never request page zoom. Overlapping gesture and wheel
events are consumed once, and listeners are scoped to the canvas. Ordinary wheel
input pans overflowing standalone visuals; embedded
diagrams preserve document scrolling. Focused canvases support +/−, arrows, 0
for Fit and 1 for 100%. Fit follows resizing; manual views retain their center.
The cursor is normal when all content fits; grab/grabbing is used only when
content overflows and can be panned. Touch pinch remains available while fitted.
Host-owned expansion preserves the mounted viewport or custom-webview session,
closes with Escape and restores focus. View transforms are not persisted.

Open externally exports the displayed, clip-owned managed image or ready result
image to a uniquely named copy in `editor_previews`, then uses the OS-associated
application. Rust checks ownership and payload integrity; no arbitrary path is
accepted. External edits never modify canonical images or results and are not
automatically imported. Copies remain local editor working files, independent of clip deletion. This action does not
fetch remote URL images or export a preview thumbnail in place of its source.

Copy plain text never substitutes OCR or rendered/extension content.
Self-writes use a consumable native change token before readback; the snapshot
fallback requires both matching token and fingerprint.

Transforms use native MIME-aware host previews. Result bytes are durable artifacts
with job provenance and reload from SQLite. Raster results use an opaque, no-store
artifact URL; results are not canonical data until promoted.

Preview and Results are stable, connected tabs. The display picker shares their header row. Default-view actions name both the view and a precise recognized content type. Generic text/capability defaults are not offered; facet defaults use the matching source’s display name. View selects a display of a
captured source; inspection entries distinguish HTML/RTF sources and expose all
stored formats. Existing resolver preferences determine the default; friendly
preference actions map to the most specific applicable internal scope. The app
never deduplicates different stored formats by appearance or label, and ordinary
Copy continues to use its original clipboard policy.

Results keeps one compact row for its searchable newest-run-first picker, status, Copy and options menu. The picker dropdown follows its trigger width; its trigger is capped at 28rem. Preview/Compare uses two icon-and-label buttons beside the main Preview/Results tabs, with a visible active state and icon-only fallback when space is limited. Preview shows the selected output alone; Compare adds the original. Output selection, formatted/source display, extension layouts and Paste live in the options menu, separated from run management. Run again, save and delete apply to the run; deletion confirms removal of the run and all outputs. Creation time, output count and technical identity live under Run details. Cancel and Retry remain visible in their relevant states. Result-only is the initial layout; comparison is resizable when
wide and stacked when narrow. Copy/paste select one output; promotion saves the
run's outputs together. Manual runs select their pending result only if no clip,
tab, result or dialog navigation superseded their intent. Background completion
never steals selection or keyboard focus. Failed/cancelled results and deletion
remain explicit. Tab/panel motion respects reduced-motion preferences; the native
custom preview is hidden whenever Results is active.

The preview's Transform menu lists compatible built-in and saved setups, grouped
by operation and package. Complete, ready setups run directly against their
assessed source. Capability-backed runs use the existing native invocation token;
missing consent or parameters opens the selected setup in Tools. Hidden setups
are omitted; disabled setups retain their reason. Explicit runs select the pending
result only while their original navigation intent is current. They never write
the clipboard automatically. Copying a selected result remains a separate action.
Tools groups operations by package and edits built-in/saved setups. Contextual
actions remain accessible through Tools and user-pinned shortcuts; the preview
has no separate Actions or Copy as menus. Pins remain device-local operation
preferences: uninstall removes them; disablement hides them until enabled again.
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

Unfiltered All history starts with a collapsible section showing up to three
pinned shortcuts and View all, which opens the existing Pinned collection. A
3+ badge means additional pins are available there. Shortcuts and the unfiltered Pinned collection share a saved device-local
order. Move up/down controls in the Pinned collection update that order; newly
pinned clips appear first. Copying a pin never changes its position. They are queried
separately from history, so older pins remain accessible. Pinned clips do not
also appear in recent history. Section headings and clips share one measured,
virtualized scroll surface; collapse lasts while history remains mounted.
Search, tag filters, Favorites and the Pinned collection show one ordinary
results list in its existing ranking/order, with pin indicators retained.
Ordering controls are hidden during search and tag filtering, and retain
keyboard focus while a save is pending. Failed moves leave the order unchanged
and show a retryable error toast. Keyboard navigation and quick slots follow visible clip order. Pin refresh
failures retain cached shortcuts with retry; refreshing on window focus catches
changes while the app was hidden.

History shows up to two readable tag chips per row, with an overflow count.
The searchable Tags picker sits beside All/Favorites/Pinned and combines one
tag filter with the current scope and text search. Preview tags share a fixed-height bottom metadata bar (with or without tags): up to two compact chips and an overflow count open one searchable picker. Add tag searches existing names or creates a tag; the picker also lists every attached tag for removal. Removing a tag removes only that membership. Clip statistics and source information live in the adjacent Details popover, with labeled metadata rows and a title/subtitle. Global tag deletion is available for the
selected filter with confirmation; it clears an active deleted filter. An enabled
decision rule can recreate its tag on a later capture.

Capture and duplicate-capture updates merge their tags into the live catalogue,
even outside the visible scope. Opening either picker refreshes the catalogue;
in-flight reads preserve newly received tags and do not resurrect deletions.
Catalogue errors keep cached tags available with retry and do not replace history
errors. Tag popovers use the host-overlay lifecycle so native extension views
cannot cover them; Escape closes the picker and restores trigger focus.

Single-item reads use the same resolver. Rows are measured and virtualized with
bounded overscan. Selection uses clip IDs, and keyboard selection scrolls
unmounted rows into view. Each `End` keypress loads at most one older 50-item page.

Search input updates immediately. History publishes keyword results after 75 ms
of inactivity and adds semantic-only matches at or after 250 ms when enabled;
IME composition pauses both. Keyword pagination keeps its own cursor. Its subscription is separate from history/layout
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

Main-window size is restored once, before startup activation, including hidden
autostart. Early activations wait for restoration; storage recovery releases
them with the default geometry. Restarts use the last normal content dimensions
in logical pixels, centered on the startup display where the OS permits it.
The window fits the monitor work area, accounting for native borders; its
600 × 450 minimum is reduced only when the display is smaller. Temporary fitting
does not overwrite the preferred size. Position, minimized, maximized and
fullscreen states are not restored. Same-session activation preserves geometry.
Native resizes settle for 500 ms before saving, and hide/quit/restart capture
the latest normal size. Writes are serialized; failures never block startup or
exit. The persistence contract is in [the data model](../../../../docs/MODELS.md).

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
