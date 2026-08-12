# Release readiness

**Current state:** blocked until recovery milestone R7. Backend availability is
not sufficient for release; the reachable desktop workflows in
[UI_PARITY.md](UI_PARITY.md) and the native evidence in
[PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) are the release gates.

## Release scope

- Build Windows, macOS, and Linux artifacts from the same reviewed revision.
- Preserve the V2 fresh-schema/reset policy. Do not add V1 migrations or
  compatibility reads for release convenience.
- Ship only platform capabilities that meet their documented validation gate.
  In particular, Windows OCR is currently unavailable and must be implemented
  or explicitly excluded from the advertised baseline.
- Keep visual search, hosted/OpenAI-compatible providers, generation, Vault,
  entitlements, and remote sync out of the release claim.

## Required configuration and secrets

- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Any release-time CSP/updater endpoint values required by the generated Tauri
  configuration

Secrets belong in CI or the platform signing environment. Never commit them,
print them in logs, or store them in application SQLite.

## Automated preflight

Run from a clean checkout of the release revision:

```bash
npm ci
npm run type-check
npm run lint
npm test -- --run
npm run build
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features --bin clipsx
```

The release revision must also pass the frontend-invoke/Rust-handler contract
test, schema/reset tests, managed-file recovery tests, and representative
render-model/output fixtures.

## Platform artifacts and signing

- **Windows:** build and sign the installer/executable with the approved
  certificate. Verify SmartScreen metadata, installer upgrade/uninstall, tray,
  global shortcut, decorum controls, autostart, deep links, and updater.
- **macOS:** sign with the release Developer ID, notarize, staple, and verify on
  a clean machine. Ad-hoc signing is not a public-release gate. Verify
  Accessibility guidance and paste recovery.
- **Linux:** verify the supported X11 packages and desktop integration for each
  published format. Wayland support must not be implied unless separately
  implemented and tested.

Record artifact hashes, signing/notarization results, and the exact source
revision with the release.

## Installed-build acceptance

Run the shared capture → persistence → restart → reconstruction fixtures from
[PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md), plus:

- first launch and incompatible-schema reset;
- second-instance activation and installed deep-link routing;
- shortcut show/hide, close-to-tray, tray reopen, explicit quit, and
  `clear_on_exit`;
- clipboard capture exclusions, deduplication, self-write suppression, and
  original/plain/transformed Copy and Paste;
- representative text, HTML, RTF, image, file-list, Office/native, and
  unsupported-format behavior;
- search, settings import/export, autostart, account callback, extension
  lifecycle, and failure/recovery states;
- updater unavailable/no-update/update-available/install/restart paths.

Each result must name the OS version, desktop/session type, package version,
fixture, expected behavior, actual behavior, and retained diagnostic evidence.

## Documentation sign-off

Before publishing:

- update [ROADMAP.md](ROADMAP.md) recovery statuses from evidence;
- update [UI_PARITY.md](UI_PARITY.md) row statuses and blockers;
- update [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) with the tested matrix;
- update [platform-format-matrix.json](platform-format-matrix.json) only when
  the implemented adapter contract changes;
- make release notes describe verified behavior, known limitations, data reset
  implications, and updater compatibility.

A release is ready only when R7 is verified and no required row remains
`Missing`, `Partial`, or `Implemented — validation pending`.
