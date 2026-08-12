# ClipsX

ClipsX is a local-first programmable clipboard for macOS, Windows, and Linux/X11:

```text
Capture -> Understand -> Render / Transform -> Copy or Paste
```

It is built with Tauri 2, Rust, React, TypeScript, SQLite, and optional local Ollama text embeddings.

## Current status

The V2 data and service foundation is implemented: multi-representation capture, managed binary files, additive facets, renderer resolution, transformations, FTS, Ollama embedding spaces, local artifacts, macOS/Linux OCR paths, and the WASM extension runtime. Windows OCR remains missing.

Desktop Boundary Recovery is also implemented. Startup reset, IPC drift detection, tray/window behavior, deep links, single instance, autostart, updater, filesystem access, OAuth callback wiring, and Windows window controls now use V2 host boundaries. These integrations still need interactive validation on every supported platform.

Typed Presentation Boundary Recovery is verified by automated Rust and React tests. Every `RenderModel` now renders through one exhaustive typed dispatcher; structured tables/trees/key-value data, safe HTML/RTF, Office alternates, ordered file references, and the full OCR lifecycle stay intact without legacy `Content` conversion or fabricated metadata.

The next milestone is R3 clipboard fidelity and output validation across capture, persistence, restart, reconstruction, and real target-application paste.

See [Documentation](docs/README.md) for the authoritative current state and execution order.

## Architecture invariants

- One capture owns independent raw representations; it has no persisted global content type.
- Semantic facets are additive derived data with source provenance.
- Binary clipboard payloads live in managed application files; SQLite stores metadata and relative paths.
- Renderer selection is ephemeral UI policy.
- Search projections, embeddings, previews, OCR, and generated output are rebuildable or versioned derived data.
- Copy and paste reconstruct only explicitly supported platform formats.
- The V2 schema is fresh. Legacy databases use the explicit reset flow; there are no V1 migrations or dual reads.

## Implemented foundations

- Multi-representation clipboard capture and coherent snapshot retry
- Original, plain-text, and transformed output policies
- History pagination, favorites, pins, notes, tags, filters, retention, and managed-file cleanup
- Built-in detectors, renderers, and transformers
- FTS5 plus optional loopback Ollama text embeddings
- Native-local OCR/artifact pipeline where a platform runtime is available
- Capability-free WASM detector, renderer, and transformer extensions
- Tray, shortcut, close-to-tray, deep-link, single-instance, autostart, updater, and startup recovery wiring

“Implemented” does not imply release validation. The exact verified, partial, missing, and deferred behavior is tracked in [UI_PARITY.md](docs/UI_PARITY.md).

## Development

```bash
npm install
npm run type-check
npm test -- --run
npm run tauri:dev
```

`npm run tauri:dev` and `npm run tauri:build` require `VITE_SUPABASE_URL` so the generated Tauri CSP can allow only the configured authentication origin. Release builds additionally require the secrets listed in [RELEASE.md](docs/RELEASE.md).

Common checks:

```bash
npm run lint
npm run format:check
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features --bin clipsx
```

## Repository map

```text
src/                         React desktop UI and typed V2 presentation contracts
src-tauri/src/app/           Desktop composition and host/window behavior
src-tauri/src/clipboard/     Platform capture and reconstruction adapters
src-tauri/src/history/       Canonical history domain and repository
src-tauri/src/contributions/ Built-in detector, renderer, and transformer host
src-tauri/src/artifacts/     OCR and other derived artifacts
src-tauri/src/search/        FTS and semantic indexing/search
src-tauri/src/extensions/    Package validation, registry, and WASM runtime
src-tauri/src/ipc/           Tauri commands and runtime orchestration
docs/                        Architecture, status, recovery plan, and release gates
```

## Explicitly deferred or excluded

- Encrypted Vault and entitlement gating
- Remote/cloud clipboard sync
- The old hard-wired visual search/model stack
- Optional local visual semantic search until it fits the provider architecture
- Hosted embedding providers, vision, and generation workflows

The archived V1 source remains a read-only behavioral reference at `archive/v1-pre-m0`; see [LEGACY_V1_REFERENCE.md](docs/LEGACY_V1_REFERENCE.md).
