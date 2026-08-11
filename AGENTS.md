# AGENTS.md

## Architecture

ClipsX is being redesigned as a local-first programmable clipboard:

```text
Capture -> Understand -> Render / Transform -> Copy or Paste
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the source of truth for stable
system design, domain boundaries, and architecture invariants.
[`docs/ROADMAP.md`](docs/ROADMAP.md) defines milestone scope, sequencing, and
acceptance criteria. Read the relevant sections before architectural or
persistence changes; documentation takes precedence over assumptions inferred
from the in-progress source tree.

* One capture has independent raw representations, additive semantic facets,
  and rebuildable derived data. Do not reintroduce a single `ClipItem` content
  type or sparse metadata model.
* Store binary clipboard payloads in managed application files, with metadata
  and relative paths in SQLite; do not add generic clipboard-payload BLOB or
  JSON-metadata storage.
* Renderer selection is UI policy, not persisted clip state.
* Search indexes, embeddings, previews, OCR, and generation output are
  rebuildable or versioned derived data, not canonical clip metadata.
* Use the fresh domain-prefixed schema and documented reset flow. Do not add
  v1 migrations, compatibility reads/writes, or dual schemas.

## Legacy v1

[`docs/LEGACY_V1_REFERENCE.md`](docs/LEGACY_V1_REFERENCE.md) identifies the
read-only `archive/v1-pre-m0` branch and tag. It may inform visual behavior,
keyboard interaction, accessibility, tests, and platform format discovery;
do not restore v1 schema, IPC payloads, semantic-model services, sparse
metadata, or compatibility behavior.

## Clipboard Fidelity

* Do not guess UTI, OLE, or other native clipboard types.
* Reconstruct only formats explicitly supported by the platform adapter;
  adapters regenerate platform wrappers when needed.
* The architecture document's representation byte contract and supported-format
  matrix are the capture and reconstruction source of truth, not legacy code.
* Use `[RECONSTRUCT]`, not `[COPY]`, for shared reconstruction-helper logs.

## Workflow

* Make minimal, focused changes and preserve local conventions.
* Whenever a change affects the architecture, system design, domain
  boundaries, persistence model, or architecture invariants, update
  the relevant stable architecture document in the same change so it
  remains the source of truth.
* Add dependencies only when necessary and explain why.
* Run the smallest relevant checks; common commands are `npm run type-check`,
  `npm run lint`, `cargo fmt --all`, `cargo clippy --manifest-path
  src-tauri/Cargo.toml`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
* Use conventional commit messages and do not add AI co-author trailers.
* Never commit secrets, hardcode credentials, or log sensitive information.
