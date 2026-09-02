# Contributing to ClipsX

Thank you for taking the time to improve ClipsX. Small fixes, careful tests,
clear writing, and well-contained features all make the project better.

## Before you start

Read the [architecture](docs/ARCHITECTURE.md) and the relevant part of the
[roadmap](docs/ROADMAP.md). They describe the domain boundaries and release
work that take precedence over assumptions from unfinished code.

For a new capability or a substantial change, start a GitHub issue or
discussion first. A short shared direction is especially useful for clipboard
formats, persistence, model providers, extensions, and platform behavior.

## Development

Install Node.js, Rust, and the Tauri prerequisites for your platform, then run:

```bash
npm install
npm run tauri:dev
```

Run the smallest checks that cover your change. Common checks are:

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
[Extension API v2](docs/EXTENSION_API_V2.md); review its security model before
designing a package or adding a host capability.
