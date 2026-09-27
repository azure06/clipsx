---
name: clipsx-release
description: Prepare explicit ClipsX release-readiness reviews, packaging, installed certification, or publication. Do not load for ordinary fixes or focused local extension behavior checks.
---

# ClipsX release workflow

1. Read the applicable [release requirements](../../../docs/RELEASE.md) and
   [roadmap blockers](../../../docs/ROADMAP.md). Inspect the actual
   [workflow configuration](../../../.github/workflows/) and relevant package
   scripts; documentation is not evidence that a release gate passed.
2. Separate local behavior review, consolidated checks, artifact production,
   installed-platform certification and publication. Use existing commands and
   workflows rather than creating another release script.
3. When extensions are involved, verify the reviewed host tooling used to build
   and validate packages, immutable extension assets, exact registry metadata,
   and the signed catalog/signature pair. Confirm the applicable rollout order:
   host tooling first, extension archives, registry publication, desktop release
   last. A source merge alone does not publish an installable archive.
4. Apply the public platform matrix, signing, recovery and evidence requirements
   from the release document. Record the candidate revision and artifact identity,
   demonstrated results, pending checks and blockers. Do not claim native-platform
   certification from source inspection or a local build.
5. Before an external publication action, confirm authorization already exists
   in the task. Loading this skill does not authorize publishing. Honor existing
   review boundaries without inventing extra approval stages.
6. Report readiness based on evidence and identify the next unresolved gate.
   Update public documentation when the intended release process changes.

Keep detailed operational checklists and certification requirements in the
release document so human maintainers can follow them without skill discovery.
