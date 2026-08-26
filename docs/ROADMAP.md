# ClipsX production release re-alignment

This roadmap is the checkbox-driven program for the first production release. Completed stable behavior belongs in [ARCHITECTURE.md](ARCHITECTURE.md), product navigation and settings ownership belong in [PRODUCT_STRUCTURE.md](PRODUCT_STRUCTURE.md), and installed-build evidence belongs in [RELEASE.md](RELEASE.md).

Every item starts unchecked. Mark an item `[x]` only after its acceptance criteria pass and the automated or installed-build evidence is linked from the relevant document or pull request.

## 1. Product correctness and security

- [ ] Finish Settings/Intelligence ownership, command registry, keyboard configuration, resizable layout, localization, and accessibility work already defined in [PRODUCT_STRUCTURE.md](PRODUCT_STRUCTURE.md).
- [ ] Verify every setting's persistence, validation, restart behavior, reset, import/export, and failure handling.
- [x] Implement periodic auto-clear, resolve the 10/50 MiB capture-default conflict, and finish extension uninstall settings retention. Evidence: [host privacy worker](../src-tauri/src/ipc/mod.rs), [secret-expiry test and 50 MiB default](../src-tauri/src/history/repository.rs), and identity-keyed settings in [migration 012](../src-tauri/migrations/012_extension_marketplace.sql).
- [ ] Complete cascade/invalidation coverage for clips, tags, notes, OCR, search, artifacts, extensions, and managed files.
- [ ] Remove raw note/content logging and audit every production log for clipboard data, credentials, tokens, and filesystem paths.
- [x] Replace the unrestricted asset-protocol scope with app-owned asset serving and tighten the main CSP, especially `script-src`. Evidence: [Tauri security configuration](../src-tauri/tauri.conf.json), clip-bound bounded raster preview IPC in [ipc/mod.rs](../src-tauri/src/ipc/mod.rs), and passing CSP/render tests.
- [ ] Add Rust dependency auditing, license/SBOM generation, secret scanning, and release artifact inspection to CI.
- [ ] **Exit gate:** all settings work, canonical data survives optional-feature failures, and the production security review has no unresolved high-severity findings.

## 2. Cross-platform OCR

- [ ] Refactor OCR behind the existing provider contract with runtime availability, version, language, and recovery diagnostics.
- [x] Implement Windows OCR on a dedicated WinRT MTA executor using `Windows.Media.Ocr`; decode bounded image bytes, select installed user languages, and keep all work off the UI thread. Evidence: [native provider](../src-tauri/src/providers/native_ocr.rs), [bounded artifact input and generated-bitmap recognition test](../src-tauri/src/artifacts/host.rs); local Windows runtime/language and real recognition tests pass.
- [ ] Preserve macOS Vision OCR while adding explicit language selection, bounded execution, and real installed-build tests.
- [ ] Harden Linux Tesseract discovery using direct process invocation, expose detected version/languages, document `.deb` dependencies, and provide actionable AppImage recovery instructions.
- [ ] Move OCR execution to a bounded background queue with cancellation, retry, enable/disable, and reprocessing when provider/language configuration changes.
- [x] Correct the provider registry so Windows/Linux availability reflects runtime truth rather than always reporting native OCR as available. Evidence: [async dynamic provider registry](../src-tauri/src/providers/registry.rs) backed by the native provider's real engine/language diagnostics.
- [x] Bump OCR producer provenance so stale derived artifacts rebuild without touching canonical images. Evidence: OCR producer version 3 includes engine version and selected language in [artifact host](../src-tauri/src/artifacts/host.rs); queue lifecycle tests verify canonical image checksums remain unchanged.
- [ ] Verify empty success, failure, unsupported, retry, deletion, indexing, FTS, semantic search, English, and Japanese flows on all advertised platforms.
- [ ] **Exit gate:** Windows, macOS, and Linux/X11 pass the installed OCR lifecycle; Linux clearly recovers when Tesseract or language data is absent.

Implementation candidate: the provider contract, persistent single-flight queue,
configuration sync, Intelligence controls, native language diagnostics, bounded
inputs, cancellation/stale-result rejection, FTS refresh, and CI language-package
setup are implemented. Their boxes remain unchecked until the three-platform CI
run and installed-candidate evidence required above are recorded.

## 3. Lean core and first-party extensions

Core retains clipboard capture/reconstruction; faithful text, HTML/RTF, files, image, PDF, Office, and Original views; cheap, bounded recognition of Markdown, JSON, URL, tables, colors, and Base64-shaped text; built-in Markdown, JSON, table, and basic color-swatch views; secret detection and local-path handling; generic fallback rendering; and all host validation/broker primitives. Recognition is additive derived data used for badges, filtering, search routing, and extension matching. It must not decode Base64, inspect JWT claims, activate links, or otherwise expose or act on latent clipboard content.

Use this boundary for the first production release:

| Layer | Core | First-party extensions |
| --- | --- | --- |
| Recognition | Markdown, JSON, URL, table, color, and conservative Base64-shaped-text facets | Niche or package-specific semantics |
| Render/view | Faithful formats, Markdown, JSON, table, and a basic color swatch | Mermaid and explicit JWT inspection |
| Transform/action | Clipboard reconstruction, local-path opening, and host validation/brokers | Base64 encode/decode, curl-to-fetch, Data Tools conversions, and communication actions |

Core recognition does not imply a core action or rich renderer. In particular, table recognition and viewing stay useful without Data Tools; table export/conversion belongs to Data Tools. Base64 receives only a conservative label in core and is never decoded or previewed until the user explicitly invokes the installed Base64 package.

No extension is installed by default. Users choose the following focused first-party packages from Discover. Small single-purpose packages avoid making users install unrelated tools; Data Tools and Communication Actions remain coherent bundles.

- [x] **Mermaid:** standalone Mermaid and Mermaid fences inside a ClipsX-native enhanced Markdown renderer. Evidence: the offline React/GFM UI in [mermaid-viewer](https://github.com/azure06/clipsx-extensions/tree/main/extensions/mermaid-viewer), three detector tests, light/dark rendered review, CLI pack/validate/inspect/test, and the host package-store install/load acceptance test pass (2026-08-25).
- [x] **JWT Inspector:** decoded token anatomy without claiming signature verification. The package exclusively owns detection, its structured detail view, payload extraction/copy, and JWT-specific catalog/contribution identity; history rows may reuse its icon but never decode claims into preview text, logs, or search. Evidence: [JWT Inspector](https://github.com/azure06/clipsx-extensions/tree/main/extensions/jwt-inspector), removal of the host detector/renderer/decoder in [contributions](../src-tauri/src/contributions/host.rs), package pack/validate/test, payload-copy regression test, and the full Rust suite pass (2026-08-26).
- [x] **Base64:** explicit encode/decode transforms with bounded previews and no automatic decoding. Evidence: [Base64](https://github.com/azure06/clipsx-extensions/tree/main/extensions/base64) detects standard, URL-safe, unpadded, and MIME-bearing data-URL inputs; encodes captured text or binary representations; round-trips explicit media types without reading file-list paths; and passes codec, binary-image, and package tests (2026-08-27).
- [ ] **curl to fetch:** local conversion with an editable, copy-ready result.
- [ ] **Data Tools:** number/date views, JSON formatting/minification, CSV/JSON/Markdown conversion, URL transformations, and HTML-to-Markdown.
- [ ] **Communication Actions:** email/phone detection with Compose and Dial actions.
- [x] Remove Mermaid rendering and the `mermaid` dependency from the main app. Core Markdown shows Mermaid fences as code; installing Mermaid adds an offline enhanced renderer that receives the original Markdown representation and becomes the specific structured view. Evidence: [core renderer](../src/features/clipboard/RenderModelView.tsx), [offline package](https://github.com/azure06/clipsx-extensions/tree/main/extensions/mermaid-viewer), `npm run build` (2026-08-24: main chunk 1.07 MB; no Mermaid/Cytoscape/KaTeX chunks), and package detector tests.
- [x] Add manifest-declared host action handlers for `compose_email` and `dial_phone`. Rust extracts the value from the bound facet, validates it, and invokes only the corresponding OS handler; arbitrary URI schemes remain unavailable. Evidence: [manifest contract](../src-tauri/src/extensions/manifest.rs), [host execution](../src-tauri/src/extensions/service.rs), and [Communication Actions](https://github.com/azure06/clipsx-extensions/tree/main/extensions/communication-actions); focused Rust/package tests pass.
- [ ] Keep local-path opening in core and do not expose generic filesystem activation to extensions.
- [ ] Retain and test the cheap core color detector and its basic core swatch. Add a bounded conservative Base64-shaped-text detector that records no decoded bytes. Package removal must leave these labels useful without exposing latent content.
- [ ] Reconcile retired built-in facets/jobs/definitions and stale renderer preferences as rebuildable data. Saved transform outputs remain valid.
- [ ] Remove unused core detector/renderer/transform code and dependencies after package parity tests pass.
- [ ] Keep Ask AI and Ask Local AI as acceptance fixtures until separately approved for public catalog publication.
- [ ] **Extension quality gate:** every custom view uses host theme/locale/settings, remains keyboard and reduced-motion accessible, loads offline without remote fonts/scripts, signals readiness only after useful content is rendered, and passes its package performance budget.
- [ ] **Exit gate:** disabling or uninstalling every package restores useful core views, never changes canonical clips, and the main application bundle no longer contains Mermaid's runtime.

## 4. Signed GitHub registry, catalog icons, and publication

Use two public repositories:

- `azure06/clipsx-extensions` for first-party package sources, tests, and immutable GitHub Release `.clipsx` assets.
- `azure06/clipsx-registry` for reviewed metadata, catalog icons, revocations, submission templates, and the signed public index.

The currently configured registry URL returns 404 and must exist before release. Follow the VS Code trust pattern: marketplace releases are signed and clients verify them before installation. See the [VS Code Marketplace documentation](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace).

- [x] Extend package manifests with package-level light/dark icons, separate from contribution icons. Evidence: [manifest validation](../src-tauri/src/extensions/manifest.rs).
- [x] Extend registry metadata with catalog light/dark icon URLs and SHA-256 hashes. Use bounded raster catalog assets for pre-install display; installed contribution UI may continue using sanitized package SVGs. Evidence: schema v3 descriptors in [packages.rs](../src-tauri/src/extensions/packages.rs).
- [x] Add icon fields to Rust/TypeScript catalog contracts, cache verified icons by hash, render them in Discover/Installed/detail views, and retain the initial-letter fallback. Evidence: hash-pinned cache tests in [packages.rs](../src-tauri/src/extensions/packages.rs) and themed rendering in [Plugins.tsx](../src/features/settings/Plugins.tsx).
- [ ] Publish exact `index.json` bytes with detached Ed25519 signatures and key IDs. Embed trusted registry public keys in ClipsX and support overlapping signatures for key rotation.
- [x] Verify the registry signature before parsing or caching; then verify package checksum, identity, version, permissions, icon hashes, and archive limits before installation. Evidence: exact-byte/key-overlap and corrupt-icon tests in [packages.rs](../src-tauri/src/extensions/packages.rs); production key publication remains separately unchecked.
- [ ] Treat unsigned local `.clipsx` archives as Developer Mode only, with explicit warnings and no automatic updates.
- [x] Add registry revocations keyed by package ID, version, and checksum; block new installs/updates and quarantine a matching installed release after a verified refresh. Evidence: tuple tests in [packages.rs](../src-tauri/src/extensions/packages.rs) and enforcement in [service.rs](../src-tauri/src/extensions/service.rs).
- [x] Expand the extension CLI from only `pack`/`validate` to `scaffold`, `inspect`, `test`, and `registry-entry`, including compatibility and permission reports. Evidence: [extension tool](../src-tauri/src/bin/clipsx-extension-tool.rs); its end-to-end fixture passes every command.
- [ ] Add first-party release CI that builds WASM, packages, validates, tests, creates draft GitHub Release assets, and emits deterministic registry-submission metadata.
- [ ] Add registry PR CI that downloads the immutable release, independently validates it, verifies metadata/icons/checksums/permission fingerprints, rejects duplicate or downgraded releases, and signs only reviewed merged indexes.
- [ ] Test first install, offline cached catalog, update, permission change, revocation, corrupt index/signature/icon/archive, Developer Mode replacement, and recovery.
- [ ] **Exit gate:** all four packages are visible with icons, downloadable, verifiable, installable, updateable, disableable, and removable through Discover.

## 5. Configuration sync and account completion

Restore and audit the existing inactive `clipsx` Supabase project, then perform development on a branch before promoting migrations.

- [ ] Inventory the restored project's Auth configuration, redirects, schema, grants, migrations, and security/performance advisors.
- [ ] Use desktop PKCE and secure credential storage already present; finish and certify the hosted `/auth/desktop/callback` bridge.
- [ ] Add RLS-protected `sync_devices` and `sync_records` tables. Records carry typed kind/key/payload, tombstone, source device, hybrid logical revision, and monotonic server cursor.
- [ ] Add a security-invoker batch RPC that derives `user_id` from `auth.uid()`, applies only deterministically newer revisions, and returns winning records. Revoke default access and grant only required authenticated operations.
- [ ] Synchronize only whitelisted profile data: theme/language, search behavior, renderer preferences, OCR preference/language, desired registry packages/version policy/enablement, non-secret package settings, and app/extension shortcuts.
- [ ] Keep clips, notes, tags, package archives, device capture/window settings, provider endpoints/models, credentials, grants, jobs, diagnostics, and all derived data local.
- [ ] Add transactional SQLite sync outbox/state tables so each local profile mutation and its pending sync record commit together.
- [ ] Implement startup, post-mutation, periodic, reconnect, and manual sync; support offline edits, deterministic conflicts, tombstones, backoff, and invalid remote-record quarantine.
- [ ] Reinstall synchronized extensions only through the signed registry and require fresh local consent for external capabilities.
- [ ] Replace placeholder Sync UI with status, last success, pending/error state, devices, retry, disable, remote-profile reset, and precise inclusion/exclusion information.
- [ ] Add verified account deletion through a JWT-protected backend function that deletes sync data and then the Auth user; sign-out keeps local data and stops sync.
- [ ] Test first device, second device, concurrent/offline edits, clock skew, deletion, logout/login, revoked device, unavailable package, corrupt payload, RLS isolation, remote reset, and account deletion.
- [ ] Run Supabase security/performance advisors and automated cross-user RLS tests before promotion. Supabase requires grants and owner-scoped RLS together on exposed tables. See the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [ ] **Exit gate:** a second device restores supported configuration and extension intent without receiving clipboard content, secrets, device configuration, or old consent.

## 6. Native packaging and production certification

- [x] Change release automation from every `main` push to a reviewed tag/manual candidate workflow that runs the full preflight on the exact release revision. Evidence: [release candidate workflow](../.github/workflows/release.yml); tag publication requires an exact version match and manual runs remain build-only.
- [ ] Build Windows x64, Linux x64 `.deb`/AppImage, and macOS arm64/x64. Intel support is limited to Apple-supported macOS releases; macOS 26 is Apple's final Intel release. See the [Apple release notes](https://developer.apple.com/documentation/macos-release-notes/macos-26_4-release-notes).
- [ ] Replace ad-hoc macOS signing with Developer ID signing, hardened runtime, notarization, stapling, and installed verification for both architectures.
- [ ] Sign Windows installers/executables and verify install, update, downgrade rejection, and uninstall on a clean machine.
- [ ] Verify Linux desktop integration, X11-only claims, Tesseract recovery, package dependencies, AppImage behavior, and updater support.
- [ ] Validate signed updater metadata and rollback/recovery behavior.
- [ ] Run the complete native clipboard, focus/paste, tray, shortcuts, autostart, deep-link, OAuth, accessibility, extension, sync, OCR, search, and recovery matrices in [RELEASE.md](RELEASE.md).
- [ ] Add a bundle-size budget; confirm removing core Mermaid materially reduces the 1.70 MB minified main chunk and eliminates its diagram/Cytoscape/KaTeX chunks.
- [ ] Update website/download/release messaging to advertise only certified platforms and features.
- [ ] **Exit gate:** signed artifacts from one revision, the signed extension registry, four published packages, production auth/sync, and recorded native evidence all pass before the draft release is published.

## Interface and documentation changes

- Extension manifest: package-level themed icons and typed host handlers for Compose Email/Dial Phone.
- Registry schema: signed index plus detached signatures, catalog icon URLs/hashes, revocations, and key IDs.
- Catalog API: themed verified icon descriptors and revocation status.
- Sync IPC: status, synchronize now, devices, forget device, reset remote profile, and delete account.
- OCR API: provider availability/version/languages/diagnostic plus enabled language preference.
- Update [ARCHITECTURE.md](ARCHITECTURE.md), [EXTENSION_API_V2.md](EXTENSION_API_V2.md), [EXTENSION_THREAT_MODEL.md](EXTENSION_THREAT_MODEL.md), [PRODUCT_STRUCTURE.md](PRODUCT_STRUCTURE.md), and [RELEASE.md](RELEASE.md) alongside implementation wherever stable contracts change.

## Tracking rules and defaults

- All new roadmap work starts as `[ ]`; mark `[x]` only with linked automated or installed-build evidence.
- No extension is installed by default.
- Registry installs require marketplace-style signature verification; unsigned archives remain Developer Mode only.
- Automatic extension updates remain opt-in and cannot cross permission changes.
- Both macOS architectures ship for v0.1; Intel can be removed only after a separately documented support decision.
- Windows OCR blocks release; Linux OCR may rely on system Tesseract only when installation and recovery are explicit and certified.
- Configuration sync blocks release; clipboard-content sync remains post-release.

## Delivery principles

- Preserve independent raw representations before deriving meaning or previews.
- Keep canonical mutations independent from optional derived work.
- Keep renderer selection out of persisted clip state and clipboard output policy.
- Prefer explicit unsupported states to guessed native formats or silent hosted fallback.
- Treat search indexes, embeddings, previews, OCR, and generated output as rebuildable or versioned data.
- Keep providers host-owned and extensions sandboxed, offline by default, and capability-limited.
- Store settings as validated JSON values in SQLite; do not introduce a parallel live JSON file.
- Keep sync scope explicit and narrower than the local data model.
- Keep release claims narrower than unverified installed behavior.

## Legacy V1 reference

The read-only reference is `archive/v1-pre-m0`, commit `d9f1392`, and tag `v1-pre-m0-reference`. Use it only for visual behavior, keyboard interaction, accessibility, tests, and platform format discovery. Do not restore V1 schemas, IPC payloads, sparse metadata, semantic-model services, Vault/entitlement coupling, or compatibility behavior.
