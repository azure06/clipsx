# ClipsX production release re-alignment

This roadmap is the checkbox-driven program for the first production release. Completed stable behavior, including product navigation and settings ownership, belongs in [ARCHITECTURE.md](ARCHITECTURE.md), and installed-build evidence belongs in [RELEASE.md](RELEASE.md).

Every item starts unchecked. Mark an item `[x]` only after its acceptance criteria pass and the automated or installed-build evidence is linked from the relevant document or pull request.

## 1. Product correctness and security

- [ ] Finish Settings/Intelligence ownership, command registry, keyboard configuration, resizable layout, localization, and accessibility work already defined in [ARCHITECTURE.md](ARCHITECTURE.md#product-surfaces-and-settings-ownership).
- [ ] Verify every setting's persistence, validation, restart behavior, reset, import/export, and failure handling.
- [x] Implement periodic auto-clear, resolve the 10/50 MiB capture-default conflict, and finish extension uninstall settings retention. Evidence: [host privacy worker](../src-tauri/src/ipc/mod.rs), [secret-expiry test and 50 MiB default](../src-tauri/src/history/repository.rs), and identity-keyed settings in [migration 012](../src-tauri/migrations/012_extension_marketplace.sql).
- [ ] Complete cascade/invalidation coverage for clips, tags, notes, OCR, search, artifacts, extensions, and managed files.
- [ ] Remove raw note/content logging and audit every production log for clipboard data, credentials, tokens, and filesystem paths.
- [x] Replace the unrestricted asset-protocol scope with app-owned asset serving and tighten the main CSP, especially `script-src`. Evidence: [Tauri security configuration](../src-tauri/tauri.conf.json), clip-bound bounded raster preview IPC in [ipc/mod.rs](../src-tauri/src/ipc/mod.rs), and passing CSP/render tests.
- [ ] Add Rust dependency auditing, license/SBOM generation, secret scanning, and release artifact inspection to CI.
- [ ] **Exit gate:** all settings work, canonical data survives optional-feature failures, and the production security review has no unresolved high-severity findings.

## 2. Cross-platform OCR

- [ ] Refactor OCR behind the existing provider contract with runtime availability, version, language, and recovery diagnostics.
- [x] Implement Windows OCR on a dedicated WinRT MTA executor using `Windows.Media.Ocr`; decode bounded image bytes, select installed user languages, and keep all work off the UI thread. Evidence: [native provider](../src-tauri/src/providers/native_ocr.rs), [bounded artifact input and generated-bitmap recognition test](../src-tauri/src/artifacts/host.rs); local Windows runtime/language and real recognition tests pass.
- [ ] Preserve macOS Vision OCR while adding explicit language selection, bounded execution, and real installed-build tests.
- [ ] Harden Linux Tesseract discovery using direct process invocation, expose detected version/languages, document `.deb` dependencies, and provide actionable AppImage recovery instructions.
- [ ] Move OCR execution to a bounded background queue with cancellation, retry, enable/disable, and reprocessing when provider/language configuration changes.
- [x] Correct the provider registry so Windows/Linux availability reflects runtime truth rather than always reporting native OCR as available. Evidence: [async dynamic provider registry](../src-tauri/src/providers/registry.rs) backed by the native provider's real engine/language diagnostics.
- [x] Bump OCR producer provenance so stale derived artifacts rebuild without touching canonical images. Evidence: OCR producer version 3 includes engine version and selected language in [artifact host](../src-tauri/src/artifacts/host.rs); queue lifecycle tests verify canonical image checksums remain unchanged.
- [ ] Verify empty success, failure, unsupported, retry, deletion, indexing, FTS, semantic search, English, and Japanese flows on all advertised platforms.
- [ ] **Exit gate:** Windows, macOS, and Linux/X11 pass the installed OCR lifecycle; Linux clearly recovers when Tesseract or language data is absent.

Implementation candidate: the provider contract, persistent single-flight queue,
configuration sync, Intelligence controls, native language diagnostics, bounded
inputs, cancellation/stale-result rejection, FTS refresh, and CI language-package
setup are implemented. Their boxes remain unchecked until the three-platform CI
run and installed-candidate evidence required above are recorded.

## 3. Configuration sync and account completion

Restore and audit the existing inactive `clipsx` Supabase project, then perform development on a branch before promoting migrations.

- [ ] Inventory the restored project's Auth configuration, redirects, schema, grants, migrations, and security/performance advisors.
- [ ] Use desktop PKCE and secure credential storage already present; finish and certify the hosted `/auth/desktop/callback` bridge.
- [ ] Add RLS-protected `sync_devices` and `sync_records` tables. Records carry typed kind/key/payload, tombstone, source device, hybrid logical revision, and monotonic server cursor.
- [ ] Add a security-invoker batch RPC that derives `user_id` from `auth.uid()`, applies only deterministically newer revisions, and returns winning records. Revoke default access and grant only required authenticated operations.
- [ ] Synchronize only whitelisted profile data: theme/language, search behavior, renderer preferences, OCR preference/language, desired registry packages/version policy/enablement, non-secret package settings, and app/extension shortcuts.
- [ ] Keep clips, notes, tags, package archives, device capture/window settings, provider endpoints/models, credentials, grants, jobs, diagnostics, and all derived data local.
- [ ] Add transactional SQLite sync outbox/state tables so each local profile mutation and its pending sync record commit together.
- [ ] Implement startup, post-mutation, periodic, reconnect, and manual sync; support offline edits, deterministic conflicts, tombstones, backoff, and invalid remote-record quarantine.
- [ ] Reinstall synchronized extensions only through the signed registry and require fresh local consent for external capabilities.
- [ ] Replace placeholder Sync UI with status, last success, pending/error state, devices, retry, disable, remote-profile reset, and precise inclusion/exclusion information.
- [ ] Add verified account deletion through a JWT-protected backend function that deletes sync data and then the Auth user; sign-out keeps local data and stops sync.
- [ ] Test first device, second device, concurrent/offline edits, clock skew, deletion, logout/login, revoked device, unavailable package, corrupt payload, RLS isolation, remote reset, and account deletion.
- [ ] Run Supabase security/performance advisors and automated cross-user RLS tests before promotion. Supabase requires grants and owner-scoped RLS together on exposed tables. See the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [ ] **Exit gate:** a second device restores supported configuration and extension intent without receiving clipboard content, secrets, device configuration, or old consent.

## 4. Native packaging and production certification

- [x] Change release automation from every `main` push to a reviewed tag/manual candidate workflow that runs the full preflight on the exact release revision. Evidence: [release candidate workflow](../.github/workflows/release.yml); tag publication requires an exact version match and manual runs remain build-only.
- [ ] Build Windows x64, Linux x64 `.deb`/AppImage, and macOS arm64/x64. Intel support is limited to Apple-supported macOS releases; macOS 26 is Apple's final Intel release. See the [Apple release notes](https://developer.apple.com/documentation/macos-release-notes/macos-26_4-release-notes).
- [ ] Replace ad-hoc macOS signing with Developer ID signing, hardened runtime, notarization, stapling, and installed verification for both architectures.
- [ ] Sign Windows installers/executables and verify install, update, downgrade rejection, and uninstall on a clean machine.
- [ ] Verify Linux desktop integration, X11-only claims, Tesseract recovery, package dependencies, AppImage behavior, and updater support.
- [ ] Validate signed updater metadata and rollback/recovery behavior.
- [ ] Run the complete native clipboard, focus/paste, tray, shortcuts, autostart, deep-link, OAuth, accessibility, extension, sync, OCR, search, and recovery matrices in [RELEASE.md](RELEASE.md).
- [ ] Add a bundle-size budget; confirm removing core Mermaid materially reduces the 1.70 MB minified main chunk and eliminates its diagram/Cytoscape/KaTeX chunks.
- [ ] Update website/download/release messaging to advertise only certified platforms and features.
- [ ] **Exit gate:** signed artifacts from one revision, the signed extension registry, published packages, production auth/sync, and recorded native evidence all pass before the draft release is published.

## Interface and documentation changes

- Sync IPC: status, synchronize now, devices, forget device, reset remote profile, and delete account.
- OCR API: provider availability/version/languages/diagnostic plus enabled language preference.
- Update [ARCHITECTURE.md](ARCHITECTURE.md), [EXTENSION_API_V2.md](EXTENSION_API_V2.md), and [RELEASE.md](RELEASE.md) alongside implementation wherever stable contracts change.

## Tracking rules and defaults

- All new roadmap work starts as `[ ]`; mark `[x]` only with linked automated or installed-build evidence.
- No extension is installed by default.
- Registry installs require marketplace-style signature verification; unsigned archives remain Developer Mode only.
- Automatic extension updates remain opt-in and cannot cross permission changes.
- Both macOS architectures ship for v0.1; Intel can be removed only after a separately documented support decision.
- Windows OCR blocks release; Linux OCR may rely on system Tesseract only when installation and recovery are explicit and certified.
- Configuration sync blocks release; clipboard-content sync remains post-release.

## Semantic search scale

- [x] Qualify the 60,000-clip capacity design and reject backends that fail correctness, packaging, or rebuild-cost gates. Evidence: [Meaning Search and Recall](SEMANTIC_SEARCH_ARCHITECTURE.md#qualification-evidence).
- [x] Select one dependency-free paged binary clip-routing scan with exact float32 chunk reranking; do not retain `vec1`, HNSW, or the full float32 scan as alternate production backends.
- [x] Move generation-owned chunks and vectors from `clips.db` into validated `search-index/generation-{id}.sqlite` sidecars. Evidence: the sole persistence and retrieval boundary is [SemanticIndexStore](../src-tauri/src/search/semantic/store.rs); generation jobs and activation use it from [semantic service](../src-tauri/src/search/semantic/service.rs), and the baseline [search migration](../src-tauri/migrations/007_search.sql) contains no chunk or embedding payload tables.
- [x] Bound each clip to 64 semantic chunks, add a routing chunk for truncated long documents, and deduplicate complete enriched embedding inputs. Evidence: deterministic clip-level sampling and routing in [semantic chunking](../src-tauri/src/search/semantic/chunking.rs), plus provider-input deduplication and bounded adaptive retries in [semantic service](../src-tauri/src/search/semantic/service.rs).
- [x] Make sidecar-first job completion and generation activation recoverable under injected interruption and corruption. Evidence: semantic service recovery tests cover a valid sidecar write left behind a `running` job, a finalized sidecar interrupted before activation, and a corrupt building sidecar whose jobs are durably reset before its derived file is replaced.
- [x] Replace string-ID eligibility materialization with stable ordinals and compact bitsets; rerank 100 candidates exactly before RRF. Evidence: [SemanticIndexStore](../src-tauri/src/search/semantic/store.rs) translates canonical eligibility directly to a generation-local ordinal bitset, scans only eligible ordinals, globally shortlists 100 clips, and float32-reranks their chunks before [search fusion](../src-tauri/src/search/mod.rs).
- [x] Batch history-summary hydration, virtualize the active list rendering path, remove the unreachable duplicate grid path, and replace the load-all End shortcut. Evidence: repository page hydration uses fixed category batches; `ClipboardListView` uses measured virtualization with bounded overscan; the 60,000-item DOM-bound test mounts at most 32 rows; and one `End` press loads at most one cursor window.
- [x] Add Meaning Search progress, disk estimate, rebuild, retry, delete-index, and FTS-fallback operations. Evidence: the semantic status contract reports lifecycle, coverage, dimensions, active bytes, and estimated rebuild bytes; the Intelligence UI exposes the operations and explains mandatory FTS continuity; the semantic service rejects rebuilds that cannot retain the live index plus the estimated replacement and safety reserve.
- [x] Add Recall as a separate bounded generation action after search scale is complete; secrets remain excluded by default and automatic Recall never includes them. Evidence: [Recall service](../src-tauri/src/search/recall.rs) accepts at most ten ranked IDs, bounds the question and source text, excludes secret-faceted clips, and calls only the configured local generator after an explicit UI action; the complete flow and rationale are documented in [Meaning Search and Recall architecture](SEMANTIC_SEARCH_ARCHITECTURE.md).
- [ ] Certify labelled recall, latency, memory, disk, recovery, and installed packages on Windows x64, Linux x64, macOS x64, and macOS arm64.

## Post-release candidates

- [ ] Add bounded, host-rendered tabs, code blocks, tables, key/value lists, and comparison layouts to the extension render-model contract. Packages provide structured data and selected approved primitives; the host owns interaction, accessibility, theme, and styling. Keep isolated custom UI for genuinely bespoke interactions until then.

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
