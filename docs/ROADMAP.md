# ClipsX production roadmap

This roadmap contains only unfinished work for the first production release.
Stable behavior and design decisions belong in [ARCHITECTURE.md](ARCHITECTURE.md);
the executable certification matrix and recorded evidence belong in
[RELEASE.md](RELEASE.md). Completed items are removed instead of retained as a
historical checklist.

## 1. Implementation remaining

Only work that changes product code, backend behavior, build infrastructure, or
release configuration belongs in this section. Testing an already implemented
behavior belongs in Section 2.

### Account and backend (`clipsx-web`)

- [ ] Add verified account deletion through a JWT-protected backend operation,
  explicitly handling billing, organization ownership, and shared vault data.
- [ ] Publish signed extension packages with reviewed portable-setting
  declarations and populate the matching server approval catalog through the
  release process.
- [ ] Deploy the reviewed fresh Supabase baseline and hosted desktop PKCE callback
  bridge from the authoritative `clipsx-web` repository.

### Release engineering

- [ ] Add dependency and license auditing, SBOM generation, secret scanning,
  release-artifact inspection, and enforceable bundle-size budgets to CI.
- [ ] Configure reproducible Windows x64, Linux x64 `.deb`/AppImage, and macOS
  arm64/x64 builds from one revision.
- [ ] Configure Developer ID signing, hardened runtime, notarization, and
  stapling for macOS arm64/x64 artifacts.
- [ ] Configure signing for Windows installers and executables.
- [ ] Configure signed updater metadata and a documented rollback/recovery path.
- [ ] Update website, download, and release messaging after certification so it
  advertises only supported platforms and capabilities.

## 2. QA and release certification

This section contains verification specifications. Failures may create new
implementation work, but passing checks are recorded in [RELEASE.md](RELEASE.md)
rather than being converted into product features.

### Automated and review gates

- [ ] Exercise every user-facing setting across validation, persistence,
  restart, reset, applicable import/export, and recoverable failure paths.
- [ ] Complete mutation-level cascade and invalidation coverage for clips, tags,
  notes, OCR, search projections, artifacts, extension-derived data, and managed
  files.
- [ ] Audit production logs and built artifacts for sensitive content, secrets,
  credentials, tokens, and unnecessary filesystem paths.
- [ ] Run dependency, license, SBOM, secret-scanning, bundle-budget, and artifact
  inspection gates against the release revision.
- [ ] Complete the production security review with no unresolved high-severity
  findings.
- [ ] Run an LLM-assisted review of feature completeness, architecture,
  concurrency/persistence boundaries, and the threat model; validate every
  actionable finding against source or tests before accepting it.

### Hosted account and sync

- [ ] Audit hosted Supabase Auth, redirect URLs, deployed migrations, grants, and
  security/performance advisors against the `clipsx-web` source of truth.
- [ ] Certify the Google OAuth, hosted PKCE callback, `clipsx://` deep-link, and
  desktop session round trip.
- [ ] Certify two-device restore across advertised platforms, including
  concurrent/offline edits, skew, tombstones, interrupted restore, sign-out,
  revocation, unavailable packages, quarantine recovery, and remote reset.
- [ ] Confirm that sync transfers only supported configuration and extension
  intent—never clipboard content, secrets, device-local settings, permission
  grants, or old consent.

### Installed platforms

- [ ] Run the complete OCR lifecycle on Windows x64, macOS arm64/x64, and
  Linux/X11 x64: success, empty output, failure, unsupported input, cancellation,
  retry, deletion, language changes, FTS refresh, and semantic reindexing in
  English and Japanese.
- [ ] On macOS, verify Vision language selection and bounded execution in both
  architectures. On Linux, verify Tesseract discovery, language/version
  reporting, `.deb` dependencies, and actionable AppImage recovery.
- [ ] Certify native sharing for text, URLs, files, images, documents,
  cancellation, missing sources, and corrupt managed assets on every advertised
  platform.
- [ ] Certify English/Japanese keyboard and screen-reader behavior with NVDA,
  VoiceOver, and Orca for Settings, Intelligence, Extensions, and recovery.
- [ ] Verify Windows clean install, update, downgrade rejection, and uninstall;
  macOS notarization/stapling; and Linux desktop integration, X11 claims,
  dependencies, AppImage behavior, and updater support.
- [ ] Run and record the complete installed-build matrix from one signed revision:
  clipboard fidelity, focus/paste, tray and shortcuts, autostart, deep links,
  OAuth/sync, extensions, OCR, search/Recall quality, accessibility, latency,
  memory, disk, and recovery. Recall includes the versioned synthetic corpus,
  exact-identifier recovery, citation support, cancellation, and clipboard
  self-write checks.
- [ ] Verify signed updater metadata and rollback/recovery behavior.
- [ ] Verify the public GitHub Sponsor button after the `azure06` Sponsors profile
  is approved and enabled.

The production release gate is one reviewed revision with signed artifacts, a
signed extension catalog, deployed Auth/configuration sync, no unresolved
high-severity security findings, and complete evidence in `RELEASE.md`.

## Post-release candidates

- [ ] Add bounded host-rendered tabs, code blocks, tables, key/value lists, and
  comparison layouts to the extension render-model contract. Packages provide
  structured data and approved primitives; the host owns interaction,
  accessibility, theme, and styling. Keep isolated custom UI for genuinely
  bespoke interactions until then.
