---
name: clipsx-extension-development
description: Develop or diagnose ClipsX extension contracts, host integration, configuration, execution, or package compatibility. Use focused local package review; explicit release certification and publication use clipsx-release.
---

# ClipsX extension development workflow

1. Follow [CodeGraph navigation](../../../AGENTS.md) when the repository is indexed.
   Locate the affected host boundaries and packages before editing. Read only the
   relevant sections of the [API](../../../docs/EXTENSION_API_V3.md),
   [data model](../../../docs/MODELS.md).
2. Take contract versions and limits from the current
   [manifest validation](../../../src-tauri/src/extensions/manifest.rs),
   [WIT](../../../src-tauri/wit/clipsx-extension.wit) and API document. Take the
   database baseline and reset policy from [foundation](../../../src-tauri/src/foundation/mod.rs)
   and the data model. Do not maintain another version or limit list here.
3. Preserve unrelated work. Identify effects on input disclosure, eligibility,
   permissions, configuration snapshots, durable execution and result ownership.
   Invoke [clipsx-ui](../clipsx-ui/SKILL.md) when frontend interactions change.
4. Use focused host checks and the existing package tool commands documented in
   the API. Build only the package being reviewed during local behavior review.
   Sibling repositories are optional task inputs: locate them from the task or
   existing tooling configuration, without assuming a username or checkout path.
5. When the user requests local checkpoints, finish and check the host change,
   then make the requested temporary host commit. Update one package, run its
   focused tests, and provide its built archive with expected manual checks:
   selection/availability, configuration, execution, results, restart and any
   applicable automation or clipboard behavior. Fix observed issues before the
   package checkpoint and the next package. Respect the requested review boundary
   without adding new approval steps. Consolidated release validation comes later;
   do not use cloud CI or publication to discover basic local behavior failures.
6. If a build encounters a locked executable, identify the owning app process
   and development watcher before retrying. Follow existing authorization when
   stopping the task's process; never stop unrelated processes.
7. Update affected authoritative docs and report passed checks separately from
   manual behavior still awaiting review. For explicit release work, use
   [clipsx-release](../clipsx-release/SKILL.md).

Human package build and conformance instructions stay in the API document.
This workflow neither requires all sibling repositories nor grants publication
permission.
