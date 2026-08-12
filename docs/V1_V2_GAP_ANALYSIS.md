# ClipsX V1 → V2 Gap Analysis and Recovery Plan

**Status:** Reconciled baseline; R0 and R2 verified automated, R1 implemented with desktop validation pending, R3 next
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

Typed Presentation Boundary Recovery was also completed on 2026-08-12:

- Rust and TypeScript share a lossless camelCase `RenderModel` wire contract and exhaustive OCR-state union.
- One exhaustive React dispatcher renders every model directly; the detailed preview no longer depends on legacy `Content` conversion.
- Tables, trees, key/value data, file references, semantic payloads, Office alternates, safe HTML/RTF, and OCR lifecycle state have model/component fixtures.
- Copy remains clip-ID/output-policy based and is independent of the selected renderer.

## Scope and conclusion

ClipsX V2 is a substantial architectural implementation, not an empty rewrite. Its canonical history model, multi-representation capture, managed binary storage, derived facets/artifacts, renderer resolver, output policies, transformations, search projection, Ollama provider layer, retention, and extension runtime are real and generally aligned with the intended architecture.

The main gap is at the application boundary:

- The previously identified frontend/Rust command drift is now guarded and resolved.
- Desktop lifecycle integrations are implemented and await cross-platform smoke validation.
- The typed presentation boundary is recovered and guarded by exhaustive model fixtures.
- Several settings are persisted but have no runtime effect.
- OCR, semantic search, transforms, and extensions have backend layers without complete user workflows.
- Platform reconstruction is insufficiently verified for a clipboard-fidelity product.
- Component tests still mock IPC and cannot prove native plugin behavior; the source-level contract test now prevents literal application-command drift, while installed desktop smoke remains required.

The current state is therefore:

> Strong V2 foundation + recovered application and presentation boundaries + native clipboard validation next.

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
| Renderer selection | Content type selected a specialized preview | Resolver selects views per representation/facet; selection is ephemeral and output-policy independent | C / improved | Preserve the typed boundary. |
| Alternate views/raw data | Not a central V1 abstraction | Representation tabs, extension fallback and raw inspector | D | Preserve and harden. |
| Specialized previews | URL, email, color, JSON, Markdown, code, date, path, JWT, etc. | Typed models and validated semantic payloads drive direct specialized presentations | Parity automated | Preserve; finish transform-specific actions in R5. |
| Table/CSV | Structured rows and delimiter-aware actions | Structured columns/cells render directly | Presentation parity | Finish delimiter-aware transform actions in R5. |
| Rich text/RTF | Formatted preview and text fallback | Bounded guarded RTF parsing emits a minimal safe tag set with escaped fallback | Parity automated | Preserve security fixtures. |
| HTML | Formatted preview | Host-sanitized HTML renders in a sandboxed iframe | Parity automated | Preserve sanitizer and sandbox fixtures. |
| Office/native formats | Best HTML/text/SVG/image view plus native handling | Useful alternates are ranked ahead of opaque detail while exact identity remains available | Presentation parity | Prove native reconstruction in R3. |
| Images/OCR | Image preview plus OCR state/text | Full typed OCR lifecycle, empty success, safe failure, retry, and targeted refresh | Presentation parity | Finish platform runtime coverage in R4/R7. |
| OCR runtime | Automatic image/Office OCR | macOS/Linux artifact pipeline; Windows unavailable | B | Complete Windows support or narrow the documented matrix. |
| Files | File list with stat/media metadata and open actions | Ordered path/name references and recoverable open failures; unavailable metadata is omitted | Presentation parity | Prove native ordered reconstruction in R3. |
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

### Typed presentation boundary

The detailed V2 preview passes `RenderModel` directly to one exhaustive React dispatcher. Structured values remain structured, semantic payloads are validated at specialization boundaries, OCR and file-reference state are explicit, and HTML/RTF stay inside the documented safety boundary. Unrelated legacy `Content` consumers remain isolated until their own migration is justified.

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

## B. Partial migrations

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

### The presentation contract is now explicit and exhaustive

The V1-shaped `Content` adapter was removed from the detailed V2 preview. Rust/TypeScript contract fixtures and an exhaustive React dispatcher now prevent silent table, OCR, file, Office, and rich-text degradation.

### Backend implementation is being counted as product delivery

This affects semantic search, OCR, transformations, extensions and factory reset. Acceptance must be defined around a complete reachable workflow, not merely a command or service existing.

### Clipboard fidelity lacks executable acceptance fixtures

The architecture correctly emphasizes exact supported formats, but there is no desktop suite proving capture → persistence → restart → reconstruction. Platform-specific ordering, multi-file handling and native Office preference remain uncertain.

### Documentation now separates architecture from delivery

Earlier milestone language treated substantial backend code as product delivery. The documentation set now uses shared workflow statuses: [ARCHITECTURE.md](ARCHITECTURE.md) owns stable boundaries, [ROADMAP.md](ROADMAP.md) owns dependency order, [UI_PARITY.md](UI_PARITY.md) owns user-facing status, and [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) owns native evidence.

## Documentation decisions applied

1. Shell and specialized presentation status are separated: desktop integration is implemented with native validation pending, while typed presentation is verified automated.
2. Note and tag mutations are documented as refreshing search projection and embedding work.
3. Tag names are documented as part of the FTS projection and tags remain available as SQL filters.
4. OCR status is platform-specific; Windows OCR is unavailable until implemented or explicitly removed from the release baseline.
5. Native capture promises are bounded to adapter-supported exact types. Unsupported unknown native types are skipped; no type is guessed.
6. M0–M5 are historical backend-foundation requirements. R0–R7 and the parity matrix determine product delivery.
7. The normative platform matrix remains unchanged until an adapter contract changes; current limitations and the evidence plan live in [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md).

## Exact next work: R3 clipboard fidelity and output

1. Build executable native fixtures from [platform-format-matrix.json](platform-format-matrix.json).
2. Prove supported representations survive capture, managed-file persistence, process restart, and reconstruction byte-for-byte where required.
3. Verify ordered multi-file capture/reconstruction and supported Office/native wrapper regeneration without guessed native identifiers.
4. Test Original and Plain Text copy independently of every active view; keep transformed-byte equivalence in R5.
5. Validate target-app focus restoration, synthetic paste, permissions, self-write suppression, and recoverable diagnostics on Windows, macOS, and Linux/X11.
6. Restore the macOS Accessibility diagnosis/recovery workflow and document any platform limitations found by fixtures.

R3 exits only when its native fixture and installed-desktop gates pass; backend reconstruction code alone is insufficient.

## Dependency-aware recovery plan

### Phase 0 — Establish parity gates (implemented; desktop validation pending)

**Change:** Create a typed/generated frontend IPC client or command manifest; add a test that every application-owned frontend invocation resolves to a registered Rust command; define desktop smoke scenarios and clipboard fixtures; revise `UI_PARITY.md` statuses.

**Dependencies:** None.

**Validation:** Contract fixtures prove the test rejects missing command registrations and CI prevents future literal command drift. Every parity row names an executable acceptance test.

### Phase 1 — Restore desktop host integration (implemented; desktop validation pending)

**Change:** Reintroduce V2-compatible Tauri integration for tray, close/quit, updater, autostart, filesystem dialogs, deep links, single instance and Windows controls. Restore shortcut toggle behavior and platform defaults. Complete development and packaged auth callbacks. Make incompatible-schema startup expose reset/status before normal state construction.

**Dependencies:** Phase 0 command contract.

**Validation:** Windows/macOS/Linux smoke tests for launch, second launch, shortcut toggle, blur, close, tray reopen/quit, updater status, autostart, file dialog, deep link and reset from an incompatible-schema fixture.

### Phase 2 — Complete the typed presentation boundary (verified automated)

**Change:** Direct typed React presentations now cover text, tree, table, image, file list, rich text, Office/native, semantic and unsupported models. OCR state, ordered file references, table cells and representation relationships are explicit; unavailable file metadata is omitted. HTML/RTF follow bounded sanitizer/parser policies.

**Dependencies:** Phase 0; Phase 1 improves desktop validation.

**Validation:** Rust wire/security/resolver tests and React table-driven fixtures cover RTF, HTML, Office bundles, OCR lifecycle/retry/events, multi-file lists, semantic fallback, unsupported binary, extension fallback, raw inspection, sandboxing, and renderer-independent Copy policy.

### Phase 3 — Prove clipboard fidelity and output behavior

**Change:** Build fixtures from the platform matrix; test capture → files/database → restart → reconstruction; correct Windows Office ordering; verify supported wrapper regeneration; fix/document macOS ordered multi-file handling; restore macOS Accessibility UX; test original/plain/transformed Copy/Paste independently of active view.

**Dependencies:** Phases 1 and 2.

**Validation:** Native desktop tests for supported formats, negative tests for unsupported formats, restart fidelity, source-app focus restoration, self-write suppression and paste diagnostics. Continue using `[RECONSTRUCT]` logs.

### Phase 4 — Finish search, OCR and settings workflows

**Change:** Complete Ollama configuration, probe, enable/disable, progress, reindex/clear and degraded-state UI on the existing V2 embedding status path; decide semantic-only recall policy; validate the typed OCR lifecycle against supported platform runtimes and complete or narrow Windows OCR; implement periodic auto-clear; validate clear-on-exit, import/export, autostart and updater in installed builds; confirm defaults.

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
