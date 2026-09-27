# AGENTS.md

ClipsX is a Tauri desktop clipboard app. React/TypeScript lives in `src/`,
Rust in `src-tauri/`, and shared frontend controls in `src/shared/components/ui/`.

## Repository rules

- Preserve unrelated working-tree changes.
- Use conventional commits; do not add AI co-author trailers.
- Reuse shared UI components and preserve the app style. Use the UI skill for frontend interactions.
- Update affected documentation when behavior or architecture changes. Describe the current intended system, not change history.
- Run relevant checks and add meaningful regression tests when behavior changes.

## Navigation

When `.codegraph/` exists, use CodeGraph before broad searches or file reads to
locate or understand code: the `codegraph_explore` MCP tool or
`codegraph explore "<symbol or question>"`. If unavailable, use targeted `rg`
searches. Skip CodeGraph in repositories without an index.

## Task routing

Load only the guidance relevant to the task. Skills describe workflows; docs
remain authoritative for behavior and requirements.

| Task                                              | Guidance                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Desktop UI interactions                           | [UI skill](.agents/skills/clipsx-ui/SKILL.md)                                                            |
| Extension contracts, integration or compatibility | [Extension skill](.agents/skills/clipsx-extension-development/SKILL.md), [API](docs/EXTENSION_API_V3.md) |
| Explicit release preparation or publication       | [Release skill](.agents/skills/clipsx-release/SKILL.md), [release requirements](docs/RELEASE.md)         |
| Architecture or persistence                       | [Architecture](docs/ARCHITECTURE.md), [data model](docs/MODELS.md)                                       |
| Search or Recall                                  | [Search architecture](docs/SEMANTIC_SEARCH_ARCHITECTURE.md)                                              |
| Product scope and blockers                        | [Roadmap](docs/ROADMAP.md)                                                                               |

## Validation

Choose checks that cover the change; documentation-only work needs link and
content validation rather than app builds.

- TypeScript: `npm run type-check`
- Frontend lint: `npm run lint`
- Focused frontend tests: `npx vitest run <test-file>`
- Rust formatting: `cargo fmt --all --manifest-path src-tauri/Cargo.toml --check`
- Rust lint: `npm run lint:rust`
- Focused Rust tests: `npm run test:rust -- <test-filter>`

Release-wide gates remain in the release document.
