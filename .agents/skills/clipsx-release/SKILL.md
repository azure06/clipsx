---
name: clipsx-release
description: Prepare desktop release branches, hand builds to CI, run Windows signing when ready, and publish approved candidates. Excludes ordinary app fixes and extension publication.
---

# Desktop release operator

Use `develop` → `release/<version>` → `main`. Read only the relevant section of
[operations](references/operations.md) for the action at hand, not the entire manual.

1. **Prepare:** run `node scripts/release/pipeline.mjs prepare-version <version>`
   on `develop`, review its mechanical version changes and commit-based notes once.
   Run checks relevant to the changed code. Version/docs-only
   preparation needs consistency/link checks, not another full application build.
2. **Start CI:** push the release branch, open its PR and record the build link.
   CI owns the complete release preflight and platform builds. Reproduce the full
   preflight locally only when requested or needed to diagnose a failure.
3. **Hand off:** check status once when action is requested. If a workflow is still
   running, return its link and next action, then end the turn. Do not poll, sleep
   through builds, repeatedly download metadata, or create an unsolicited monitor.
4. **Sign Windows:** the release PR dashboard shows the exact
   [signer](../../../scripts/release/sign-windows.ps1) command once its kit is
   registered. Run it with SimplySign connected. It downloads, signs, uploads and
   resumes the pipeline. If not ready, hand off; no manual EXE upload is needed.
5. **Approve:** the maintainer tests final installers/updater and clicks
   **Review deployments → Approve and deploy** once. The workflow records the
   reviewer and exact hashes, merges through normal branch rules, and explicitly
   dispatches publication. Do not collect evidence forms or repeated confirmations.
   Approval authorizes release; never describe it as automatically executed tests.
6. **Recover:** use the PR dashboard's **Release controls** link with its PR number
   and `retry`, or Actions' **Re-run failed jobs**. Completed approval and successful
   packages survive retries. Investigate actual failures; normal progression needs
   no LLM supervision. `refresh` updates the panel; `prepare-latest` explicitly
   selects a successful build after a source fix.

## Recovery rules

- Reuse the selected build/candidate; retry only the failed or missing stage.
  Never rebuild the app to retry packaging, signing, upload or publication.
- Use the pipeline's identity, hash and signature checks. Do not duplicate them
  with manual file-by-file inspection after a successful verified stage.
- App/build-input or public configuration changes need a new build. Finalized
  assets and notes are immutable; never mix candidates or overwrite publications.
- For tooling fixes, preserve app inputs, updater keys and unrelated work. Run
  affected tooling checks and merge trusted tooling before using it on `main`.
  Use fixtures; do not create a production release just to test infrastructure.

Commands, credentials, recovery details and test requirements live in the
[operations reference](references/operations.md). Keys stay in their designated
signing/CI stores; private updater fixtures must never enter production artifacts.
