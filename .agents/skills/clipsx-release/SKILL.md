---
name: clipsx-release
description: Prepare and operate ClipsX desktop release candidates, Windows signing, installed certification and merge-triggered publication. Excludes ordinary app fixes and extension-only publication.
---

# ClipsX release workflow

Read [release requirements](../../../docs/RELEASE.md) and
[roadmap blockers](../../../docs/ROADMAP.md) before release work. Inspect the actual
workflows and candidate artifacts; documentation and source checks do not prove
installed certification.

## Select the operation

- **Prepare:** align npm/Cargo/Tauri versions, write versioned release notes, then
  push `release/<version>`. Preparation creates an unpublished candidate identified
  by source revision/tree, workflow run and attempt.
- **Windows signing:** use the documented `scripts/release/sign-windows.ps1` command
  after the maintainer authenticates SimplySign. It signs and packages CI inputs,
  uploads and requests finalization. Never sign only the outer installer or rebuild
  its executable locally. Keep updater keys in CI.
- **Finalize:** run Finalize release candidate on main for an exact candidate ID.
  Require all platform assets and native verification evidence; signatures must
  verify against the retained updater public key and final bytes.
- **Certify:** collect the installed-platform and upgrade evidence required by the
  release document. Run Certify candidate only after those checks actually pass.
  The confirmation binds exact source and complete artifact inventory.
- **Publish/retry:** merge the certified release PR. Publication promotes the
  existing draft without rebuilding. For an operational failure, rerun Publish
  certified release with the merged PR number. Do not replace conflicting tags
  or regenerate certified artifacts.
- **Initial setup:** follow release documentation for Apple/Windows credentials,
  public production variables, website deployment and readiness-rule activation.
  Enable the rule only after the workflow exists on main.

## Invariants

A source push or newer build supersedes old candidates. Changed bytes invalidate
certification. Candidate ID, commit/tree, run/attempt, package hashes, signing
evidence and installed evidence are the release identity. Record demonstrated
results, pending checks and blockers; never infer certification from a source
review, local compile, CI package inspection or a checked checkbox.

Retain the embedded Tauri updater public key and endpoint. Production manifests
route by platform, architecture and installer format. No private fixture updater
configuration belongs in production. Verify the public endpoint after publication.

Keep detailed commands, credential requirements, recovery and certification
checklists in [RELEASE.md](../../../docs/RELEASE.md), not duplicated here.
Use the pipeline's existing commands; do not invent an alternate release process.

Extension archives and registry publication remain separate. Route them to the
[extension release skill](https://github.com/azure06/clipsx-extensions/blob/main/.agents/skills/clipsx-extension-release/SKILL.md)
and [registry publication skill](https://github.com/azure06/clipsx-registry/blob/main/.agents/skills/clipsx-registry-publication/SKILL.md).
Desktop certification follows their published immutable packages and signed
catalog.

Before an external mutation, use authorization already present in the task.
Loading this skill does not itself authorize publication. Avoid adding approval
steps when the user has already authorized the relevant action.
