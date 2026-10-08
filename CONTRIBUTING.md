# Contributing to ClipsX

Thank you for taking the time to improve ClipsX. Small fixes, careful tests,
clear writing, and well-contained features all make the project better.

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). For help using
the app, see [SUPPORT.md](SUPPORT.md). Report vulnerabilities privately through
[SECURITY.md](SECURITY.md), rather than a public issue or pull request.

## Before you start

Read the relevant [data model](docs/MODELS.md), [extension contract](docs/EXTENSION_API_V3.md) or [search reference](docs/SEMANTIC_SEARCH_ARCHITECTURE.md). Inspect current code and tests for implementation details.

For a new capability or a substantial change, start a
[GitHub issue](https://github.com/azure06/clipsx/issues/new/choose) first. A short shared direction is especially useful for clipboard
formats, persistence, model providers, extensions, and platform behavior.

Search existing issues before opening a report. Use the bug, feature, or question
form and include only synthetic clipboard examples and sanitized diagnostics.

## Pull requests

Create a focused branch from the latest `develop` and open the pull request
against `develop`, unless the maintainer requests another target. Explain the
problem, resulting behavior, relevant validation, and limitations using the PR
template. Link an issue when applicable; small fixes do not require a separate issue.

The maintainer reviews contributions as time permits and may request changes
before merging. Keep follow-up commits focused on the same problem. First-time
contributors are welcome to ask for direction before taking on a change.

## Development

Install Node.js, Rust, and the Tauri prerequisites for your platform, then run:

```bash
npm install
npm run tauri:dev
```

Run the smallest checks that cover your change. Documentation-only changes need
content and link checks instead of app builds. Common checks are:

```bash
npm run type-check
npm test -- --run
npm run lint
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features --bin clipsx
```

`npm run tauri:dev` and `npm run tauri:build` require `VITE_SUPABASE_URL` to
generate the Tauri content-security policy.

## Working agreements

- Keep changes focused and explain the user-facing reason for them.
- Preserve clipboard fidelity. Platform adapters handle native format details;
  do not guess platform identifiers or silently downgrade an original capture.
- Treat captured representations as canonical and search, OCR, previews,
  embeddings, and generated results as derived or versioned data.
- Keep secrets and clipboard content out of logs, tests, and commits.
- Add or update tests when behavior changes, and update stable documentation
  when an architectural or persistence boundary changes.
- Use conventional commit messages. Do not add AI co-author trailers.

## Extensions

Extensions are sandboxed WebAssembly packages. Their public contract is the
[Extension API v3](docs/EXTENSION_API_V3.md); review its security model before
designing a package or adding a host capability.

## Agent workflows

[AGENTS.md](AGENTS.md) routes agent tasks to repository skills for UI work,
extension development and explicit release preparation. Architecture, package
build instructions and release requirements remain in the public documentation.
