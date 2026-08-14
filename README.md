# ClipsX

ClipsX is a local-first programmable clipboard for macOS, Windows, and
Linux/X11:

```text
Capture -> Understand -> Render / Transform -> Copy or Paste
```

It is built with Tauri 2, Rust, React, TypeScript, SQLite, and optional local
Ollama text embeddings.

## Current work

The multi-representation foundation, typed previews, local search, extension
runtime, and settings workflows are implemented. ClipsX is not yet
release-certified: active work is installed-build platform validation,
transform parameter UX, extension update/diagnostics, settings/OCR hardening,
and packaging/signing.

The maintained documentation is:

- [Architecture](docs/ARCHITECTURE.md) — stable design and invariants.
- [Extension API v2](docs/EXTENSION_API_V2.md) — package, WIT, and sandbox contract.
- [Roadmap](docs/ROADMAP.md) — unfinished work and release gates.
- [Release](docs/RELEASE.md) — native validation, packaging, and publication gates.

## Architecture invariants

- One capture owns independent raw representations; it has no persisted global
  content type.
- Semantic facets are additive derived data with source provenance.
- Binary clipboard payloads live in managed application files; SQLite stores
  metadata and relative paths.
- Renderer selection is ephemeral UI policy.
- Search projections, embeddings, previews, OCR, and generated output are
  rebuildable or versioned derived data.
- Copy and paste reconstruct only explicitly supported platform formats.
- The V2 schema is fresh. Legacy databases use the explicit reset flow; there
  are no V1 migrations or dual reads.

## Development

```bash
npm install
npm run type-check
npm test -- --run
npm run tauri:dev
```

`npm run tauri:dev` and `npm run tauri:build` require `VITE_SUPABASE_URL` so the
generated Tauri CSP can allow only the configured authentication origin.
Release builds additionally require the secrets listed in
[Release](docs/RELEASE.md).

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
docs/                        Architecture, extension API, roadmap, and release gates
```

Future candidates and the archived V1 reference policy are maintained in the
[Roadmap](docs/ROADMAP.md#post-release-candidates).
