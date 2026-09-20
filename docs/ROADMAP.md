# ClipsX roadmap

ClipsX, `clipsx-web`, and the Extension API/registry infrastructure are feature
complete for the first public release. Work that would improve the product but
is not required to ship belongs under **After the first release**.

The detailed cross-platform test matrix remains in [RELEASE.md](RELEASE.md).
This roadmap answers only three questions: what blocks the release, how the
release is produced, and what waits until afterward.

## Before the first release

### 1. Complete extension catalog sync and smoke test

The extension repository, signed registry, validation workflows, signing flow,
and revocation process are implemented. JWT Inspector 1.2.2 and Mermaid 1.0.1
are published, and their reviewed entries are present in the signed registry.
The remaining work is operational sync configuration and one production smoke
test; no redesign is needed.

The remaining work is:

- [x] Publish JWT Inspector 1.2.2 and Mermaid 1.0.1 from
      `clipsx-extensions`.
- [x] Add their reviewed metadata to `clipsx-registry`, run **Publish signed
      registry**, and merge the generated publication PR.
- [ ] Configure the registry-to-`clipsx-web` dispatch credential and the
      `clipsx-web` `SUPABASE_DB_URL`, rerun the sync, and verify the transactional
      approval-catalog reconciliation succeeds.
- [ ] Confirm the registry-to-`clipsx-web` approval-catalog sync succeeds.
- [ ] In a production ClipsX build, refresh Discover and install, exercise,
      disable, re-enable, and remove each package.

The live registry now contains JWT Inspector 1.2.2 and Mermaid 1.0.1. The
approval catalog is not yet confirmed because the configured direct Supabase
endpoint is IPv6-only and unreachable from the GitHub-hosted runner. Replace it
with the Session pooler URI, then rerun and verify the transactional readback
before checking off the synchronization items.

### 2. Configure production desktop signing

The GitHub Actions release workflow already builds Windows x64, Linux x64,
macOS arm64, and macOS x64 from one revision and creates signed Tauri updater
artifacts. The remaining release-engineering work is platform trust signing:

- [ ] Configure Windows Authenticode credentials and sign the executable and
      NSIS installer.
- [ ] Configure the Apple Developer ID certificate and notarization credentials;
      enable hardened runtime, notarize, and staple both macOS builds instead of
      using the current ad-hoc signature.
- [ ] Store and back up the Tauri updater private key securely. Keep the public
      key already embedded in the app stable so future updates remain compatible.
- [ ] Run a manual release candidate build and inspect the produced installers,
      updater artifacts, `latest.json`, hashes, and release contents.

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

- [ ] Publish the certified draft GitHub Release with Windows, macOS, Linux, and
      updater artifacts attached.
- [ ] Update `clipsx-web` download URLs and final release documentation to point
      to the published artifacts, then deploy and smoke-test the final site.
- [ ] Verify a previously installed signed build discovers and installs the
      published update.

## How the automated release works

- Merging to `main` runs CI. It does **not** publish an application release.
- A manual workflow run builds inspectable candidates but does not publish.
- After the version in `src-tauri/tauri.conf.json` is set, pushing the matching
  `v<version>` tag runs the release matrix and creates a **draft** GitHub Release.
- Platform signing/notarization happens in those jobs once the required GitHub
  secrets and Tauri configuration are present.
- The draft is published only after the same artifacts pass installed-platform
  testing. The website is finalized afterward so its URLs refer to real public
  release assets.

Do not rotate or lose the Tauri updater signing key after release. New releases
must use the same key expected by installed clients unless a deliberate key
rotation mechanism is shipped first.

## After the first release

- Add release-artifact content inspection, enforceable bundle-size budgets,
  stronger reproducibility checks, and automated updater rollback drills.
- Add bounded host-rendered tabs, code blocks, tables, key/value lists, and
  comparison layouts to the extension render-model contract.
- Continue UI polish, copy improvements, performance work, additional platform
  coverage, and feedback-driven features as normal versioned releases.
- Add capabilities currently outside the first-release contract only after they
  have explicit architecture, implementation, and certification scope.
