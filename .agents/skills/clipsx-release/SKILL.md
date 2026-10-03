---
name: clipsx-release
description: Build and operate ClipsX desktop release candidates, retry preparation from saved builds, sign Windows, certify installed artifacts and publish on merge. Excludes ordinary app fixes and extension publication.
---

# ClipsX release workflow

Read [release requirements](../../../docs/RELEASE.md) and
[roadmap blockers](../../../docs/ROADMAP.md). Inspect actual workflow runs and
draft inventories; build success is not installed-platform certification.

## Choose the operation

- **Build:** align npm/Cargo/Tauri versions and release notes. Run shared app
  preflight locally on changed app/build inputs before pushing `release/<version>`.
  Release builds perform frontend checks/build once and native tests/optimized
  compilation once per platform. Record the successful build ID.
- **Prepare/retry:** execute **Prepare release candidate** from deployed trusted
  `main` with explicit `build_run_id`. Enter `candidate_id` to resume;
  `target=missing` preserves successes. Select a platform explicitly to replace it
  before finalization. Corrected packaging scripts can consume older saved builds:
  never restart application compilation/tests just to retry signing/notarization.
  Summaries print exact IDs and next actions. `pr_number` selects the candidate;
  automatic preparation must preserve an existing PR selection.
- **Saved 0.1.0 rollout:** use build `36969301315`, candidate
  `0.1.0-36969301315-1`, `target=missing`, PR `27`. The documented narrow adapter
  verifies original artifacts/evidence, records schema migration and preserves
  Mac/Linux bytes. Infrastructure validation must not publish or create a
  production tag.
- **Windows:** authenticate SimplySign and GitHub CLI, then use the documented
  helper with **CandidateId**, not an execution-attempt guess. It packages/signs
  the saved executable, installer and uninstaller, verifies original image identity,
  uploads and dispatches finalization. Keep updater private keys exclusively in CI.
- **Finalize:** dispatch **Finalize release candidate** on main for the exact ID.
  Require every advertised platform and native evidence. Verify final signatures
  against the retained public key. Completed retries verify existing finalized
  files; never regenerate certified bytes.
- **Mac runtime:** require entitlement evidence and the signed cold-cache probe. For 0.1.1 onward, installed extension installation/action/restart evidence on both Macs and `mac_extensions_passed=true` are required. Retained debug symbols must match the selected executable.
- **Certify:** collect real Windows, both Mac, AppImage/deb installed and private
  upgrade-fixture evidence. Dispatch **Certify candidate** with exact ID, release
  PR, evidence URL and explicit confirmation only after all checks pass.
- **Approved 0.1.0 exception:** only candidate `0.1.0-36969301315-1` / PR `27` may record the owner-approved updater deferral. Follow the exact inputs in RELEASE.md; future releases retain full testing requirements.
- **Publish/retry:** merge the certified release PR. Publication verifies merged
  app inputs and publishes existing certified files. Retry **Publish certified
  release** with merged PR number; reuse files and reject conflicting tags.
- **Infrastructure:** change tooling through an infrastructure-only PR, run focused
  release/workflow/PowerShell/verifier/skill checks, then deploy to main before
  dispatch. Prove aggregate CI before replacing obsolete required check names;
  retain readiness and unrelated protections.

## Identity and boundaries

Newer builds do not invalidate selected candidates. Compare the central app-input
inventory with release source; docs/signing tooling may differ. Public production
variable changes require a new build. Record build source and release-tooling
revisions separately; immutable artifact IDs/attempt provenance are evidence,
not a mechanism for choosing a release. Reject mixed/expired/tampered inputs.

Finalized/certified candidates are immutable. Certification binds the selected
PR, notes, build provenance and complete inventory. App-source mismatches block
readiness/publication; orchestration failures must fail visibly. Never infer
installed success from CI inspection or a checkbox without evidence.

Retain updater key/endpoint and public downloads schema 1. Loopback-only fixture
configuration must not enter production artifacts. Verify public discovery and
installation after publication when an older public build exists.

Keep commands, credentials, recovery and installed checklists in
[RELEASE.md](../../../docs/RELEASE.md). Website metadata and extension/registry
publication remain separate. Use existing task authorization for external
actions; this skill does not independently authorize publication.
