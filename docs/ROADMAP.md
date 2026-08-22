# ClipsX roadmap

This roadmap contains only work that remains. Completed behavior belongs in [ARCHITECTURE.md](ARCHITECTURE.md); detailed installed-build certification remains in [RELEASE.md](RELEASE.md).

## Current priorities

1. Certify native clipboard and desktop behavior in installed builds.
2. Certify parameter-driven transforms and extension contribution UX in installed builds.
3. Harden local search, OCR, and settings workflows.
4. Ship only after the release matrix and signing gates are complete.

## Remaining work

### Native and release certification

- Run the Windows, macOS, and Linux/X11 fixture matrices in installed builds: capture, restart, reconstruction, Original/Plain Text output, target-application paste/focus, accessibility, tray/window behavior, shortcuts, autostart, updater, deep links, OAuth callback, dialogs, packages, and signing.
- Validate macOS OCR and Linux OCR lifecycle/retry in installed builds. Windows OCR is intentionally unsupported in the current baseline and must remain explicitly reported as such unless it is separately implemented.
- Execute the shared recovery, renderer, transform, extension, and accessibility checks in [RELEASE.md](RELEASE.md).

**Exit gate:** signed artifacts from one revision pass every applicable release-matrix check, and unsupported capabilities are excluded from product claims.

### Search, OCR, and settings hardening

- Validate configured, disabled, indexing, degraded, recovery, semantic-only recall, filter, fusion, cursor, and source-fallback flows in installed builds.
- Complete English/Japanese localization and accessibility coverage for the Intelligence workflow and search-source controls.
- Document and expose Linux Tesseract dependency diagnosis/recovery.
- Implement the periodic `auto_clear_minutes` worker with safe cancellation and reset semantics.
- Resolve the conflicting representation-size defaults: 10 MiB in the frontend reset defaults versus 50 MiB in the Rust capture default; document and test one product default.
- Validate settings import/export, autostart, clear-on-exit, updater, account callback, and restart effects.

**Exit gate:** users can configure, understand, recover, and disable local search/OCR/settings without logs or storage edits; all retained settings have their documented runtime effect.

### Transform completion

- Show the source representation used by each transform and complete loading, error, retry, cancellation, and expired-result states.
- Prove preview, Copy, Paste, and Save as New Clip consume identical cached bytes and preserve provenance.
- Complete keyboard-first discovery, accessibility coverage, and remaining CSV/code/content-specific operations that belong as contextual actions.

**Exit gate:** every built-in transformer has source-selection, parameter, failure, restart, cache-expiry, provenance, and byte-equivalence tests.

### Extension product completion

- Certify registry refresh, compatibility, and manual update UX in installed builds; complete richer package/contribution diagnostics and provenance for failure and recovery.
- Add installed end-to-end automation for the Ask AI, Ask Local AI, Mermaid Viewer, and Text API fixtures.
- Cancel an in-flight capability-backed HTTPS or generation request when its action, dialog, or extension view closes, and prove cancellation leaves no reusable invocation state.

**Exit gate:** a user can safely install, inspect, use, diagnose, recover, update, disable, and remove a compatible package; invalid or failing packages cannot affect canonical clips.

## Post-release candidates

These are not release requirements:

- trusted local visual semantic search through the registered source/provider boundary;
- hosted or OpenAI-compatible providers with explicit consent;
- additional local or hosted generation providers and generated artifacts; the
  host-owned Ollama text-generation adapter is already delivered;
- layout-aware OCR once artifacts expose page/layout contracts;
- AST code chunking after language detection and supported-language policy are designed;
- user-configurable search weights or new input kinds.
- approximate nearest-neighbor search when an active space exceeds 50,000 chunks or local ranking p95 exceeds 100 ms, excluding provider latency; evaluate official SQLite `vec1` only when testing and Windows/macOS/Linux packaging are release-ready.

Every candidate requires a separate design covering privacy, storage, provider/contribution boundary, UX, tests, and reset/rebuild behavior.

## Delivery principles

- Preserve independent raw representations before deriving meaning or previews.
- Keep canonical mutations independent from optional derived work.
- Keep renderer selection out of persisted clip state and clipboard output policy.
- Prefer explicit unsupported states to guessed native formats or silent hosted fallback.
- Treat search indexes, embeddings, previews, OCR, and generated output as rebuildable or versioned data.
- Keep providers host-owned and extensions sandboxed, offline by default, and capability-limited.
- Keep release claims narrower than unverified installed behavior.

## Legacy V1 reference

The read-only reference is `archive/v1-pre-m0`, commit `d9f1392`, and tag `v1-pre-m0-reference`.

Use it only for visual behavior, keyboard interaction, accessibility, tests, and platform format discovery:

```powershell
git show archive/v1-pre-m0:src/features/clipboard/ClipboardHistory.tsx
git diff archive/v1-pre-m0 -- src/features
```

Do not restore V1 schemas, IPC payloads, sparse metadata, semantic-model services, Vault/entitlement coupling, or compatibility behavior. V2 keeps the fresh domain-prefixed schema and explicit reset flow.
