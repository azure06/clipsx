# UI and behavioral parity matrix

This is the authoritative user-facing delivery gate for the archived V1 experience on the V2 architecture. Status terms are defined in [README.md](README.md). The archive is a behavioral reference only; no row authorizes the V1 schema, `ClipItem`, sparse metadata, legacy IPC, or compatibility reads.

## Summary

| Recovery area | Status | Blocking work |
|---|---|---|
| IPC and incompatible-schema startup | Verified | None; preserve contract/reset tests. |
| Desktop host integration | Implemented — validation pending | Installed Windows/macOS/Linux smoke matrix. |
| History/catalog interaction | Verified | Desktop focus/accessibility regression pass. |
| Typed presentation and specialized previews | Partial — **next milestone** | Replace lossy legacy-content bridge and repair structured models. |
| Clipboard reconstruction and paste | Partial | Native fixtures across restart and real target-app paste tests. |
| Search/OCR/settings workflows | Partial | Provider/OCR lifecycle UI and remaining runtime settings. |
| Transformations and contextual actions | Partial | Exact preview rendering, parameters, source resolution and error states. |
| Extension product workflow | Partial | Developer install, registry lifecycle, diagnostics and end-to-end contribution tests. |
| Release readiness | Missing | Complete all required desktop/platform gates. |

## Shell, history, and desktop behavior

| Behavior | Current state | Status | Acceptance gate |
|---|---|---|---|
| Glass shell, themes, i18n, title drag region, sidebar and split preview | React implementation retained | Implemented — validation pending | Visual, focus and accessibility smoke on all platforms. |
| History pagination and live invalidation | V2 summaries/store/events | Verified | Pagination and event tests pass. |
| All/favorites/pinned scopes | V2 query scopes and optimistic store behavior | Verified | Scope and mutation tests pass. |
| Notes and tags | V2 catalog mutations refresh FTS and embedding work | Verified | Mutation/search tests pass. |
| Delete, clear, pin and favorite | V2 history commands and store behavior | Verified | Store/repository tests pass. |
| Keyboard list navigation, activation, delete, search focus and Escape | Retained frontend behavior | Verified automated; desktop validation pending | Shortcut/IME tests plus real focus smoke. |
| Tray Open/Settings/Quit and localized labels | V2 `HostState` and tray menu | Implemented — validation pending | Installed desktop smoke. |
| Close-to-tray and explicit quit | Main close is intercepted; tray Quit exits and applies `clear_on_exit` | Implemented — validation pending | Desktop lifecycle smoke and clear-on-exit fixture. |
| Global shortcut | Platform-aware default; toggles focused window and restores hidden/minimized window | Implemented — validation pending | Registration/change/toggle smoke on all platforms. |
| Single instance and deep links | Plugins and show/focus wiring restored | Implemented — validation pending | Second-launch and installed-protocol tests. |
| Autostart, settings import/export and updater | Required plugins/permissions and updater command restored | Implemented — validation pending | Installed-package tests for configured/unconfigured updater and file picker scope. |
| Windows frameless controls | Decorum plugin and permission restored | Implemented — validation pending | Minimize/maximize/close/snap smoke. |
| OAuth callback | Installed deep link plus bounded development loopback listener | Implemented — validation pending | Google/Supabase PKCE on dev and packaged builds. |
| Legacy/unsupported schema reset | Startup-only state, exact confirmation, owned-path reset and restart UI | Verified | Foundation and React recovery tests pass. |

## Rendering and specialized previews

The contribution resolver, alternate-view tabs, extension fallback, and raw inspector are implemented. The selected `RenderModel` is still converted to the legacy `Content` shape in React, which makes this area partial.

| Presentation | Current state | Status | Required result |
|---|---|---|---|
| Plain text and code | Basic content and language mapping work | Implemented — validation pending | Typed component fixtures and editor/copy action checks. |
| Markdown | Retained preview, safe raw HTML behavior and Mermaid tests | Verified for retained component; V2 integration pending | Direct typed model integration. |
| JSON/tree/key-value | Tree is stringified back into legacy text | Partial | Render structured values directly without losing scalar/object identity. |
| Table/CSV | Rows are flattened to tab text and delimiter metadata is lost | Partial | Direct columns/rows model; correct CSV/TSV actions and empty/large states. |
| HTML | Sanitized model exists; allowlist removes much useful formatting | Partial | Explicit safe allowlist, formatted/source views and security tests. |
| RTF/rich text | Raw RTF currently falls back to plain text | Missing parity | Versioned extraction/sanitization plus useful plain source fallback. |
| Image | Managed asset preview works | Partial | Carry OCR state/result/error/retry and verify loading/failure states. |
| Files | Validated host open works; UI fabricates zero size/timestamps | Partial | Typed file metadata or omission of unavailable fields; ordered multi-file view. |
| Office/native | Native identity is retained but useful alternates can be outranked | Partial | Best formatted primary view with HTML/text/PDF/SVG/image alternates. |
| URL, email, color, phone and path | Additive facets reach retained specialized controls | Implemented — validation pending | Typed facet payload and host-action tests. |
| JWT, date, timestamp, math and secret | Additive facets reach retained previews | Implemented — validation pending | Ambiguous-facet and redaction/copy tests. |
| Unsupported binary | Metadata fallback and original output exist; no automatic Base64 | Implemented — validation pending | Unsupported-format and reconstruction tests. |

R2 is complete only when every `RenderModel` variant has a direct, bounded React presentation; no successful model is forced through fabricated legacy metadata.

## Copy, paste, actions, and transformations

| Behavior | Current state | Status | Acceptance gate |
|---|---|---|---|
| Copy Original | Explicit output policy reconstructs supported representation set | Implemented — validation pending | Capture/restart/reconstruct fixtures by platform. |
| Copy Plain Text | Explicit renderer-independent policy | Implemented — validation pending | Multi-representation selection fixtures. |
| Quick paste | Windows/macOS/Linux implementation exists | Partial | Target focus/paste tests; macOS Accessibility recovery UX. |
| `ClipActionsToolbar` base actions | Copy, pin, favorite and delete use V2 store/output paths | Implemented — validation pending | Per-action integration tests with selected alternate renderer. |
| Preview-local contextual actions | Retained URL/code/CSV/etc. registry | Partial | Validate each action against typed presentation inputs. |
| Transform discovery and execution | Built-in descriptors and service exist | Implemented backend | Source-aware UI integration required. |
| Transform preview | Result model is returned but not displayed | Missing workflow | Render the exact cached model before Copy/Paste/Save. |
| Transform parameters | UI always submits `{}` | Missing workflow | Schema-driven controls, validation and defaults. |
| Transform source selection | UI uses active view source even when another representation matched | Partial | Resolve and disclose the applicable source representation. |
| Transform Copy/Paste/Save | Cached exact result and provenance exist | Partial | Busy/error/expiry states and byte-equivalence tests. |

## Search, OCR, settings, and extensions

| Behavior | Current state | Status | Acceptance gate |
|---|---|---|---|
| FTS, filters and scopes | V2 projection/query path implemented | Verified | Query, syntax, scope, note and tag tests. |
| Search projection mutation refresh | Note/tag mutations refresh projection and embedding work | Verified | Existing repository/IPC tests; preserve stale rebuild fallback. |
| Ollama backend | Loopback validation, discovery, spaces, jobs and hybrid scoring exist | Verified backend | Provider UI remains separate. |
| Search-bar semantic status | Uses V2 embedding status and events | Verified automated | Provider-enabled desktop smoke. |
| Ollama configuration/reindex/recovery UI | Only partial status/catalog exposure | Partial | Endpoint/model selection, probe, enable/disable, progress, reindex, clear and diagnostics. |
| Semantic-only recall | Hybrid fusion is limited to FTS candidates | Intentional current limitation | Do not claim semantic recall beyond the FTS candidate page; product decision required before changing. |
| OCR backend | macOS/Linux paths exist; Windows runtime is unavailable | Partial | Per-platform contract and fixture validation. |
| OCR UI | State/result/error is discarded by the presentation bridge | Missing parity | Expose pending/running/done/failed/unsupported and retry. |
| Capture filters and retention | Persisted and applied | Verified backend | Settings restart and managed-byte retention tests. |
| `auto_clear_minutes` | Persisted only | Missing parity | Runtime timer clears the OS clipboard with safe cancellation/reset semantics. |
| `clear_on_exit` | Applied on explicit tray Quit | Implemented — validation pending | Desktop exit test; closing to tray must not clear. |
| Representation size default | V2 uses 50 MiB; V1 used 10 MiB | Decision required | Confirm and document the product default before release. |
| Extension runtime/package security | Manifest, package, Wasmtime limits, quarantine and registry service exist | Verified backend | Preserve security tests. |
| Installed/registry extension UI | Enable/recover/uninstall and reviewed registry install are present | Partial | Registry refresh, local developer install, persistent warnings and complete diagnostics. |

## Explicit exclusions

- Encrypted Vault, entitlement gating and remote/cloud sync.
- The old hard-wired BGE/SigLIP model stack.
- Optional local visual semantic search until it is implemented through the provider boundary.
- Hosted embedding providers, vision and generation.

## Invariants

- Platform adapters own representation identity; detectors add facets and never rewrite it.
- Renderer selection never changes canonical clipboard output.
- Only explicit transformations create different bytes.
- Normal Copy/Paste uses `Original` or explicit `PlainText` output policy.
- Derived failures never invalidate ready canonical representations.
- A row advances to **Verified** only when its named gate passes and the result is recorded in the relevant platform/release document.
