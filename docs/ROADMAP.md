# ClipsX roadmap

This roadmap contains only unfinished work. Completed behavior belongs in [ARCHITECTURE.md](ARCHITECTURE.md). Product navigation and settings ownership are defined in [PRODUCT_STRUCTURE.md](PRODUCT_STRUCTURE.md). Installed-build certification remains in [RELEASE.md](RELEASE.md).

## 1. Product structure and interaction

- Restructure Intelligence into Overview, Search, Models, Indexing, and OCR. Remove unrelated extension status and avoid permanent sections for unavailable future features.
- Restructure Extensions into Installed, Discover, Built-ins, and Developer. Add package detail routes with Overview, Settings, Permissions, Actions, and Diagnostics.
- Move app and built-in shortcuts to a Keyboard settings section. Keep package action shortcuts on that package's Actions page.
- Replace hard-coded command handling with a command registry and complete the shortcut coverage/conflict audit documented in [PRODUCT_STRUCTURE.md](PRODUCT_STRUCTURE.md).
- Add an accessible draggable history/preview separator, keyboard resizing, reset behavior, sensible minimum widths, and a persisted device-local ratio.
- Complete English/Japanese localization, keyboard traversal, focus behavior, responsive layout, and accessibility for the changed surfaces.

**Exit gate:** every setting and status has one predictable owner; users can locate it from its task/domain without scanning unrelated sections.

## 2. Settings correctness and data integrity

- Inventory every visible setting and prove its persistence, validation, immediate/restart effect, reset behavior, import/export behavior, and error state.
- Implement the periodic `auto_clear_minutes` worker with safe cancellation and reset semantics.
- Resolve the conflicting representation-size defaults: 10 MiB in frontend reset defaults versus 50 MiB in the Rust capture default; document and test one product default.
- Validate autostart, clear-on-exit, updater, account callback, provider changes, package settings, shortcuts, and restart effects.
- Re-key retained extension preferences by stable package ID instead of an install-row ID. On uninstall, remove grants and credentials, then let the user retain or delete non-secret settings and shortcuts.
- Add cascade/invalidation tests for delete, clear, retention, note edits, tag edits/deletion, OCR completion, extraction changes, and extension update/removal. Include managed-file retries and search/embedding refresh.
- Add a schema ownership check so new clip-owned derived tables cannot silently omit deletion behavior.

**Exit gate:** all retained settings have their documented effect, and every clip mutation leaves canonical, derived, relational, and managed-file state consistent.

## 3. Configuration sync

- Add authenticated profile sync for the exact first-release boundary in [PRODUCT_STRUCTURE.md](PRODUCT_STRUCTURE.md): profile settings, extension installation intent/version/enablement, non-secret extension settings, and shortcuts.
- Define typed sync records, revisions, device identity, tombstones, deterministic record-level conflict resolution, retry/backoff, offline queuing, and account removal behavior.
- Keep device settings, clips, package archives, provider endpoints/models, credentials, extension grants/tokens, jobs, diagnostics, and derived data out of sync.
- Reinstall synchronized registry packages through normal checksum/signature/compatibility validation. Never transfer Developer Mode package paths or reuse external-data grants.
- Add Sync settings UI for status, last success, devices, pending/conflicted records, retry, disable, and remote-profile reset.
- Test first sign-in, second device, offline edits, concurrent edits, deletion, logout/login, package unavailable/incompatible states, corrupted remote data, and account deletion.

**Exit gate:** a second device can recover supported preferences, packages, and shortcuts without receiving secrets, local machine configuration, consent, or clipboard content.

## 4. Intelligence, transforms, and extensions hardening

- Validate configured, disabled, indexing, degraded, recovery, semantic-only recall, filter, fusion, cursor, and source-fallback flows in installed builds.
- Document and expose Linux Tesseract dependency diagnosis/recovery; validate macOS and Linux OCR lifecycle/retry. Keep Windows OCR explicitly unsupported unless separately implemented and certified.
- Show the source representation used by each transform and complete loading, error, retry, cancellation, and expired-result states.
- Prove transform preview, Copy, Paste, and Save as New Clip consume identical cached bytes and preserve provenance.
- Complete remaining CSV/code/content-specific operations that belong as contextual actions.
- Certify registry refresh, compatibility, manual updates, package diagnostics, provenance, and recovery in installed builds.
- Add installed end-to-end automation for Ask AI, Ask Local AI, Mermaid Viewer, and Text API fixtures.
- Cancel in-flight HTTPS or generation requests when an action, dialog, or extension view closes; prove no reusable invocation state remains.

**Exit gate:** local intelligence and package functionality can be configured, understood, diagnosed, recovered, disabled, and removed without logs or storage edits.

## 5. Extension authoring experience

- Make the extension CLI and templates the source of truth for scaffold, package, validate, test, and inspect workflows.
- Create a versioned ClipsX extension-authoring skill that calls those tools instead of duplicating the API contract.
- Cover declarative, WASM, custom detail/dialog UI, SVG theme variants, settings, permissions, actions, and provider-backed examples.
- Add a compatibility report that explains contract, host version, permission, asset, and runtime failures before installation.

**Exit gate:** a new extension can be scaffolded, validated, packaged, installed in Developer Mode, diagnosed, and prepared for registry submission from documented tooling.

## 6. Native and release certification

- Run the Windows, macOS, and Linux/X11 installed-build matrices for capture, restart, reconstruction, Original/Plain Text output, target-application paste/focus, accessibility, tray/window behavior, shortcuts, autostart, updater, deep links, OAuth callback, dialogs, packages, sync, and signing.
- Execute the shared recovery, renderer, transform, extension, search, settings, sync, and accessibility checks in [RELEASE.md](RELEASE.md).
- Polish the website in its own repository around an open-source-first product structure: clear value, local-first/security model, extension ecosystem, documentation, downloads, source, and contribution path. Keep pricing/paid features out of the initial information architecture until a separate product decision exists.
- Publish signed desktop artifacts, checksums, release notes, extension examples, documentation, and website downloads from one reviewed revision.

**Exit gate:** signed artifacts from one revision pass every applicable release check, the website makes only certified claims, and unsupported capabilities are absent from release messaging.

## Post-release candidates

- Clipboard-content sync.
- Trusted local visual semantic search through the registered source/provider boundary.
- Hosted or OpenAI-compatible providers with explicit consent.
- Additional generation providers and generated artifacts.
- Layout-aware OCR once artifacts expose page/layout contracts.
- AST code chunking after language detection and supported-language policy are designed.
- User-configurable search weights or new input kinds.
- Approximate nearest-neighbor search after scale or latency thresholds justify it and desktop packaging is proven.
- Paid website/product features after the open-source release and a separate entitlement/privacy design.

Every candidate requires a separate design covering privacy, storage, provider/contribution boundaries, UX, tests, and reset/rebuild behavior.

## Delivery principles

- Preserve independent raw representations before deriving meaning or previews.
- Keep canonical mutations independent from optional derived work.
- Keep renderer selection out of persisted clip state and clipboard output policy.
- Prefer explicit unsupported states to guessed native formats or silent hosted fallback.
- Treat search indexes, embeddings, previews, OCR, and generated output as rebuildable or versioned data.
- Keep providers host-owned and extensions sandboxed, offline by default, and capability-limited.
- Store settings as validated JSON values in SQLite; do not introduce a parallel live JSON file.
- Keep sync scope explicit and narrower than the local data model.
- Keep release claims narrower than unverified installed behavior.

## Legacy V1 reference

The read-only reference is `archive/v1-pre-m0`, commit `d9f1392`, and tag `v1-pre-m0-reference`.

Use it only for visual behavior, keyboard interaction, accessibility, tests, and platform format discovery:

```powershell
git show archive/v1-pre-m0:src/features/clipboard/ClipboardHistory.tsx
git diff archive/v1-pre-m0 -- src/features
```

Do not restore V1 schemas, IPC payloads, sparse metadata, semantic-model services, Vault/entitlement coupling, or compatibility behavior. V2 keeps the fresh domain-prefixed schema and explicit reset flow.
