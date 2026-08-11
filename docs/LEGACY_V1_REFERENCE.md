# Legacy v1 implementation reference

The complete pre-M0 ClipsX implementation is preserved on the local Git branch
`archive/v1-pre-m0` at commit `d9f1392`. The same snapshot is also marked by
the `v1-pre-m0-reference` tag.

This branch is read-only reference material for M1 and later work. It preserves
the original visual system, keyboard behavior, platform adapters, tests, and
user-facing interactions without keeping any v1 database or runtime
compatibility in the v2 application.

Use the archive to inspect a prior path, for example:

```bash
git show archive/v1-pre-m0:src/features/clipboard/ClipboardHistory.tsx
git show archive/v1-pre-m0:src-tauri/src/services/clipboard_platform.rs
git diff archive/v1-pre-m0 -- src/features
```

Recommended reuse boundaries:

- Reuse visual layout, keyboard interaction, accessibility, and presentation
  ideas from `src/features`, `src/shared`, and their tests.
- Use old platform adapters as format-discovery reference only; reimplement
  capture and reconstruction through the v2 representation contracts and
  platform matrix.
- Do not restore v1 schema, `ClipItem`, sparse metadata, legacy IPC payloads,
  migrations, semantic-model services, or dual-read/write behavior.

Current parity target: reuse every reachable desktop interaction and visual
behavior through the v2 representation/facet/rendering contracts. The v1 vault
and entitlement flows are excluded because they were incomplete and do not
belong to the current delivery. The hard-wired visual model is deferred in
favor of the v2 provider boundary.

See [UI_PARITY.md](UI_PARITY.md) for the authoritative feature-by-feature
delivery status. Visual equivalence permits replacing component internals with
v2 contracts; it never permits reintroducing v1 persistence or IPC.

The archive branch must not be deleted until the v2 replacement has reached
feature parity for the behavior it documents.
