# ClipsX - Default LLM Instructions

These instructions apply to any LLM working in this repository.

If instructions conflict, use this order:
1. Direct user request
2. Model-specific instruction file such as `CLAUDE.md` or `CODEX.md`
3. This file

## Project Overview
ClipsX is a Tauri desktop app for clipboard history management on macOS, Windows, and Linux.

## Tech Stack
- Frontend: React, TypeScript, Tailwind CSS, Vite
- Backend: Rust, Tauri, SQLite, sqlx, tokio

## Common Commands

### Development
```bash
npm run tauri:dev
npm run dev
```

### Quality
```bash
npm run type-check
npm run lint
npm run format
npm run test
```

### Rust
```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project Structure
```text
src/                    React frontend
src/features/           Feature-oriented UI modules
src/shared/             Shared frontend types and utilities
src-tauri/src/          Rust backend
src-tauri/src/commands/ Tauri IPC commands
src-tauri/src/models/   Domain models
src-tauri/src/repositories/ SQLite persistence
src-tauri/src/services/ Clipboard and platform logic
docs/                   Supporting project documentation
```

## Working Agreement
- Prefer small, targeted changes that match the existing architecture.
- Do not overwrite unrelated user changes.
- Validate with the smallest useful checks after edits.
- Use existing conventions and naming before introducing new patterns.
- Keep documentation and code comments brief and practical.

## Domain-Specific Rules
- Do not guess UTI or OLE clipboard types. If a required type is missing, skip writing that content instead of inventing a fallback.
- For clipboard reconstruction behavior, treat the documented DB-field to clipboard mapping in `src-tauri/src/commands/mod.rs` as the source of truth.
- In shared reconstruction helpers, prefer the `[RECONSTRUCT]` log prefix and avoid `[COPY]`.

## Workflow Notes
- Prefer fast feedback first: language server diagnostics, `npm run type-check`, and targeted Rust checks before full builds.
- Commit whenever a feature or cohesive unit of work is complete so branches and PRs stay small, readable, and easier to review.
- Use conventional commits such as `feat:`, `fix:`, and `refactor:`.
- Do not add AI co-author trailers or agent signatures to commits.

## Maintainer
Gabriele Sato <gabri06e@gmail.com>
