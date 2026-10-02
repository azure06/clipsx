# Release pipeline cleanup plan

Status: implemented in the shared checks workflow; hosted validation and the
main ruleset migration must complete before release certification.

## Confirmed failure and cost

Candidate run 36952214546 at 185a5e9 passed release preflight. Ordinary PR CI also
passed on Windows, macOS and Linux. The release platform jobs then ran Cargo
tests before Tauri's frontend build hook created `dist`. `generate_context!`
therefore failed on both Mac jobs and Linux. The local preflight had built the
frontend first, so it did not reproduce this workflow ordering error.

The preflight job took about 15 minutes. Installing system/audit dependencies took
6 minutes 17 seconds; application verification took 8 minutes 27 seconds. The
preflight runner had no Rust cache. Native tests were repeated in regular CI,
release preflight and release packaging jobs. Both Mac release jobs used the same
host runner label and ran host tests without selecting the target architecture.

The remaining work for this failed candidate was cancelled. Its files cannot be
treated as a complete candidate or reused for certification.

## Target flow

```text
Local preflight -> commit and push release branch
  -> one frontend/checks job
  -> four parallel native jobs: Windows, Linux, Mac ARM, Mac Intel
  -> stage complete candidate
  -> local Windows signing -> finalize -> installed certification
  -> merge -> publish the already-certified files
```

1. **Frontend/checks:** validate versions and production settings, run audits,
   licenses, secret/catalog checks, frontend lint/types/tests and release invariant
   tests once. Build the production frontend once, generate the SBOM and upload
   the frontend/CSP evidence for the native jobs. Sentry source maps are uploaded
   once from this trusted release build; production deployment records still wait
   for successful publication.
2. **Native jobs:** restore caches, download and verify the frontend artifact,
   assert that `dist/index.html` exists, then test and package their platform.
   Run Rust formatting, strict Clippy, extension-tool and updater-verifier unit
   tests once on Linux. Run native application tests once per advertised release
   architecture, using an actual Intel runner for Intel tests. Disable the
   frontend build hook only in the CI overlay that consumes verified production
   assets. Keep local Tauri build hooks working normally.
3. **Stage:** require every native job and expected asset. Retain the existing
   candidate/run/attempt identity, hashes, signing evidence and staging drafts.
4. **Sign/finalize/certify/publish:** retain the existing lifecycle, updater key,
   endpoint and installed tests. Cleanup does not justify bypassing any of them.

Debug test compilation and optimized release compilation serve different purposes
and remain necessary. The goal is to run each validation once in a candidate run,
not to pretend the two compiler profiles are interchangeable.

## Remove repetition

- Use one shared set of validation/native job definitions for ordinary PRs and
  release preparation. Release mode adds production configuration, packaging and
  signing; ordinary PR mode does not receive signing/publication credentials.
- Ordinary CI runs for ordinary PRs. Release branch pushes run the release flow;
  its draft PR does not launch another copy of all checks. Remove redundant
  develop/main push copies where the same work already runs for a PR/release.
- Frontend tests run once on Linux; native tests retain platform coverage.
- Remove the standalone Linux debug-build runner. Preserve its default-feature
  compile coverage in the existing Linux native job on ordinary PRs; release
  packaging supplies production compile coverage for release candidates.
- Do not add cross-run artifact lookup, CI-result polling or a custom scheduler.
  Frontend/native artifacts belong to the same caller run and attempt.
- Install pinned prebuilt audit tools where available; cache tools that need
  compilation. Keep security advisory data current on every preflight.
- Restore Rust caches in every compiling job. Key by OS/architecture, Rust,
  lockfile and build settings; keep untrusted PR and trusted release cache scopes
  separate. Retain valid dependency caches after failed builds.
- Cancel superseded preparation runs. Stop sibling native jobs after a platform
  fails, since an incomplete inventory cannot stage. Keep publication serialized.
- Retry failed jobs on the same source using immutable compiled checkpoints.
  Retain the frontend build generation while recording execution attempts. A
  new source push or complete rerun creates a new candidate/build generation;
  do not import packages from another run or generation.

## Implementation order

1. Inventory the current required checks and introduce an aggregate `CI` gate
   that fails unless all applicable checks pass. Keep old requirements during
   rollout. Keep the trusted `Release readiness` status separate.
2. Validate the new gate for ordinary and release PRs. Roll its infrastructure
   onto main before replacing obsolete ruleset check names. Preserve coverage;
   do not remove required contexts before their replacement is available.
3. Extract shared checks/native jobs and route ordinary versus release events so
   an exact release push has one validation/build flow. Ensure skipped routing
   jobs do not publish a misleading success under a required check name.
4. Build/upload the production frontend once and consume it before any Cargo
   invocation that embeds assets. Verify its source revision, configuration and
   hashes. This fixes the missing-dist failure at the dependency boundary.
5. Consolidate native tests/builds, select native Mac architectures, configure
   caches/tool installation and remove duplicate workflow jobs/triggers.
6. Update the local preflight, release skill and release documentation to invoke
   the same checks in the same order. Test from an isolated clean checkout with
   no pre-existing `dist`, `node_modules` or local `.env` assumptions.
7. Run local checks first, then prepare one fresh unpublished candidate. Record
   cold/warm job timings. Continue Windows signing only for that current complete
   candidate.

## Acceptance

- Missing/corrupt/wrong-revision frontend artifacts fail before Rust compilation;
  test stubs cannot enter production packages.
- A release push does not start duplicate ordinary CI or multiple frontend builds.
- Every required platform test/check runs exactly once in that candidate attempt.
- Source changes and retries preserve supersession, complete inventory and hash
  binding. A failed platform cannot stage or certify a candidate.
- Ordinary/fork PRs cannot obtain signing credentials or publish assets; readiness
  orchestration remains trusted default-branch code handling metadata only.
- Existing installed certification, Authenticode, notarization, updater verification
  and publish-without-rebuild requirements remain enforced.
- Audit tools are not compiled afresh on every warm run; cache effectiveness and
  actual elapsed time are reported rather than promised beforehand.

No production tag or release is created while implementing or validating this plan.
