# ClipsX roadmap

This document is the single source of truth for unfinished product work. It
combines the remaining parity gaps, delivery sequence, and acceptance criteria.
Completed recovery history is intentionally omitted; use Git history when that
context is needed.

Stable system boundaries live in [ARCHITECTURE.md](ARCHITECTURE.md). Packaging,
native test evidence, and publication gates live in [RELEASE.md](RELEASE.md).

## Current focus

Backend infrastructure for M1–M4 has landed ahead of schedule. The remaining
work is **frontend completeness** (Ollama configuration UI, transform parameters,
contextual actions) and **native testing** (installed-build validation across all
platforms). M1 native testing and M2 search/settings UI are the immediate
priorities; M3 transform completion and M4 extension developer workflow follow.

| Order  | Milestone                               | Status                                 |
| ------ | --------------------------------------- | -------------------------------------- |
| **M1** | Native clipboard reliability            | Backend complete; native testing needed |
| **M2** | Search, OCR, and settings workflows     | Backend complete; config UI missing    |
| **M3** | Transform studio and contextual actions | Infrastructure complete; UI incomplete |
| **M4** | Extension product workflow              | Runtime complete; developer UI missing |
| **M5** | Release certification                   | Depends on M1–M4 exit gates            |

## Remaining V1 → V2 gap ledger

This ledger is reconciled against the source and tests in the same revision.
The earlier `f941d4e` presentation-boundary audit remains represented, and the
newer native-fidelity work is reflected below. It lists only unresolved
differences; completed parity belongs in Git history rather than the active
roadmap.

| V1 capability or product expectation     | Current V2 baseline                                                                                                                                                         | Remaining gap                                                                                                                                     | Owner |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Desktop shell and keyboard interaction   | Shell, history interaction, tray/window commands, shortcuts, deep links, autostart, updater, OAuth callback, and Windows controls are wired and covered by automated tests. | Installed visual, focus, IME, accessibility, lifecycle, and plugin validation on every platform.                                                  | M1/M5 |
| Clipboard monitoring and preservation    | Multi-representation capture, exclusions, limits, deduplication, retention, managed files, self-write suppression, and restart fidelity fixtures exist.                      | Installed native fixtures must prove coherent platform capture and exact reconstruction.                                                          | M1    |
| Original and Plain Text output           | Output policies are explicit, renderer-independent, and covered through repository restart.                                                                                 | Prove native clipboard types and target-application behavior in installed builds.                                                                 | M1    |
| Quick paste                              | Windows, macOS, and Linux/X11 paths exist.                                                                                                                                  | Real target focus/paste tests and macOS Accessibility diagnosis/recovery are missing.                                                             | M1    |
| Office/native and file-list handling     | Exact identities, useful Office alternates, ordered references, Windows codecs, and managed-file restart fidelity are covered automatically.                                | Prove platform wrapper regeneration, native writeback, and ordered file behavior in installed builds.                                             | M1    |
| Desktop previews and specialized actions | Every host `RenderModel` renders directly through the typed presentation boundary.                                                                                          | Installed visual/accessibility smoke and remaining transform-oriented CSV/code actions.                                                           | M1/M3 |
| OCR                                      | Typed lifecycle/retry UI exists; macOS and Linux artifact paths exist; unavailable runtimes report unsupported.                                                             | Validate native runtimes, document Linux dependency recovery, and implement Windows OCR or exclude it from claims.                                | M2    |
| Semantic search                          | FTS, Ollama text-embedding spaces/jobs, hybrid cosine+RRF scoring, 8 IPC commands, status, and fallback exist. Indexing queue runs at startup and on capture.              | Add Ollama endpoint/model configuration UI, enable/disable, indexing progress, reindex, clear, degraded-state recovery, and diagnostics. Decide whether semantic-only recall beyond FTS candidates is required. | M2    |
| Runtime settings                         | Capture filters, retention, import/export, autostart, updater integration, and explicit-quit clear behavior have service paths. `auto_clear_minutes` is persisted.          | Implement periodic auto-clear background timer, validate restart/runtime effects in installed builds, and decide the representation-size default. | M2    |
| Transformations                          | Built-in transformer registry (12 transformers), parameter validation, 15-min expiring cache, output commands, provenance, and save-as-new-clip exist. `TransformMenu` surfaced in view panel. | Render exact previews through the typed renderer, generate parameter controls from contribution schemas, resolve the correct source, handle failures/expiry, and prove preview/Copy/Paste/Save byte equivalence. | M3    |
| Extensions                               | Extension API v2 provides isolated detectors, typed detail/compact renderers, local transformers, contextual actions, cached compact rows, app-local action shortcuts, package tooling, permission disclosure, quarantine, and the Color Tools example. | Complete registry update/compatibility UX, richer diagnostics, generated parameter controls, and the capability broker. | M4    |
| Release confidence                       | Automated Rust and React suites cover core contracts.                                                                                                                       | Signed installed builds and the full Windows/macOS/Linux matrix have not been certified.                                                          | M5    |

### Intentional V2 differences — not gaps

- V2 uses one clip with independent representations instead of a global
  `ClipItem` content type.
- The schema is fresh and reset-based; there are no V1 migrations, dual reads,
  or compatibility writes.
- Binary payloads use managed files and typed SQLite relationships, not generic
  BLOB/JSON metadata.
- Semantic facets are additive and rebuildable; renderer selection is ephemeral
  UI policy.
- External file size/timestamp/media metadata is omitted when unavailable; the
  UI never stats references merely for presentation or fabricates zero values.
- HTML and RTF remain inside the V2 sanitizer/parser boundary; unsafe V1-style
  raw markup execution is not a parity target.
- Vault, entitlement coupling, the hard-wired visual model, and remote sync are
  outside the current release scope. Any return must use new approved V2
  boundaries.

## Delivery principles

- A backend service is not delivered until its complete desktop workflow is
  reachable, recoverable, and tested.
- Native behavior is verified in installed builds, not inferred from unit tests
  or `cargo run`.
- Original, Plain Text, and transformed output are independent of the active
  renderer.
- Unsupported native types are observed without reading or storing their bytes
  according to the executable [platform capability matrix](platform-format-matrix.json)
  and [JSON Schema](platform-format-matrix.schema.json); never guess a UTI, OLE
  type, registered clipboard format, MIME type, or X11 target.
- New work must not restore V1 persistence, IPC, or compatibility behavior.

## M1 — Native clipboard reliability

Prove that canonical representations survive the complete native lifecycle on
Windows, macOS, and Linux/X11.

### Remaining work

- Run the native fixture sequence in [RELEASE.md](RELEASE.md) for text, HTML,
  RTF, raster images, PDF, SVG, ordered file lists, Office/native formats, and
  unsupported inputs on every advertised platform.
- On Windows, prove same-application editable round trips for Word selections
  and tables, Excel formulas/formatting, and PowerPoint shapes and slides after
  restarting ClipsX; keep private OLE/control noise diagnostic-only.
- Verify platform wrapper regeneration and exact native identifier writeback
  in installed builds, including macOS ordered file URLs.
- Validate focus restoration, synthetic paste, permission failures, self-write
  suppression, and recoverable diagnostics in real target applications.
- Add macOS Accessibility diagnosis and recovery for quick paste.
- Validate retained shell behavior: themes, localization, title dragging,
  sidebar/split-preview layout, history keyboard navigation, search focus, IME,
  and screen-reader operation.
- Validate installed desktop integration: tray, shortcut toggle, close-to-tray,
  explicit quit, second instance, deep links, OAuth callback, autostart,
  updater states, file dialogs, and Windows window controls.

### Exit gate

The shared and platform-specific evidence in [RELEASE.md](RELEASE.md) passes on
all advertised platforms. Any unsupported capability is explicitly excluded
from product claims.

## M2 — Search, OCR, and settings workflows

Turn the existing service layers into complete, understandable desktop
workflows.

### Work

- Add Ollama endpoint/model configuration, capability probing, enable/disable,
  indexing progress, reindex, clear, degraded-state recovery, and diagnostics.
- Decide whether semantic-only recall beyond the FTS candidate page is required;
  document and test the chosen behavior.
- Validate OCR pending/running/ready-empty/ready-text/unsupported/failed/retry
  behavior against each supported platform runtime.
- Implement Windows OCR or explicitly exclude it from the supported baseline.
- Document Linux OCR dependency detection and recovery when Tesseract is absent.
- Implement periodic `auto_clear_minutes` with safe cancellation and reset
  semantics.
- Validate `clear_on_exit`, settings import/export, autostart, updater, and
  account callback behavior after restart in installed builds.
- Decide and document the default representation-size limit.

### Exit gate

Users can configure, understand, recover, and disable search/OCR features
without inspecting logs or editing storage, and every retained setting has its
documented runtime effect.

## M3 — Transform studio and contextual actions

Complete the user-facing workflow for explicit byte-producing transformations.

### Work

- Render the exact cached transform preview through the reusable typed renderer.
- Resolve each transformer against the applicable source representation and
  disclose that source to the user.
- Generate parameter controls from contribution schemas with validation and
  defaults.
- Add loading, failure, retry, cancellation, and expired-result states.
- Ensure preview, Copy, Paste, and Save as New Clip reuse identical cached
  output bytes and provenance.
- Migrate remaining CSV/code/content-specific operations to typed contextual
  actions where they are not better represented as transformations.
- Add keyboard-first transform discovery and accessibility coverage.

### Exit gate

Every built-in transformer has source-selection, parameter, error, provenance,
restart, cache-expiry, and byte-equivalence tests.

## M4 — Extension product workflow

Make the isolated extension runtime usable without weakening its host boundary.

### Work

- Complete registry refresh, reviewed installation, update, enable/disable,
  uninstall, and compatibility reporting.
- Add local package installation in Developer Mode with persistent warnings.
- Expose contribution diagnostics, bounded errors, quarantine state, recovery,
  and package provenance.
- Maintain the Extension API v2 typed-presentation and contextual-action contract.
- Complete registry update/compatibility UX and richer contribution diagnostics.
- Generate transformer/action parameter controls from declared schemas.
- Add end-to-end installed package fixtures beyond the buildable Color Tools example.
- Implement the audited HTTP/credential broker only for explicit actions and
  capability-backed transformers. Detectors and renderers stay permanently offline.
- Keep raw filesystem, clipboard, history, database, shell, environment,
  credential values, provider handles, and frontend-code access prohibited.

### Exit gate

A user can safely install, inspect, use, diagnose, recover, update, and remove a
compatible package. Invalid or failing packages cannot damage canonical clips
or block built-in contributions.

## M5 — Release certification

Produce signed installed artifacts from one reviewed revision and execute the
complete [release checklist](RELEASE.md).

### Exit gate

All advertised Windows, macOS, and Linux/X11 workflows have recorded evidence;
known limitations appear in release notes; update/install/rollback behavior is
verified; no required release gate remains open.

## Post-release feature candidates

These are not part of the current release claim. Promote one into a scoped
milestone only after its privacy model, storage impact, provider boundary, UX,
and acceptance tests are approved.

- Local visual semantic search through a replaceable multimodal provider.
- Opt-in hosted embedding or generation providers with explicit transmission
  consent and credential isolation.
- User-invoked vision/generation with versioned artifact provenance.
- Encrypted Vault behavior without reviving the V1 schema or entitlement model.
- Remote clipboard sync with end-to-end encryption and explicit device trust.
- Wayland support with a separately tested clipboard and focus contract.

## Legacy V1 reference

The pre-redesign implementation is preserved read-only at branch
`archive/v1-pre-m0`, commit `d9f1392`, and tag `v1-pre-m0-reference`.

It may be consulted for visual behavior, keyboard interaction, accessibility,
tests, and native-format discovery:

```bash
git show archive/v1-pre-m0:src/features/clipboard/ClipboardHistory.tsx
git diff archive/v1-pre-m0 -- src/features
```

Do not copy its schema, `ClipItem`, sparse metadata, IPC payloads, migrations,
semantic-model services, Vault/entitlement coupling, or compatibility
reads/writes. Native-format observations must be revalidated against the V2
representation contract and platform matrix.
