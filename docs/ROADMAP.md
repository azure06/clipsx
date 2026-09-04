# ClipsX production roadmap

This roadmap contains only unfinished work for the first production release.
Stable behavior and design decisions belong in [ARCHITECTURE.md](ARCHITECTURE.md);
the executable certification matrix and recorded evidence belong in
[RELEASE.md](RELEASE.md). Completed items are removed instead of retained as a
historical checklist.

## 1. Product completion and security

- [ ] Finish the shared command registry and configurable built-in shortcuts;
  remove remaining hard-coded command bindings from UI handlers.
- [ ] Persist and validate the resizable history/preview layout, including
  restart and reset behavior.
- [ ] Complete English/Japanese localization and keyboard/screen-reader
  accessibility for Settings, Intelligence, Extensions, and recovery states.
- [ ] Verify every user-facing setting covers validation, persistence, restart,
  reset, import/export where applicable, and recoverable failure handling.
- [ ] Complete mutation-level cascade and invalidation tests for clips, tags,
  notes, OCR, search projections, artifacts, extension-derived data, and managed
  files.
- [ ] Audit production logging and remove clipboard content, notes, credentials,
  tokens, and unnecessary filesystem paths.
- [ ] Add dependency and license auditing, SBOM generation, secret scanning, and
  release-artifact inspection to CI.
- [ ] Complete the production security review with no unresolved high-severity
  findings.

## 2. Cross-platform OCR certification

The provider contract, bounded background queue, Windows WinRT executor, macOS
Vision provider, Linux Tesseract provider, language configuration, retry and
reprocessing behavior, provenance invalidation, and runtime diagnostics are
implemented. What remains is platform certification:

- [ ] Verify macOS Vision language selection, bounded execution, cancellation,
  retry, and reprocessing in installed arm64 and x64 builds.
- [ ] Verify Linux/X11 Tesseract discovery, version/language reporting, `.deb`
  dependencies, and actionable AppImage recovery when the engine or language
  data is absent.
- [ ] Run the installed OCR lifecycle on Windows x64, macOS arm64/x64, and Linux
  x64: empty success, failure, unsupported input, retry, deletion, language
  change, FTS refresh, and semantic reindexing in English and Japanese.

Windows OCR remains release-blocking. Linux may depend on system Tesseract only
after installation and recovery are explicit and certified.

## 3. Configuration sync and account completion

- [ ] Audit the restored Supabase project's Auth configuration, redirect URLs,
  schema, grants, applied migrations, and security/performance advisors.
- [ ] Finish and certify the hosted desktop PKCE callback bridge.
- [ ] Deploy and verify owner-scoped RLS for `sync_devices` and `sync_records`,
  plus the security-invoker batch RPC that derives ownership from `auth.uid()`
  and applies only deterministically newer revisions.
- [ ] Complete the versioned sync allowlist for profile preferences, renderer and
  OCR preferences, signed-extension intent and non-secret settings, and
  shortcuts. Clips, notes, tags, files, credentials, grants, local provider
  configuration, jobs, diagnostics, and derived data must remain local.
- [ ] Complete Sync UI and IPC for device listing/revocation, retry, remote-profile
  reset, quarantined-record recovery, and precise included/excluded data.
- [ ] Reinstall synchronized extensions only through the signed registry and
  require fresh local consent for external capabilities.
- [ ] Add verified account deletion through a JWT-protected backend function;
  sign-out must retain local data and stop synchronization.
- [ ] Test two-device restore, concurrent and offline edits, clock skew,
  tombstones, reconnect/backoff, revoked devices, unavailable packages, corrupt
  payload quarantine, cross-user RLS isolation, remote reset, and deletion.

The exit gate is a second device restoring only the supported configuration and
extension intent, with no clipboard content, secrets, device-local settings, or
old consent transferred.

## 4. Native packaging and release certification

- [ ] Build Windows x64, Linux x64 `.deb`/AppImage, and macOS arm64/x64 artifacts
  from one reviewed revision.
- [ ] Add Developer ID signing, hardened runtime, notarization, stapling, and
  installed verification for both macOS architectures.
- [ ] Sign Windows installers and executables; verify clean install, update,
  downgrade rejection, and uninstall.
- [ ] Verify Linux desktop integration, X11-only claims, package dependencies,
  AppImage behavior, Tesseract recovery, and updater support.
- [ ] Validate signed updater metadata and rollback/recovery behavior.
- [ ] Run and record the complete installed-build matrices in
  [RELEASE.md](RELEASE.md), including native clipboard fidelity, window focus and
  paste, tray and shortcuts, autostart, deep links, OAuth/sync, accessibility,
  extensions, OCR, search/Recall quality, latency, memory, disk, and recovery.
- [ ] Add a bundle-size budget and confirm that removing core Mermaid materially
  reduces the main bundle and eliminates its diagram/Cytoscape/KaTeX chunks.
- [ ] Update website, download, and release messaging to advertise only certified
  platforms and capabilities.

The release gate is signed application artifacts from one revision, a signed
extension catalog with published packages, production Auth/configuration sync,
and complete installed-build evidence.

## Post-release candidates

- [ ] Add bounded host-rendered tabs, code blocks, tables, key/value lists, and
  comparison layouts to the extension render-model contract. Packages provide
  structured data and approved primitives; the host owns interaction,
  accessibility, theme, and styling. Keep isolated custom UI for genuinely
  bespoke interactions until then.
