# ClipsX V1 → V2 Gap Analysis and Recovery Plan

**Status:** Reconciled baseline; R0 verified, R1 implemented with desktop validation pending, R2 next  
**Date:** 2026-08-12  
**V1 reference:** `archive/v1-pre-m0` (`d9f1392`, tag `v1-pre-m0-reference`)

## Recovery progress

Desktop Boundary Recovery was implemented on 2026-08-12:

- A source-level contract test now rejects frontend `invoke` calls without registered Rust handlers.
- Dead V1 tag helpers and the excluded Vault action were removed.
- Startup manages schema status independently and exposes an exact-confirmation reset screen for legacy/unsupported databases.
- Tray, close-to-tray, shortcut toggle, single-instance, deep-link, autostart, updater, filesystem and Windows decorum integrations are registered through V2 host boundaries.
- Updater, tray-label, show-window and development OAuth callback commands are restored.
- The search bar now consumes `get_text_embedding_status` and V2 embedding events directly.

These paths pass automated checks but still require the documented Windows/macOS/Linux desktop smoke gates before their parity status becomes final.

## Scope and conclusion

ClipsX V2 is a substantial architectural implementation, not an empty rewrite. Its canonical history model, multi-representation capture, managed binary storage, derived facets/artifacts, renderer resolver, output policies, transformations, search projection, Ollama provider layer, retention, and extension runtime are real and generally aligned with the intended architecture.

The main gap is at the application boundary:

- The previously identified frontend/Rust command drift is now guarded and resolved.
- Desktop lifecycle integrations are implemented and await cross-platform smoke validation.
- The V2 renderer contract is converted back into the old preview shape through a lossy adapter.
- Several settings are persisted but have no runtime effect.
- OCR, semantic search, transforms, and extensions have backend layers without complete user workflows.
- Platform reconstruction is insufficiently verified for a clipboard-fidelity product.
- Component tests still mock IPC and cannot prove native plugin behavior; the source-level contract test now prevents literal application-command drift, while installed desktop smoke remains required.

The current state is therefore:

> Strong V2 foundation + recovered application boundary + incomplete typed presentation and native validation.

This document is a behavioral baseline. It does not recommend restoring the V1 schema, `ClipItem`, legacy IPC, migrations, or the old hard-wired semantic model.

## Status categories

- **Parity** — useful V1 behavior is available end-to-end.
- **A: Lost V1 behavior** — should be restored through V2 contracts.
- **B: Partial migration** — relevant layers exist, but the workflow is incomplete.
- **C: Intentional difference** — deliberate architectural or product change.
- **D: New V2 work** — did not exist in V1.
- **E: Deferred/excluded** — outside the present target.

## V1 versus V2 capability matrix

| Area | V1 behavior | Current V2 behavior | Status | Direction |
|---|---|---|---|---|
| History browsing | Paginated list, selection, favorites, pins, tag filters | V2 history/search and store workflows implement these paths | Parity | Preserve and add desktop-level regression coverage. |
| Notes and tags | Editable and searchable | Mutations refresh the derived search document and embedding jobs | Parity | Preserve the mutation/projection contract. |
| Favorites, pins, deletion | Reachable from history and actions | Typed V2 commands and scopes | Parity | Preserve. |
| Keyboard history navigation | Arrow navigation, activation, search focus and deletion shortcuts | Most retained behavior and frontend tests remain | Mostly parity | Verify in a real desktop window. |
| Capture/history model | One content-type-oriented `ClipItem` | Multi-representation clips, typed children, managed files and recovery | C / improved | Keep V2 exclusively. |
| Clipboard monitoring | Multi-format monitoring, exclusions and limits | Filters, source-app exclusions, dedupe, self-write suppression and retention | Mostly parity | Add platform fixture and restart-fidelity validation. |
| Copy/output selection | Copy current clip/content | Original/plain/transformed output policies are renderer-independent | C / improved | Preserve the V2 policy model. |
| Quick paste | Windows/macOS target-app paste | Windows/macOS/Linux paths exist; macOS permission UX is missing | B / A | Restore permission diagnosis and target-focus tests. |
| Renderer selection | Content type selected a specialized preview | Resolver selects views per representation/facet; selection is ephemeral | C / improved foundation | Complete the presentation boundary. |
| Alternate views/raw data | Not a central V1 abstraction | Representation tabs, extension fallback and raw inspector | D | Preserve and harden. |
| Specialized previews | URL, email, color, JSON, Markdown, code, date, path, JWT, etc. | Most old components remain reachable through V2 conversion | B | Add lossless typed presentation coverage. |
| Table/CSV | Structured rows and delimiter-aware actions | Table rows are flattened to tab-separated text | A / B | Add a native table presentation path. |
| Rich text/RTF | Formatted preview and text fallback | Raw RTF is presented as plain text | A / B | Implement safe RTF-derived presentation/artifact handling. |
| HTML | Formatted preview | Safe renderer exists but has a restrictive allowlist | B | Expand policy deliberately; never restore unsafe raw HTML injection. |
| Office/native formats | Best HTML/text/SVG/image view plus native handling | Native representation is retained, but native renderer mainly shows format/size | A / B | Fix resolver ordering and Office presentation. |
| Images/OCR | Image preview plus OCR state/text | Image preview works; UI hardcodes `ocrStatus: not_needed` | A / B | Surface OCR lifecycle and results. |
| OCR runtime | Automatic image/Office OCR | macOS/Linux artifact pipeline; Windows unavailable | B | Complete Windows support or narrow the documented matrix. |
| Files | File list with stat/media metadata and open actions | Paths/opening exist; UI fabricates zero metadata | A / B | Supply typed metadata or stop displaying false values. |
| Action toolbar | Copy, favorite, pin, delete, editor and content actions | Base toolbar retained; copy uses V2 output policy | Mostly parity | Add per-content integration tests. Vault remains excluded. |
| Preview-local menus | URL/code/CSV and other contextual operations | Retained through action registry | Mostly parity | Preserve as preview-local actions. |
| Transformations | Content-specific derived-copy actions | Typed transformers, cache, copy/paste/save and provenance exist | B + D | Complete preview, parameters, source selection and error states. |
| FTS search and filters | Text search, filters and semantic state | FTS, tag/scope filters and broader slash filters | Parity / improved | Preserve and test. |
| Semantic search | Hard-wired local model workflows | Ollama provider, spaces, chunks, jobs and status backend | B / C | Add configuration and lifecycle UI. |
| Semantic recall | Model search | Hybrid path currently fuses FTS candidates only | B / decision | Decide whether semantic-only recall is required. |
| Settings | Runtime settings, import/export, updater and clear behaviors | Import/export, updater and autostart plugins are restored; periodic auto-clear remains incomplete | B | Complete remaining runtime effects through V2 services. |
| Defaults | Platform shortcut defaults and established capture limits | Platform-aware shortcut is restored; V2 currently allows 50 MB per representation | B / decision | Preserve the shortcut and document the size-limit decision. |
| Tray/window lifecycle | Tray menu, close behavior and shortcut toggle | Implemented through V2 host state; desktop smoke pending | B / validation | Validate on each supported desktop. |
| Single instance/deep links | Secondary launches and auth links routed to running app | Plugin and show/focus wiring restored | B / validation | Validate installed and development callback paths. |
| Updater | Release check and update UI | Plugin and `get_release_info` wiring restored | B / validation | Validate configured and unavailable builds. |
| Account/auth | Browser/local callback completion | Deep-link and bounded development loopback callback restored | B / validation | Validate OAuth on packaged macOS/Windows/Linux builds. |
| Factory reset | Not a V1 migration target | Incompatible startup now exposes exact-confirmation reset and restart | D / parity | Preserve fresh-schema policy and owned-path tests. |
| Extensions | No equivalent V2 WASM contribution system | Runtime, limits, quarantine, package service and registry exist | D / B | Finish developer/registry lifecycle and diagnostics. |
| Desktop validation | More extensive behavioral Rust coverage | Unit suites pass; no cross-platform desktop smoke suite found | B | Add contract and desktop integration gates. |

## High-impact UI and interaction differences

### Desktop bootstrap and command drift

The Tauri builder now registers the V2-required single-instance, deep-link, autostart, updater, filesystem, tray and Windows window-control integrations. The old clipboard-manager plugin was deliberately not restored because V2's platform adapter owns clipboard capture and reconstruction.

The previously missing tray-label, show-window, updater-info and local-auth commands are registered. The obsolete text-search status call was migrated to the V2 embedding status contract. A Rust test scans production TypeScript sources and fails when a literal application-owned command is absent from `generate_handler!`.

### Presentation bridge

`RenderModel` is translated into the legacy `Content` interface in [src/features/clipboard/V2ViewPanel.tsx:70](../src/features/clipboard/V2ViewPanel.tsx#L70). This preserves many existing components cheaply, but loses table structure, OCR state, file metadata and richer Office/native relationships. The bridge should not become the permanent universal presentation contract.

### Transform preview

[TransformMenu.tsx](../src/features/clipboard/TransformMenu.tsx) stores the returned preview model but does not render it. It supplies empty parameters and runs the selected transformer against the active view source, even when the transformer applies to a different representation.

### Search and settings

The search UI now queries `get_text_embedding_status` and listens to V2 embedding lifecycle events. Provider configuration, probing, reindexing and degraded-state recovery are still not a complete user workflow.

Settings for `auto_clear_minutes`, `clear_on_exit` and `auto_start` are persisted in [history/domain.rs:60](../src-tauri/src/history/domain.rs#L60). Explicit tray Quit applies `clear_on_exit`; autostart and import/export have their required plugins restored and await installed-build validation. Periodic `auto_clear_minutes` remains unimplemented.

## A. Lost V1 behavior backlog

The desktop-host items formerly listed here are implemented and now live in
the R1 validation gate. The remaining lost behavior is:

- macOS Accessibility permission explanation and recovery for paste.
- Runtime periodic auto-clear behavior.
- OCR state/result/failure UI.
- File size/date/media metadata presentation.
- Proper RTF and rich Office presentation.
- Structured table/CSV preview.
- Correct selection of useful Office alternates over opaque native detail.

## B. Partial migrations

- V2 renderer output to specialized React presentation.
- Exact clipboard reconstruction across restart and platforms.
- OCR platform coverage.
- Ollama configuration, status, semantic activation and recovery.
- Transform preview, parameters, source resolution and error handling.
- Extension developer/registry lifecycle.
- Settings persistence to runtime effects.
- Installed authentication callback validation.
- Desktop integration and accessibility validation.

## C. Intentional differences to retain

- Fresh V2 schema and explicit reset; no V1 migrations or dual reads.
- `Clip` with independent representations instead of one global `ClipItem` type.
- Typed canonical rows and managed binary files instead of generic BLOB/JSON metadata.
- Additive, source-provenanced facets and rebuildable artifacts.
- Renderer selection as ephemeral UI policy.
- Explicit original/plain/transformed output policies.
- Provider-based semantic search rather than the hard-wired V1 model.
- WASM extension isolation, quotas and quarantine.
- Normalized text where the documented byte contract permits it.
- Vault removal from the current parity scope.

## D. Genuine new V2 work

- Multiple representations and alternate renderer tabs.
- Raw representation inspector.
- Ambiguous/additive facet support.
- Transformer preview cache, saved-result provenance and derived clip creation.
- Managed binary staging, hashing, recovery and content sharing.
- Versioned search projections, embedding spaces, chunks and resumable jobs.
- Ollama as a replaceable text-embedding provider.
- Contribution resolver and extension override/fallback.
- Reviewed extension registry, WASM limits and quarantine.
- Linux X11 reconstruction and quick paste.
- Source-aware retention protecting pinned/favorite clips.

## E. Deferred or excluded

- Encrypted Vault and Vault entitlements.
- Remote sync.
- Previous hard-wired visual/model search.
- Local visual semantic search until it fits the provider architecture.
- Hosted providers beyond the current provider scope.
- Vision and generation workflows.

## Root-cause findings

### IPC contract drift is now guarded

React command strings and Rust's `generate_handler!` list previously drifted independently. A Rust source-level contract test now compares literal application-owned frontend invocations with registered handlers. Moving to generated typed clients remains a maintainability improvement, not a recovery blocker.

### Desktop bootstrap is one explicit host boundary

Tray, single-instance, deep links, autostart, updater and window behavior are implemented as thin V2 host integrations. Their remaining risk is native/plugin behavior in installed builds, tracked by R1 and [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md).

### The presentation contract is narrower than the retained preview contract

The V1-shaped `Content` adapter accounts for table, OCR, file metadata, Office and rich-text regressions. Adding fabricated fields to that adapter would perpetuate the problem.

### Backend implementation is being counted as product delivery

This affects semantic search, OCR, transformations, extensions and factory reset. Acceptance must be defined around a complete reachable workflow, not merely a command or service existing.

### Clipboard fidelity lacks executable acceptance fixtures

The architecture correctly emphasizes exact supported formats, but there is no desktop suite proving capture → persistence → restart → reconstruction. Platform-specific ordering, multi-file handling and native Office preference remain uncertain.

### Documentation now separates architecture from delivery

Earlier milestone language treated substantial backend code as product delivery. The documentation set now uses shared workflow statuses: [ARCHITECTURE.md](ARCHITECTURE.md) owns stable boundaries, [ROADMAP.md](ROADMAP.md) owns dependency order, [UI_PARITY.md](UI_PARITY.md) owns user-facing status, and [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) owns native evidence.

## Documentation decisions applied

1. Shell and specialized presentation status are separated: desktop integration is implemented with native validation pending, while the presentation path remains partial.
2. Note and tag mutations are documented as refreshing search projection and embedding work.
3. Tag names are documented as part of the FTS projection and tags remain available as SQL filters.
4. OCR status is platform-specific; Windows OCR is unavailable until implemented or explicitly removed from the release baseline.
5. Native capture promises are bounded to adapter-supported exact types. Unsupported unknown native types are skipped; no type is guessed.
6. M0–M5 are historical backend-foundation requirements. R0–R7 and the parity matrix determine product delivery.
7. The normative platform matrix remains unchanged until an adapter contract changes; current limitations and the evidence plan live in [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md).

## Exact next work: R2 typed presentation boundary

Implement these slices in order and keep the legacy bridge only as a temporary fallback:

1. Render every `RenderModel` variant directly in React with fixture coverage.
2. Preserve structured table cells and delimiter-aware table actions.
3. Carry real file metadata and ordered multi-file information without fabricated values.
4. Surface image/OCR lifecycle, extracted text, unsupported state, and failures.
5. Define safe HTML and RTF-derived presentation, then preserve Office alternate relationships and resolver ordering.
6. Move specialized previews onto typed `ClipPresentation` inputs and remove migrated branches from the lossy `Content` conversion.
7. Verify original/plain/transformed output remains independent of the selected renderer.

R2 exits only when its rows in [UI_PARITY.md](UI_PARITY.md) are verified; R3 platform fidelity follows.

## Dependency-aware recovery plan

### Phase 0 — Establish parity gates (implemented; desktop validation pending)

**Change:** Create a typed/generated frontend IPC client or command manifest; add a test that every application-owned frontend invocation resolves to a registered Rust command; define desktop smoke scenarios and clipboard fixtures; revise `UI_PARITY.md` statuses.

**Dependencies:** None.

**Validation:** Contract fixtures prove the test rejects missing command registrations and CI prevents future literal command drift. Every parity row names an executable acceptance test.

### Phase 1 — Restore desktop host integration (implemented; desktop validation pending)

**Change:** Reintroduce V2-compatible Tauri integration for tray, close/quit, updater, autostart, filesystem dialogs, deep links, single instance and Windows controls. Restore shortcut toggle behavior and platform defaults. Complete development and packaged auth callbacks. Make incompatible-schema startup expose reset/status before normal state construction.

**Dependencies:** Phase 0 command contract.

**Validation:** Windows/macOS/Linux smoke tests for launch, second launch, shortcut toggle, blur, close, tray reopen/quit, updater status, autostart, file dialog, deep link and reset from an incompatible-schema fixture.

### Phase 2 — Complete the typed presentation boundary

**Change:** Implement direct typed React presentations for text, tree, table, image, file list, rich text, Office/native, artifacts and unsupported binary. Retain useful V1 components behind lossless adapters. Carry OCR state, file metadata, table cells and representation relationships explicitly. Define safe HTML/RTF policy.

**Dependencies:** Phase 0; Phase 1 improves desktop validation.

**Validation:** Render-model fixtures and component tests for CSV, RTF, HTML, Office bundles, images with OCR, multi-file lists and unsupported binary. Assert no fabricated zero metadata and no unsafe markup execution.

### Phase 3 — Prove clipboard fidelity and output behavior

**Change:** Build fixtures from the platform matrix; test capture → files/database → restart → reconstruction; correct Windows Office ordering; verify supported wrapper regeneration; fix/document macOS ordered multi-file handling; restore macOS Accessibility UX; test original/plain/transformed Copy/Paste independently of active view.

**Dependencies:** Phases 1 and 2.

**Validation:** Native desktop tests for supported formats, negative tests for unsupported formats, restart fidelity, source-app focus restoration, self-write suppression and paste diagnostics. Continue using `[RECONSTRUCT]` logs.

### Phase 4 — Finish search, OCR and settings workflows

**Change:** Complete Ollama configuration, probe, enable/disable, progress, reindex/clear and degraded-state UI on the existing V2 embedding status path; decide semantic-only recall policy; surface OCR lifecycle; complete or narrow Windows OCR; implement periodic auto-clear; validate clear-on-exit, import/export, autostart and updater in installed builds; confirm defaults.

**Dependencies:** Phases 1–3.

**Validation:** Fake-Ollama end-to-end tests, note/tag reindex tests, OCR lifecycle tests, settings restart tests and actual OS clipboard clear/exit tests.

### Phase 5 — Finish transformations and contextual actions

**Change:** Render transform preview models; resolve transformers against applicable representations; add schema-driven parameters; provide busy/failure/retry/expired states; consolidate duplicated content-specific transforms where it improves consistency.

**Dependencies:** Phases 2 and 3.

**Validation:** Per-transform fixtures, parameter tests, alternate-representation selection, cache expiry, provenance, saved-result restart behavior and copy/paste equivalence tests.

### Phase 6 — Complete the extension product workflow

**Change:** Finish registry refresh, local/developer installation, developer-mode controls and diagnostics. Expose quarantine/recovery and compatibility failures clearly. Exercise extension renderers and transformers through the same presentation/output paths as built-ins.

**Dependencies:** Phases 2 and 5.

**Validation:** Signed/invalid/incompatible packages, quotas/timeouts, quarantine, recovery, enable/disable/uninstall, renderer fallback and transformer output tests.

### Phase 7 — Release parity validation and documentation reconciliation

**Change:** Run the full parity matrix on Windows, macOS and Linux X11. Update architecture, roadmap, platform matrix and parity documents from test results. Remove unreachable legacy frontend APIs/types only after their consumers migrate. Make release acceptance depend on the desktop suite.

**Dependencies:** All prior phases.

## Verification performed

The following checks pass after Desktop Boundary Recovery:

- `npm run type-check`
- `npm run lint`
- `npm test -- --run` — 24 files, 155 tests
- `cargo test --manifest-path src-tauri/Cargo.toml --all-features --bin clipsx` — 32 tests
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

These results do not prove desktop parity. The source-level IPC contract, recovery UI and host composition are automated, but tray/window/deep-link/autostart/updater behavior still needs interactive Windows/macOS/Linux smoke coverage.
