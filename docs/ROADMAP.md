# ClipsX roadmap

The Extension API v3.2 transformation-tab implementation requires installed-host
certification and coordinated package publication before release. Work that can
wait belongs under **After the first release**.

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
Publish reviewed immutable v3.2 package archives and signed registry metadata
only after these tests pass. The host requires an explicit reset to database
version 15 and shows only current-contract releases in Discover.

### Local review before publication

Local package behavior must be reviewed before consolidated release validation.
The [extension development workflow](../.agents/skills/clipsx-extension-development/SKILL.md)
describes the focused build and checkpoint procedure. Installed-platform
certification requirements remain in [RELEASE.md](RELEASE.md).

### 1. Complete extension catalog sync and smoke test

Merge the reviewed host v3.2 contract and package tool before publishing new
packages. Rebuild and publish six immutable 2.0.0 extension archives, replace
the reviewed registry metadata with their exact generated records, and publish
the signed index and signature pair. Verify the public catalog, registry-to-web
portable-setting reconciliation and readback, then test Discover and each
package on installed desktop builds. Release the desktop app last. A source
merge alone does not make an archive visible in Discover.

### 2. Configure production desktop signing

Release branch pushes prepare immutable candidates for Windows x64, Linux x64,
macOS arm64 and macOS x64. A local SimplySign helper packages the CI-built
Windows executable; CI verifies the installer, application and uninstaller,
then signs updater bytes and assembles a complete staging draft.

- [ ] Roll the infrastructure workflows onto main and add Release readiness to
      the existing main ruleset using the documented additive setup command.
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

- [ ] Choose one candidate revision and let its automated CI and release
      preflight pass.
- [ ] Test the installed artifacts on Windows, macOS, and Linux/X11 using the
      applicable checklist in [RELEASE.md](RELEASE.md). Record failures and fix
      release blockers; rerun only the affected checks after a change.
- [ ] Verify clean installation, clipboard capture/copy/paste, shortcuts and
      tray behavior, OCR, search, extensions, OAuth/sync, native sharing,
      uninstall, and update from a previous signed build.
- [ ] Confirm there are no unresolved high-severity security findings or secrets
      in the repository, logs, or distributable artifacts.

There is no separate "pre-certification product freeze." The candidate revision
and its draft artifacts are the boundary. If that revision changes, rebuild the
draft and repeat the affected certification checks.

### 4. Publish

- [ ] Record installed and private-fixture upgrade evidence for Windows, both Mac
      architectures, Linux AppImage and deb using Certify candidate.
- [ ] Merge the certified release PR. Publication verifies the merged tree and
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
