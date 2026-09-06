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
- [ ] Certify native clip sharing for text, URLs, files, images, documents,
  cancellation, missing sources, and corrupt managed assets on every advertised
  platform.
- [ ] Run an LLM-assisted release review of feature completeness, architecture,
  concurrency/persistence boundaries, and the threat model; validate every
  actionable finding against source code or tests before accepting it.
- [ ] Verify the public GitHub Sponsor button after the `azure06` Sponsors profile
  is approved and enabled.

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

The local backend and desktop implement the domain-based migration baseline,
versioned configuration protocol, account/generation isolation, atomic cloud
initialization/replacement, staged restore, device revocation, quarantine,
signed-registry restoration, portable setting approval, app-command shortcuts,
and event-driven low-traffic synchronization without idle polling.
Local automated coverage is recorded in the backend configuration-sync guide.
Remaining production work:

- [ ] Audit the hosted Supabase Auth configuration, redirect URLs, schema,
  grants, and security/performance advisors before deploying the fresh baseline.
- [ ] Deploy and certify the hosted desktop PKCE callback bridge and deep-link
  round trip with the actual OAuth provider.
- [ ] Publish signed package releases declaring reviewed portable settings and
  populate the matching server approval catalog through the release process.
- [ ] Certify installed two-device restore across advertised platforms, including
  concurrent/offline edits, skew, tombstones, interrupted restore, sign-out,
  revoked devices, unavailable packages, quarantine recovery, and remote reset.
- [ ] Add verified account deletion through a JWT-protected backend operation,
  separately resolving billing, organization ownership, and shared vault data.

The exit gate is a second installed device restoring only supported configuration
and extension intent, with no clipboard content, secrets, device-local settings,
or old consent transferred. Configuration sync is the first backend product
milestone; existing billing/vault functionality remains independently maintained.

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
  extensions, OCR, search/Recall quality, latency, memory, disk, and recovery. Recall release
  certification includes the versioned synthetic retrieval/grounding corpus, exact-identifier
  recovery, citation support, cancellation, and clipboard self-write checks.
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
