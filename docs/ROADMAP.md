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

### Production foundation (`clipsx-web`)

- [ ] Complete the Supabase and hosted-auth production foundation.
  - [ ] Enable Supabase Auth leaked-password protection and verify the production
        site URL and exact browser/desktop redirect allowlists.
  - [ ] Deploy and smoke-test the existing hosted desktop PKCE callback bridge;
        record the web deployment and database revision in `RELEASE.md`.

### Website, account, and licensing (`clipsx-web`)

- [ ] Complete website legal review and operator details, publish certified
      artifact URLs, deploy the Free-default website, and record production
      smoke-test evidence without advertising unfinished platforms or capabilities.
- [ ] Certify verified account deletion against hosted Auth and live-mode Stripe
      webhook projection, including billing, organization ownership, and shared
      vault blockers.
### Extensions and registry

- [ ] Publish JWT Inspector 1.2.2 and Mermaid 1.0.1 from the prepared
      `clipsx-extensions` sources, merge their reviewed signed schema-v4 entries
      into `clipsx-registry`, and retain the successful production catalog and
      Supabase approval-catalog readback.
- [ ] Complete a production-readiness pass over the extensions site, immutable
      package releases, registry signing environment, revocation/recovery process,
      and web approval-catalog reconciliation.

### Release engineering

- [ ] Add release-artifact content inspection and enforceable per-platform
      bundle-size budgets to the release supply-chain gates.
- [ ] Add reproducibility checks and explicit expected-package assertions to the
      existing same-revision Windows x64, Linux x64 `.deb`/AppImage, and macOS
      arm64/x64 release matrix.
- [ ] Configure Developer ID signing, hardened runtime, notarization, and
      stapling for macOS arm64/x64 artifacts; replace the current ad-hoc signing
      configuration.
- [ ] Configure Authenticode signing for Windows installers and executables.
- [ ] Document and automate the updater rollback/recovery path around the
      existing signed updater-artifact and metadata generation.
- [ ] Update website, download, and release messaging after certification so it
      advertises only supported platforms and capabilities.

### Pre-certification product freeze

- [ ] Complete release-blocking app polish, copy, recovery, and usability work,
      then freeze the candidate revision before running Section 2. Later brush-up
      continues post-release, but any release-affecting change requires the relevant
      certification checks to be repeated.

### Release execution order

1. Finish hosted Auth production settings and deploy and certify the hosted PKCE
   bridge.
2. Complete legal/operator details, certified downloads, website deployment,
   and account-deletion certification.
3. Publish the prepared extensions and finish registry/extensions-site
   production readiness.
4. Close release-infrastructure and signing gaps and freeze the app candidate.
5. Run and record every applicable Section 2 test against that exact revision.
6. Publish signed Windows x64, notarized macOS arm64/x64, and Linux x64
   `.deb`/AppImage artifacts; there is no iOS target in the first desktop release.
7. Begin post-release brush-up and feedback-driven iteration without weakening
   the recorded release guarantees.

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
- [ ] Certify Google and GitHub OAuth, the hosted PKCE callback, `clipsx://`
      deep-link, and desktop session round trips.
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
