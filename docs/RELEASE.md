# Release and platform validation

This document is the release gate for ClipsX. A release is ready only when the
automated preflight, native clipboard matrix, installed-desktop workflows, and
packaging requirements below pass for every advertised platform.

The normative capture and reconstruction contract is the executable
[platform-format-matrix.json](platform-format-matrix.json), validated by its
[JSON Schema](platform-format-matrix.schema.json) and the compiled Rust codec
registry. Update the policy and installed-build fixtures together whenever an
adapter's supported-format contract changes.

## Release scope

- Build Windows, macOS, and Linux/X11 artifacts from one reviewed revision.
- Preserve the fresh V2 schema and explicit reset flow; do not add V1 migrations
  or compatibility reads for release convenience.
- Advertise only capabilities demonstrated in installed builds.
- Treat Windows OCR as release-blocking until its real installed lifecycle is validated; the WinRT provider implementation and generated-image recognition test are automated prerequisites, not substitutes for installed evidence.
- Do not imply Wayland, hosted providers, visual search, additional generation
  providers, Vault, or remote sync support unless a later roadmap milestone
  explicitly delivers it. Local Ollama text generation is implemented, but may
  be advertised only after this checklist validates it in installed builds.

## Required configuration and secrets

- `VITE_SUPABASE_URL`
- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Release-time CSP and updater endpoint values required by Tauri configuration

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
cargo test --manifest-path src-tauri/Cargo.toml --bin clipsx-extension-tool
# In a sibling azure06/clipsx-extensions checkout:
npm ci
npm run build:mermaid-ui
npm run sync:katex
# Build each Rust guest for wasm32-unknown-unknown, copy it to its package as
# component.wasm, then use `npm run tool -- pack|validate|test` for each release.
# Release CI, rather than the ClipsX application build, publishes the immutable
# .clipsx assets and deterministic registry-submission metadata.
```

The revision must also pass command-registration drift, schema/reset,
managed-file recovery, render-model, artifact/OCR, extension-sandbox, and output
policy tests.

## Current automated evidence

The repository includes an executable capture → SQLite/managed files → process
restart → reconstruction harness. It currently proves:

- ordered Windows `CF_UNICODETEXT`, HTML Format, Rich Text Format, and
  `CF_HDROP` representations survive restart with their contract identities;
- PNG, PDF, SVG, and supported opaque Office/native bytes survive managed-file
  storage and restart byte for byte;
- CF_HTML fragment offsets, UTF-16 text, registered-text termination, and
  ordered Unicode `CF_HDROP` encoding are correct;
- Original and Plain Text output do not change when renderer preferences do;
- reconstructed self-writes are suppressed only when token and fingerprint
  both match; and
- normalized Windows images retain an observed PNG/`CF_DIBV5`/`CF_DIB`
  identity, while an unavailable identity is not guessed.
- unknown, disabled, redundant, diagnostic-only, unreadable, and oversized
  advertisements produce bounded observations without retaining payload bytes;
- schema-version reset enforcement and restart reconciliation preserve both
  canonical and derived managed-file references.

This evidence does not replace the installed native sequence below. A Windows
development host cannot certify macOS pasteboard APIs, Linux/X11 ownership,
real target focus/paste behavior, permissions, packaging, or signing.

## Shared native clipboard sequence

Run this sequence for every supported format on every advertised platform:

1. Place a fixture on the native clipboard with all expected alternates.
2. Capture one coherent snapshot and inspect representation identity, order,
   storage kind, byte contract, and source application.
3. Restart ClipsX and reload the clip from SQLite and managed files.
4. Reconstruct with Original and inspect native clipboard types and bytes or
   ordered references.
5. Exercise Plain Text independently of the selected renderer.
6. Verify self-write suppression prevents an accidental duplicate.
7. Paste into a real target application and verify focus restoration,
   permissions, diagnostics, and content fidelity.

Unsupported fixtures must follow the matrix's declared skip/reject behavior.
Tests must never infer native identifiers.

## Windows matrix

Required fixtures:

- `CF_UNICODETEXT`
- HTML Format wrapper and fragment offsets
- Rich Text Format
- ordered `CF_HDROP`
- PNG and normalized `CF_DIB`
- registered PDF and SVG
- supported Office/native registered formats with useful alternates
- private/control Office noise present alongside the fixture but retained only
  as observations

Installed-build checks:

- exact registered-format writeback and wrapper regeneration;
- screenshot capture/PNG preview and reconstruction after process restart;
- PNG and SVG preview requests use the platform-correct custom-protocol origin,
  and separate tabs identify the captured format;
- editable same-application Word selections/tables, Excel formulas and
  formatting, and PowerPoint shapes plus single/multiple slides after restart;
- target focus and synthetic paste in representative applications;
- tray, shortcut, close-to-tray, explicit quit, second launch, autostart,
  updater, deep links, OAuth callback, and file dialogs;
- minimize, maximize, close, and snap behavior for the frameless window;
- explicit unsupported OCR state unless Windows OCR has been delivered.

## macOS matrix

Required fixtures:

- `public.utf8-plain-text`
- `public.html`
- `public.rtf`
- ordered `public.file-url`
- PNG, JPEG, and TIFF
- PDF and SVG
- supported Microsoft/native UTIs with useful alternates

Installed-build checks:

- ordered multi-file capture and reconstruction;
- writeback only for explicitly supported captured UTIs;
- frontmost-application restoration and Accessibility permission
  diagnosis/recovery;
- native OCR lifecycle and retry;
- tray, shortcut, close-to-tray, explicit quit, second launch, autostart,
  updater, installed deep links, OAuth callback, and file dialogs.

## Linux/X11 matrix

Required fixtures:

- `UTF8_STRING`
- `text/html`
- `text/rtf` and `application/rtf`
- `image/png`
- `text/uri-list`

Installed-build checks:

- reconstructed X11 selection ownership for the consumer read window;
- XTest quick paste and focus restoration on supported desktop environments;
- OCR runtime detection and recovery when Tesseract is absent;
- the `.deb` recommends `tesseract-ocr`, `tesseract-ocr-eng`, and
  `tesseract-ocr-jpn`; verify those recommendations are present in package
  metadata and that English/Japanese appear in Intelligence after installation;
- AppImage intentionally uses the host runtime. When Tesseract is absent,
  Intelligence must keep ClipsX usable and show the recovery command
  `sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-jpn` on
  Debian/Ubuntu (or the equivalent packages for the distribution); after
  installation, refresh/restart and retry without reinstalling ClipsX;
- tray, shortcut, close-to-tray, explicit quit, second launch, autostart,
  updater, deep links, and file dialogs in published `.deb` and AppImage builds.

Wayland is not covered by this matrix.

## Shared desktop and recovery checks

- First launch and incompatible-schema reset.
- Incorrect reset confirmation changes nothing.
- Partial reset failure remains visible and does not restart automatically.
- Missing updater configuration produces an unavailable state, not a startup
  failure.
- Invalid OAuth callbacks are rejected; the development loopback listener is
  path-bounded and expires.
- Capture exclusions, deduplication, retention, and self-write suppression.
- Original and Plain Text Copy/Paste with alternate renderers selected.
- Search configuration and degraded-state recovery.
- OCR disabled, queued, running, empty-success, success, unsupported, failure,
  and retry states.
- OCR Automatic selection, an explicit English selection, an explicit Japanese
  selection, language-change reprocessing, cancellation while recognition is
  running, and restart recovery. Confirm OCR text reaches keyword and enabled
  semantic search exactly once while canonical image bytes/checksum remain
  unchanged.
- Settings restart behavior, import/export, autostart, periodic auto-clear, and
  explicit-quit clear-on-exit.
- Extension API v1 rejection; v2 manifest/matcher/purpose/surface/action/permission validation.
- Developer installation selects `.clipsx`, discloses declared permissions, and
  covers install/use/disable/failure/quarantine/recovery/uninstall.
- Cached compact presentation survives restart and history scrolling invokes no
  WASM; malformed output falls back to the core row.
- Color Tools detail/compact swatch, HEX/RGB/HSL transforms, contextual Copy
  actions, selected-clip shortcut targeting, conflict handling, and cleanup.
- With local generation disabled, Ask Local AI is visibly disabled with a
  provider reason while local contributions continue to work. After configuring
  Ollama, consent once, run preview/copy/save, then update/disable the package
  and verify the checksum-bound grant is revoked.
- Ask AI enforces Unicode-safe URL limits; Mermaid Viewer 1.0.1 detects supported
  declarations (including `pie` and declarations after comments, init directives,
  or front matter), produces one **Mermaid** tab with its package icon, and renders
  hostile input offline in themed isolated detail/dialog views with source fallback;
  disabling its renderer restores the generic facet-details tab. Text API cannot directly network,
  redirect, reach private addresses, reflect credentials, open popups/downloads,
  or retain a child view after deselection/close.
- On Windows, macOS, and Linux/X11, verify extension child-view bounds, focus,
  keyboard traversal, screen-reader labels, theme synchronization, teardown,
  unresponsive-view recovery, and absence of inherited primary-webview Tauri
  commands using the same signed revision.
- A renderer, transformer, provider, extension, or OCR failure leaves canonical
  representations usable.
- Accessibility and keyboard-only operation for history, previews, actions,
  settings, transforms, and extensions.

## Packaging and signing

- **Windows:** sign installers and executables with the approved certificate;
  verify install, upgrade, uninstall, metadata, and updater behavior.
- **macOS:** sign with the release Developer ID, notarize, staple, and verify on
  a clean machine. Ad-hoc signing is not a release gate.
- **Linux:** verify dependencies and desktop integration for each published
  package format.

Record artifact hashes, signing/notarization results, source revision, OS
version, desktop/session type, package version, fixture, expected result, actual
result, and retained diagnostics.

## Publication sign-off

- Every milestone required by [ROADMAP.md](ROADMAP.md) has met its exit gate.
- Automated preflight ran against the exact release revision.
- Installed artifacts passed the applicable matrices above.
- Release notes state verified behavior, known limitations, fresh-schema/reset
  implications, and updater compatibility.
- Platform capability claims match `platform-format-matrix.json` and recorded
  evidence.
- No secrets, credentials, private clipboard contents, or sensitive logs are
  present in the repository or release artifacts.
