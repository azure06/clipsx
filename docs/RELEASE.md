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
  providers, Vault, or clipboard-content sync support unless a later roadmap
  milestone explicitly delivers it. The narrow configuration-sync contract and
  local Ollama text generation are implemented, but may be advertised only
  after this checklist validates them in installed builds.

## Desktop settings certification

The settings lifecycle and redacted diagnostic logging are implemented. Automated
coverage includes host patch validation, atomic save/reset failure, portable
round trips and exclusions, local outbox publication, offline pending recovery,
cloud-echo protection against automatic installation, and frontend edit ordering.

Local verification for the Desktop settings change: all 244 Vitest tests and
223 Rust application tests passed; 7 existing release-qualification tests remain
ignored. TypeScript checking, ESLint, Rust formatting, and Clippy with warnings
denied passed. These are working-tree checks,
not signed-release certification.

Installed-build certification remains required on Windows, macOS, and Linux/X11:

- Toggle logging off/on and restart in each state; exercise capture, rendering,
  sign-in failures, and native failures with sensitive sentinel values. Confirm
  diagnostics honor the toggle and never contain the sentinel content or secrets.
- Change autostart and always-on-top, restart, induce an OS refusal, and recover
  using Retry. Test conflicting shortcut registration and rollback failure.
- Export/import while signed out and with sync enabled, resolve missing packages
  and conflicting commands, and verify no automatic installation or copied grants.
- Reset settings and verify native defaults, logging enabled, app shortcut defaults,
  and preserved clipboard history, account, Intelligence, and extension configuration.
- Verify new Settings controls and recovery messages in English and Japanese with
  keyboard navigation and the platform screen reader.

Schema version 9 uses the documented pre-release reset flow for older databases.
No installed cross-platform certification or release-artifact log audit is implied
by the automated checks above.

## Required configuration and secrets

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_NEXT_PUBLIC_SITE_URL`
- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Release-time CSP and updater endpoint values required by Tauri configuration

Registry verification keys are public trust roots compiled into ClipsX, not
release secrets. Key rotation must ship an overlapping trusted key set before
the registry starts signing with the replacement key.

Secrets belong in CI or the platform signing environment. Never commit them,
print them in logs, or store them in application SQLite.

For a production-connected local smoke test, copy `.env.production.example` to
the ignored `.env.production.local` and run `npm run tauri:dev:production`. The
command validates non-loopback HTTPS origins, rejects secret/service-role keys,
generates the matching CSP, runs Vite in production mode so OAuth uses the hosted
PKCE bridge, and starts the Rust host in release mode. This is not a signed or
certified distributable build and must never be used for destructive test data.

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
- Copy plain text appears only for a captured `text/plain` representation and
  preserves its exact Unicode and whitespace;
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

### Section 1 implementation evidence (2026-09-10)

The in-repository product-completion work has automated evidence for:

- device-local splitter validation/persistence and separator-aware wide and
  narrow geometry; keyboard and pointer behavior remain installed-UI checks;
- atomic capture/profile/device setting writes that retain host-only storage
  limits and run retention after commit;
- durable semantic cleanup intent recorded with clip deletion and retained after
  clip-owned indexing jobs cascade;
- a host-owned configurable command catalog with recorded-key editing, explicit
  save/cancel/reset states, and effective bindings for search, clip actions,
  sharing, and quick slots;
- all-or-nothing multi-file share preparation plus exclusive, fsynced staging
  exports.

The verification commands completed with 232 frontend tests and 215 passing
Rust application tests (7 intentionally ignored qualification tests), plus
TypeScript, ESLint, and Clippy with warnings denied. Installed NVDA, VoiceOver,
Orca, native sharing, security-review disposition, artifact inspection, and
signed-out Sponsors checks remain external release gates; this automated record
does not mark them complete.

## Shared native clipboard sequence

Before platform clipboard certification, verify account storage in an installed
Windows build: complete browser sign-in with a session larger than the Windows
Credential Manager limit, restart and restore it, refresh the token and restart
again, then sign out and confirm it remains signed out. Corrupt the DPAPI file
in an isolated test profile and verify **Reset local sign-in** recovers the
account UI without removing clipboard history, settings, or unrelated
credentials. Repeat with an unwritable authentication directory and record the
recoverable error.

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
- WinRT OCR availability, installed-language discovery, automatic and explicit
  language selection, recognition, retry, cancellation, and restart recovery.
- Windows Share Sheet receives URLs as links, exact plain text as text, and
  existing/exported files as storage items without closing the preview.

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
- the native sharing picker receives URLs, exact text, single files, and ordered
  multiple files without closing the preview;
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
- the desktop portal asks which application should open each explicitly shared
  exported item; cancellation leaves ClipsX and the clip unchanged.

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
- Share Unicode text, URLs, existing and missing file references, images, PDFs,
  typed documents, and unsupported native data. Verify duplicate clicks are
  blocked, corrupt managed assets are rejected, cancellation is harmless, and
  share staging never includes notes, tags, source metadata, OCR, or rendered
  extension output.
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
- Ask AI enforces Unicode-safe URL limits; Mermaid detects supported
  declarations (including `pie` and declarations after comments, init directives,
  or front matter), produces one **Mermaid** tab with its package icon, and renders
  hostile input offline in themed isolated detail/dialog views with source fallback;
  disabling its renderer restores the generic facet-details tab.
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
