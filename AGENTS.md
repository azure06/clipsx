# AGENTS.md

## Purpose

This repository uses AI coding agents to assist with development.

Priorities:

1. Correctness
2. Maintainability
3. Consistency with the existing codebase
4. Minimal, focused changes

## Instruction Priority

If instructions conflict, use this order:

1. Direct user request
2. Repository-specific instruction files (e.g. CLAUDE.md, CODEX.md)
3. This file

## Project Overview

ClipsX is a Tauri desktop application for clipboard history management on macOS, Windows, and Linux.

### Tech Stack

* Frontend: React, TypeScript, Tailwind CSS, Vite
* Backend: Rust, Tauri, SQLite, sqlx, tokio

### Project Structure

```text
src/                    React frontend
src/features/           Feature-oriented UI modules
src/shared/             Shared frontend types and utilities
src-tauri/src/          Rust backend
src-tauri/src/commands/ Tauri IPC commands
src-tauri/src/models/   Domain models
src-tauri/src/repositories/ SQLite persistence
src-tauri/src/services/ Clipboard and platform logic
docs/                   Supporting documentation
```

## Before Changing Code

* Read affected files and surrounding code.
* Follow existing architecture and conventions.
* Extend existing patterns before introducing new ones.
* Avoid unnecessary refactors.
* Limit changes to the requested scope.

## When Requirements Are Unclear

* State assumptions explicitly.
* Prefer asking for clarification over guessing.

## Domain-Specific Rules

* Do not guess UTI or OLE clipboard types. If a required type is unavailable, skip writing that content.
* Treat the documented DB-field → clipboard mapping in `src-tauri/src/commands/mod.rs` as the source of truth for clipboard reconstruction.
* In shared reconstruction helpers, prefer the `[RECONSTRUCT]` log prefix and avoid `[COPY]`.

## Code Quality

### Rust

* Follow idiomatic Rust practices.
* Prefer explicit error handling.
* Avoid unnecessary cloning and allocations.
* Keep functions focused and reasonably small.

### TypeScript

* Prefer strict typing.
* Avoid `any` unless unavoidable.
* Follow existing project patterns.
* Favor readability over cleverness.

## Validation

Run the smallest relevant checks for the change.

Common commands:

```bash
npm run type-check
npm run lint
npm run format

cargo fmt --all
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Testing

When behavior changes:

* Run relevant tests.
* Add or update tests when appropriate.
* Prefer targeted validation before full test suites.

## Dependencies

* Do not introduce new dependencies unless necessary.
* Prefer existing libraries already used by the project.
* Explain why a new dependency is required.

## Commits

Use conventional commit messages:

```text
<type>: <short description>
```

Examples:

```text
fix: prevent duplicate window initialization
feat: add semantic search cache
refactor: simplify embedding pipeline
```

Do not add AI co-author trailers or agent signatures.

## Security

Never:

* Commit secrets.
* Hardcode credentials.
* Log sensitive information.
* Disable security checks without justification.

## Agent Workflow

1. Inspect relevant files.
2. Explain the intended approach.
3. Make the smallest reasonable change.
4. Run relevant formatting and validation commands.
5. Summarize exactly what changed.
6. Report assumptions, limitations, or remaining concerns.
