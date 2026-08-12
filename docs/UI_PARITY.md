# UI and behavioral parity matrix

This is the authoritative user-facing delivery gate for the archived V1 experience on the V2 architecture. Status terms are defined in [README.md](README.md). The archive is a behavioral reference only; no row authorizes the V1 schema, `ClipItem`, sparse metadata, legacy IPC, or compatibility reads.

## Summary

| Recovery area | Status | Blocking work |
|---|---|---|
| IPC and incompatible-schema startup | Verified | None; preserve contract/reset tests. |
| Desktop host integration | Implemented — validation pending | Installed Windows/macOS/Linux smoke matrix. |
| History/catalog interaction | Verified | Desktop focus/accessibility regression pass. |
| Typed presentation and specialized previews | Verified automated | Installed desktop visual/accessibility validation remains in R7. |
| Clipboard reconstruction and paste | Partial | Native fixtures across restart and real target-app paste tests. |
| Search/OCR/settings workflows | Partial | Provider configuration, platform OCR coverage, and remaining runtime settings. |
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

The contribution resolver, alternate-view tabs, extension fallback, and raw inspector feed one exhaustive typed `RenderModel` dispatcher. The detailed V2 preview no longer converts models to the legacy `Content` shape.

| Presentation | Current state | Status | Required result |
|---|---|---|---|
| Plain text, code, and Markdown | Direct typed models with language-aware code and safe Markdown | Verified automated | Installed visual/editor smoke. |
| JSON/tree/key-value | Structured values render recursively without string conversion | Verified automated | Installed accessibility smoke. |
| Table/CSV | Columns and cells render directly; no tab-joined reconstruction | Verified automated | Large-table desktop performance smoke; delimiter transforms remain R5. |
| HTML | Rust-sanitized markup renders in a sandboxed iframe | Verified automated | Installed visual smoke. |
| RTF/rich text | Bounded guarded parsing emits only safe structural tags, with escaped fallback | Verified automated | Installed visual smoke. |
| Image | Managed asset preview carries disabled/pending/running/ready/unsupported/failed OCR and retry | Verified automated | Platform OCR validation remains R4/R7. |
| Files | Ordered path/name references render without filesystem stat or invented metadata | Verified automated | Native ordered-file reconstruction remains R3. |
| Office/native | Exact identity/length remain visible and useful alternates outrank opaque detail | Verified automated | Native Office fixture validation remains R3. |
| URL, email, color, phone and path | Typed semantic payload validation with specialized controls and generic fallback | Verified automated | Installed host-action smoke. |
| JWT, date, timestamp, math and secret | Typed semantic payloads render without fabricated values | Verified automated | Installed redaction/accessibility smoke. |
| Unsupported binary | Typed metadata fallback and original output exist; no automatic Base64 | Verified automated | Reconstruction remains R3. |

R2 meets its automated exit gate: every `RenderModel` variant has a direct, bounded React presentation and no successful model is forced through fabricated legacy metadata.

## Copy, paste, actions, and transformations

| Behavior | Current state | Status | Acceptance gate |
|---|---|---|---|
| Copy Original | Explicit output policy reconstructs supported representation set | Implemented — validation pending | Capture/restart/reconstruct fixtures by platform. |
| Copy Plain Text | Explicit renderer-independent policy | Implemented — validation pending | Multi-representation selection fixtures. |
| Quick paste | Windows/macOS/Linux implementation exists | Partial | Target focus/paste tests; macOS Accessibility recovery UX. |
| `ClipActionsToolbar` base actions | Copy, pin, favorite and delete use typed presentation context; copy remains clip-ID/output-policy based | Verified automated | Installed interaction smoke. |
| Preview-local contextual actions | Typed editor and validated semantic URL/email/phone/path actions are direct; transform-oriented CSV/code actions remain | Partial | Finish transform/context actions in R5. |
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
| OCR UI | Typed lifecycle, empty-success, safe failure, retry, and targeted artifact-event refresh | Verified automated | Validate supported/unsupported platform runtimes in R4/R7. |
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
