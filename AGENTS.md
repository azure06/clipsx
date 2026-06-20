# AGENT.md

## Purpose

This repository uses AI coding agents (Codex, ChatGPT, Claude Code, etc.) to assist with development.

Agents should prioritize:

1. Correctness
2. Maintainability
3. Consistency with the existing codebase
4. Minimal, focused changes
5. Clear explanations of tradeoffs

---

## General Rules

### Understand Before Changing

Before making modifications:

* Read relevant files and surrounding code.
* Understand existing architecture and conventions.
* Prefer extending existing patterns over introducing new ones.

### Keep Changes Small

* Avoid unnecessary refactors.
* Do not rewrite working code unless explicitly requested.
* Limit changes to the scope of the task.

### Ask When Uncertain

If requirements are ambiguous:

* State assumptions clearly.
* Prefer asking for clarification rather than guessing.

---

## Code Quality

### Rust

* Follow idiomatic Rust practices.
* Prefer explicit error handling.
* Avoid unnecessary cloning and allocations.
* Keep functions focused and reasonably small.

### TypeScript / JavaScript

* Prefer strict typing.
* Avoid `any` unless unavoidable.
* Follow existing project patterns.
* Favor readability over cleverness.

---

## Formatting

Before creating a commit, ALWAYS run:

```bash
cargo fmt --all                # Rust code under src-tauri
npm run format                 # JavaScript/TypeScript formatting via Prettier
```

Formatting is mandatory even if the change appears small.

---

## Testing

When applicable:

* Run affected tests.
* Add tests for new functionality.
* Update existing tests when behavior changes.

Preferred order:

```bash
cargo test
npm test
```

Run only relevant test suites when full test execution would be excessive.

---

## Dependencies

* Do not introduce new dependencies unless necessary.
* Prefer existing libraries already used in the repository.
* Explain why a new dependency is required.

---

## Commits

Create concise commit messages.

Format:

```text
<type>: <short description>
```

Examples:

```text
fix: prevent duplicate window initialization
feat: add semantic search cache
refactor: simplify embedding pipeline
```

---

## Pull Requests

Include:

* Summary of changes
* Reason for change
* Testing performed
* Known limitations

---

## Security

Never:

* Commit secrets
* Hardcode credentials
* Log sensitive information
* Disable security checks without justification

---

## Agent Behavior

When making changes:

1. Inspect relevant files first.
2. Explain the planned approach.
3. Make the smallest reasonable change.
4. Run required formatting commands.
5. Run relevant tests.
6. Summarize exactly what changed.
7. Report any remaining concerns or assumptions.

If a requested change appears unsafe, incorrect, or likely to introduce regressions, explain the risk before proceeding.
