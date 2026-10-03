# ClipsX roadmap

The Extension API v3.2 transformation-tab implementation requires installed-host
certification before the desktop release. The six first-party 2.0.0 archives and
their signed registry catalog are already published. Work that can wait belongs
under **After the first release**.

The detailed cross-platform test matrix remains in [RELEASE.md](RELEASE.md).
This roadmap answers only three questions: what blocks the release, how the
release is produced, and what waits until afterward.

## Before the first release

### Extension API v3.2 certification

Test facet-constrained activation against current detection results before
certifying the release. Durable text and binary outputs use artifact storage;
package-state writes are staged with job completion, provider failures use
bounded retry categories, and unsuccessful jobs have bounded
retention.

Validate Rewrite and the rebuilt first-party packages in installed Windows,
macOS, and Linux/X11 builds. Exercise automatic capture, duplicate-copy
deduplication, restart recovery, source deletion, and retained results after
disablement and uninstall. Verify saved setups, built-in presets, multiple typed
outputs, Compare resizing, result controls, and the single Tools entry point.
The host requires an explicit reset to database version 15 and shows only
current-contract releases in Discover.

### Local behavior review for future package releases

Local package behavior must be reviewed before consolidated release validation.
The [extension development workflow](../.agents/skills/clipsx-extension-development/SKILL.md)
describes the focused build and checkpoint procedure. Installed-platform
certification requirements remain in [RELEASE.md](RELEASE.md).

### 1. Verify extension publication and installed behavior

The six immutable 2.0.0 extension archives and signed catalog are published.
The public catalog and registry-to-web portable-setting reconciliation and
readback have been checked. Test Discover and each package on installed desktop
builds before releasing the desktop app. A package source merge publishes its
checked archive; the separate signed registry merge makes it visible in Discover.
Configure the publication GitHub App described in the extension and registry
release guides, then verify the complete automated handoff with the next real
versioned package release. Do not bump package versions solely to test it.

### 2. Configure production desktop signing

App/build-input pushes on release branches save tested binaries for Windows x64,
Linux x64 and both Mac architectures. Trusted main tooling prepares an explicit
saved build and preserves completed platforms on retries. SimplySign packages
and signs Windows locally; hosted verification and finalization assemble the
complete draft without recompiling the app or frontend.

- [x] Deploy trusted release orchestration and require the proven aggregate CI
      gate plus Release readiness, preserving other main protections.
- [ ] Configure public production build variables, the pinned Windows signing
      thumbprint, Developer ID certificate and App Store Connect team API key.
- [ ] Back up the existing updater private key and retain the embedded public key.
- [ ] Prove Windows packaging does not recompile and verify all native signatures,
      notarization tickets, updater signatures and final candidate hashes.
- [ ] Deploy the website runtime download metadata capability before publication.

GitHub-hosted Windows, Linux, and macOS runners can build all platforms. A
personal Mac is not required to produce the macOS artifacts, although testing
the installed app on real Macs is still required. Apple signing still requires
an Apple Developer account, Developer ID credentials, and notarization access.

### 3. Certify the release candidate

- [ ] Run shared app preflight before app/build-input release changes. Choose
      an explicit successful saved build; its app-input inventory and public
      production variables must match the selected release source.
- [ ] Test the installed artifacts on Windows, macOS, and Linux/X11 using the
      applicable checklist in [RELEASE.md](RELEASE.md). Record failures and fix
      release blockers; rerun only the affected checks after a change.
- [ ] Verify clean installation, clipboard capture/copy/paste, shortcuts and
      tray behavior, OCR, search, extensions, OAuth/sync, native sharing,
      uninstall, and update from a previous signed build.
- [ ] Confirm there are no unresolved high-severity security findings or secrets
      in the repository, logs, or distributable artifacts.

The selected app-input inventory and finalized bytes form the release boundary.
Docs/release-tooling revisions can differ; actual app/configuration changes need
a new build. Newer builds do not automatically supersede a selected candidate.
Changed finalized/certified assets require another candidate and certification.

### 4. Publish

- [ ] Record installed and private-fixture upgrade evidence for Windows, both Mac
      architectures, Linux AppImage and deb using Certify candidate.
- [ ] Merge the certified release PR. Publication verifies merged app inputs and
      draft hashes, tags the merged commit, and publishes the existing files.
- [ ] Verify public manifests and downloads. The website reads downloads.json
      automatically; later desktop releases require no website deployment.
- [ ] Verify a previously installed public build discovers and installs the update
      when one exists. Publication retries reuse the certified assets.

## Release process

Workflow triggers, candidate artifacts, signing and publication requirements are
documented in [RELEASE.md](RELEASE.md).

## After the first release

- Add release-artifact content inspection, enforceable bundle-size budgets,
  stronger reproducibility checks, and automated updater rollback drills.
- Extend the existing bounded result tabs and comparison layouts with additional
  host-rendered views when concrete package requirements justify them.
- Continue UI polish, copy improvements, performance work, additional platform
  coverage, and feedback-driven features as normal versioned releases.
- Add capabilities currently outside the first-release contract only after they
  have explicit architecture, implementation, and certification scope.
