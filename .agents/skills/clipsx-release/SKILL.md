---
name: clipsx-release
description: Operate ClipsX desktop releases from saved builds, retry packaging, sign Windows, certify installed artifacts and publish on merge. Excludes ordinary app fixes and extension publication.
---

# ClipsX release workflow

Read [release requirements](references/operations.md). Inspect the selected build,
candidate draft and evidence; build success is not installed certification.
An explicit request to publish authorizes signing, finalization, certification
and merge/publication within this flow; preparation alone does not. Certification
still requires evidence for the exact finalized files.

## Ordered operations

1. **Build:** align npm/Cargo/Tauri versions and release notes. Changed app/build
   inputs require local preflight before pushing release/<version>. Frontend
   checks/build run once, native tests and optimized compilation once per target.
   Record the successful build ID.
2. **Prepare:** run Prepare release candidate from deployed trusted main with
   explicit build_run_id. Empty candidate_id creates a candidate; an exact ID
   resumes it. target=missing preserves completed outputs. Choose a platform
   explicitly to replace it only before finalization. Corrected release tooling
   may consume an older build; never recompile merely to retry signing.
   pr_number selects the candidate; automatic preparation preserves an existing
   selection. Optional notes_ref corrects notes before finalization without
   changing packages; an omitted retry reference preserves existing notes.
3. **Windows:** authenticate SimplySign and GitHub CLI. Use the root
   sign-windows.ps1 helper with CandidateId and the documented certificate
   thumbprint. It packages the saved executable, signs application/installer/
   uninstaller, verifies executable identity, uploads and dispatches finalization.
   Use a fresh signing workspace. Keep updater private keys exclusively in CI.
4. **Finalize:** select the exact candidate on main. Require complete platform
   inventory and native evidence. Verify signatures against the retained updater
   key. Completed retries verify files rather than regenerate them.
5. **Certify:** collect actual Windows, both Mac, AppImage/deb installed tests and
   private updater-fixture evidence. Both Macs require cold-cache extension
   installation, action and restart tests. Dispatch Certify candidate with exact
   ID, release PR, HTTPS evidence and both required confirmations.
6. **Publish:** merge the certified release PR. Publication checks merged app
   inputs and promotes existing certified files. Retry Publish certified release
   with the merged PR number; reject conflicting tags and reuse published files.
   For read-only discovery/signature verification, use pipeline.mjs
   verify-published <merged-release-pr>; it cannot publish or record deployments.

## Identity and navigation

The root pipeline is a dispatcher. Domains under scripts/release own core
contracts/transfers/classification, build checks and immutable executables,
candidate lifecycle, platform signing/runtime details, publication,
observability, test feeds/fixtures and one-time public configuration setup.
Tests live beside their domain; npm run test:release discovers them recursively.

Compilation ends at the saved build. Preparation and later stages cannot build
the app/frontend or run application tests. Compare the central tracked app-input
inventory and public environment with release source. Docs/signing tooling may
differ; changed app inputs or public production variables require a new build.
For documentation-only corrections, follow the reference procedure for preserving
an in-progress build and validating the exact PR head. Do not rebuild unchanged
application inputs or treat tested source/dev builds as tested installers.
Newer builds do not supersede selected candidates. Record build and release-tooling
revisions separately and reject mixed, expired or tampered inputs.

Finalized/certified assets and notes are immutable. Recheck descriptor/asset
metadata before lifecycle writes and verify transfers at external boundaries.
Never infer installed success from a build, signature or checkbox without evidence.
Existing published descriptors and certifications remain verifiable.

## Infrastructure changes

Preserve app manifests, runtime source, migrations, updater key/routes and unrelated
working-tree edits. Compare app-input inventories before/after. Run focused release
tests on Windows/Linux, workflow lint, PowerShell syntax, standalone verifier
tests/lint and skill validation. Keep CI and Release readiness protections.
Merge infrastructure before using changed main-only dispatch actions; validate
with fixtures and read-only verification without creating a production tag/release.

Keep exact commands, credential setup and installed checklists in
[operations reference](references/operations.md). Public DSN mapping is centralized; secret
upload/deployment tokens remain separate. Loopback-only updater fixture settings
must never enter production artifacts. Website and extension publication remain
separate. Never certify missing tests or fabricate an evidence reference.
