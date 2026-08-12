# Platform validation matrix

This document tracks executable desktop and clipboard validation. The normative list of supported clipboard formats remains [platform-format-matrix.json](platform-format-matrix.json); this file records whether those contracts have been demonstrated in the assembled application.

## Current status

| Platform | Desktop host | Capture/restart/reconstruct | Paste/focus | OCR | Overall |
|---|---|---|---|---|---|
| Windows | Implemented — validation pending | Partial | Partial | Missing runtime integration | Partial |
| macOS | Implemented — validation pending | Partial | Partial; permission UX missing | Implemented — validation pending | Partial |
| Linux/X11 | Implemented — validation pending | Partial | Implemented — validation pending | Runtime-dependent | Partial |

No platform is release-verified until its complete checklist passes on an installed build.

## Shared acceptance sequence

For every supported format:

1. Place a fixture on the native clipboard with every expected alternate representation.
2. Capture one coherent snapshot and verify representation identity, ordering, storage kind, byte contract, and source application.
3. Restart ClipsX and reload the clip from SQLite/managed files.
4. Reconstruct using `Original` and inspect the native clipboard formats and bytes/references.
5. Exercise explicit `PlainText` and transformed output independently of the selected renderer.
6. Verify self-write suppression and that the reconstructed output does not create an accidental duplicate.
7. Paste into a target application and confirm focus restoration, failure diagnostics, and platform permissions.

Unsupported formats must follow the matrix's declared skip/reject/retain behavior. Tests must never infer or invent UTI, registered Windows formats, OLE types, MIME types, or X11 targets.

## Windows

Required format fixtures:

- `CF_UNICODETEXT`
- HTML Format wrapper and fragment offsets
- Rich Text Format
- `CF_HDROP` ordered file list
- PNG and normalized `CF_DIB`
- PDF and SVG registered formats
- Office/native registered formats with useful HTML/image/PDF alternates

Open issues and gates:

- Ensure useful formatted Office alternates outrank opaque native-detail presentation.
- Verify exact registered-format writeback and wrapper regeneration.
- Verify decorum minimize/maximize/close and snap overlay.
- Verify shortcut toggle, tray show/settings/quit, second launch, autostart, updater state, deep links, and close-to-tray.
- Windows OCR currently returns unavailable; either implement it or explicitly remove Windows OCR from release claims.

## macOS

Required format fixtures:

- `public.utf8-plain-text`
- `public.html`
- `public.rtf`
- ordered `public.file-url` lists
- PNG, JPEG, and TIFF
- PDF and SVG
- supported Microsoft/native UTIs with useful alternates

Open issues and gates:

- Prove ordered multi-file capture and reconstruction; current adapter behavior may collapse to one item.
- Restore explicit Accessibility permission diagnosis/recovery for synthetic paste.
- Verify exact captured UTI writeback only for adapter-supported identifiers.
- Verify shortcut toggle, tray behavior, installed deep links, OAuth callback, autostart, updater, close-to-tray, and frontmost-app paste restoration.
- Verify the native OCR artifact lifecycle and UI status once R2 exposes it.

## Linux/X11

Required target fixtures:

- `UTF8_STRING`
- `text/html`
- `text/rtf` and `application/rtf`
- `image/png`
- `text/uri-list`

Open issues and gates:

- Validate ownership of reconstructed X11 selections for the full consumer read window.
- Verify quick paste using XTest and focus restoration on the supported desktop environments.
- Document OCR runtime detection and behavior when the expected system OCR dependency is absent.
- Verify shortcut toggle, tray behavior, second launch, deep links, autostart, updater, and close-to-tray for packaged `.deb` and AppImage builds.

## Desktop failure and recovery cases

- Legacy schema opens the recovery UI without initializing history/search/extensions.
- Incorrect reset confirmation changes nothing.
- Partial reset failure is displayed and does not restart automatically.
- Missing updater key produces an unavailable state rather than a startup error.
- Invalid OAuth callbacks are rejected; the loopback listener accepts only the owned GET path and expires.
- A renderer, provider, extension, or OCR failure leaves canonical clipboard representations usable.

## Evidence required to mark a row Verified

- Automated fixture/integration test where the platform API can run reliably in CI.
- Recorded manual smoke result for interactions that require a real desktop session.
- Installed-package validation, not only `cargo run`.
- Documentation update in [UI_PARITY.md](UI_PARITY.md) and [RELEASE.md](RELEASE.md) in the same change.
