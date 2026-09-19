# AGENTS.md

ClipsX is a Tauri desktop clipboard app. The React/TypeScript frontend lives in
`src/`; the Rust backend lives in `src-tauri/`.

## Project docs

Read the docs relevant to the task:

- [Architecture](docs/ARCHITECTURE.md): boundaries and invariants.
- [Roadmap](docs/ROADMAP.md): current and planned scope.
- [Extension API](docs/EXTENSION_API_V2.md): extension contract.
- [Semantic search](docs/SEMANTIC_SEARCH_ARCHITECTURE.md): meaning search and Recall.
- [Release](docs/RELEASE.md): release and platform validation.

Update affected docs when behavior changes. Describe the intended system, not
the history of the change.

## Workflow

- Make minimal, focused changes and preserve local conventions.
- Preserve unrelated work already in the working tree.
- Add dependencies only when necessary and explain why.
- Use conventional commit messages and do not add AI co-author trailers.
- Never commit secrets, hardcode credentials, or log sensitive information.

## Validation

Run the checks relevant to the change:

- TypeScript: `npm run type-check` and `npm run lint`.
- Frontend tests: `npx vitest run <test-file>`.
- Rust formatting: `cargo fmt --all --manifest-path src-tauri/Cargo.toml --check`.
- Rust lint: `npm run lint:rust`.
- Rust tests: `npm run test:rust -- <test-filter>`.

Add or update tests for changed behavior when appropriate. Report what you
checked and anything you could not verify.
