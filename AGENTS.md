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

Load only the guidance relevant to the task. Skills describe workflows and link operating requirements; domain references
own contracts. Code and tests own implementation details.

| Task                                              | Guidance                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Desktop UI interactions                           | [UI skill](.agents/skills/clipsx-ui/SKILL.md)                                                            |
| Extension contracts, integration or compatibility | [Extension skill](.agents/skills/clipsx-extension-development/SKILL.md), [API](docs/EXTENSION_API_V3.md) |
| Explicit release preparation or publication       | [Release skill](.agents/skills/clipsx-release/SKILL.md), [release operations](.agents/skills/clipsx-release/references/operations.md)         |
| Persistence | [Data model](docs/MODELS.md) |
| Search or Recall                                  | [Search architecture](docs/SEMANTIC_SEARCH_ARCHITECTURE.md)                                              |

## Validation

Choose checks that cover the change; documentation-only work needs link and
content validation rather than app builds.

- TypeScript: `npm run type-check`
- Frontend lint: `npm run lint`
- Focused frontend tests: `npx vitest run <test-file>`
- Rust formatting: `cargo fmt --all --manifest-path src-tauri/Cargo.toml --check`
- Rust lint: `npm run lint:rust`
- Focused Rust tests: `npm run test:rust -- <test-filter>`

Release-wide gates remain in the release skill’s operations reference.

## Documentation maintenance

After completing a task, review affected documentation and skills. Update the authoritative source only. Remove obsolete statements and duplication; simplify existing text before adding sections. Describe current behavior, not implementation history. Code and tests own implementation details; retain contracts and operational requirements that cannot be safely inferred. Do not claim passing checks or production availability without evidence. Avoid maintaining roadmaps or completed investigation reports.
