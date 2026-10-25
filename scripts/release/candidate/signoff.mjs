import { assertAppInputs, assertPublicEnvironment } from '../core/inputs.mjs'
import {
  assert,
  assertCertified,
  digest,
  encode,
  repository,
  readinessContext,
  selectedCandidate,
} from '../core/contracts.mjs'
import { command, source, downloadAsset, repoApi, status, writeAsset } from '../core/github.mjs'
import { directory, git, summarize } from '../core/context.mjs'
import { fresh, assertCurrent, verifyFinalized, completeInventory } from '../core/candidate.mjs'
import { releaseCoverage } from './coverage.mjs'
import { releasePr } from './operator.mjs'

export const readinessFile = 'merge-readiness.json'
export const readyDescription = (id, hash) => `Ready to merge ${id}; proof ${hash}`

export function signoffContext(id, prNumber) {
  const pr = releasePr(prNumber)
  const snapshot = fresh(id)
  const { release, candidate, bytes } = snapshot
  assert(candidate.finalizedAt, 'Candidate must be finalized before merge readiness')
  assert(
    pr.head.ref === candidate.branch && selectedCandidate(pr.body) === id,
    'Release selection changed'
  )
  assertAppInputs(candidate, source(pr.head.sha))
  assertPublicEnvironment(candidate)
  const inventory = completeInventory(release, candidate)
  const binding = {
    candidateId: id,
    releasePrNumber: Number(prNumber),
    candidateSha256: digest(bytes),
    inventorySha256: digest(encode(inventory)),
    appInputsSha256: candidate.build.appInputsSha256,
  }
  return { ...snapshot, pr, inventory, binding }
}

export function assertApprovalBinding(expected, actual) {
  for (const field of [
    'candidateId',
    'releasePrNumber',
    'candidateSha256',
    'inventorySha256',
    'appInputsSha256',
  ])
    assert(
      expected[field] === actual[field],
      `Ready packages changed: ${field}; verify the selected candidate again`
    )
}

export function loadReadiness(context, checkRun = true) {
  const bytes = downloadAsset(context.release, readinessFile, directory)
  const proof = JSON.parse(bytes)
  assert(proof.schemaVersion === 1, 'Unsupported merge readiness record')
  assertApprovalBinding(proof, context.binding)
  assert(proof.headRevision === context.pr.head.sha, 'PR head changed after verification')
  assert(Number.isFinite(Date.parse(proof.verifiedAt)), 'Missing verification time')
  assert(/^[a-f0-9]{40}$/.test(proof.toolingRevision || ''), 'Missing trusted tooling revision')
  assert(/^\d+$/.test(proof.verificationRunId || ''), 'Missing verification workflow identity')
  let verified = true
  if (checkRun) {
    const run = repoApi(`actions/runs/${proof.verificationRunId}`)
    assert(
      run.path?.split('@')[0] === '.github/workflows/release-certify.yml' &&
        run.event === 'workflow_dispatch' &&
        run.head_branch === 'main' &&
        run.head_repository?.full_name === repository &&
        run.head_sha === proof.toolingRevision &&
        run.display_title ===
          `Verify candidate ${proof.candidateId} for PR #${proof.releasePrNumber} at ${proof.headRevision}`,
      'Readiness must come from the trusted merge-verification workflow'
    )
    verified = run.status === 'completed' && run.conclusion === 'success'
  }
  return { proof, hash: digest(bytes), verified }
}

export function verifyForMerge(id, prNumber, expectedHead) {
  assert(/^\d+$/.test(process.env.GITHUB_RUN_ID || ''), 'Verification requires a workflow run')
  const context = signoffContext(id, prNumber)
  const { pr, release, candidate } = context
  assert(pr.state === 'open' && !pr.merged, 'Merge verification requires an open release PR')
  assert(
    !expectedHead || pr.head.sha === expectedHead,
    'PR head changed before verification started'
  )
  status(pr.head.sha, 'pending', 'Verifying final packages before merge', pr.html_url)
  const coverage = releaseCoverage(pr, candidate)
  assert(coverage.state === 'success', coverage.description)
  // Rechecking immutable files never rebuilds or signs an application.
  verifyFinalized(release, candidate)
  const current = assertCurrent(context)
  assert(
    digest(encode(completeInventory(current, candidate))) === context.binding.inventorySha256,
    'Draft changed during verification'
  )
  const latest = releasePr(prNumber)
  assert(
    latest.head.sha === pr.head.sha && selectedCandidate(latest.body) === id && !latest.merged,
    'Release changed during verification'
  )
  let proof
  if (release.assets.some(item => item.name === readinessFile)) {
    const previous = JSON.parse(downloadAsset(release, readinessFile, directory))
    assertApprovalBinding(previous, context.binding)
    if (previous.headRevision === pr.head.sha) proof = previous
  }
  proof ||= {
    schemaVersion: 1,
    verificationRunId: process.env.GITHUB_RUN_ID,
    ...context.binding,
    headRevision: pr.head.sha,
    verifiedAt: new Date().toISOString(),
    toolingRevision: git(['rev-parse', 'HEAD']),
  }
  writeAsset(release, readinessFile, proof, directory)
  status(pr.head.sha, 'success', readyDescription(id, digest(encode(proof))), pr.html_url)
  if (pr.draft) command('gh', ['pr', 'ready', String(prNumber), '--repo', repository])
  summarize(
    `Packages verified for candidate ${id}. Download and test them, then merge PR #${prNumber} to authorize publication. No separate deployment approval is needed.`
  )
  return proof
}

export function assertHumanMerge(pr) {
  assert(pr.merged && pr.state === 'closed', 'Release approval requires a merged PR')
  assert(pr.merged_by?.type === 'User' && pr.merged_by.login, 'A human must merge the release PR')
  assert(
    Number.isFinite(Date.parse(pr.merged_at)) && /^[a-f0-9]{40}$/.test(pr.merge_commit_sha || ''),
    'Missing authoritative merge identity'
  )
}

export function assertMergeCertificate(certification, pr, context) {
  if (certification.schemaVersion !== 4) return
  assertHumanMerge(pr)
  const { hash, proof } = loadReadiness(context, false)
  const approval = certification.approval
  assert(
    approval.readinessSha256 === hash &&
      approval.verificationRunId === proof.verificationRunId &&
      approval.headRevision === pr.head.sha &&
      approval.mergeRevision === pr.merge_commit_sha &&
      approval.actor === pr.merged_by.login &&
      approval.recordedAt === pr.merged_at &&
      approval.prNumber === pr.number,
    'Certification differs from the human PR merge'
  )
}

export function certifyMerged(id, prNumber) {
  const context = signoffContext(id, prNumber)
  const { pr, candidate, release, bytes, inventory } = context
  assertHumanMerge(pr)
  assertAppInputs(candidate, source(pr.merge_commit_sha))
  const { proof, hash, verified } = loadReadiness(context)
  assert(verified, 'Package verification workflow has not completed successfully')
  const description = readyDescription(id, hash)
  let latestStatus
  for (let page = 1; ; page++) {
    const statuses = repoApi(`commits/${pr.head.sha}/statuses?per_page=100&page=${page}`)
    latestStatus = statuses.find(
      item =>
        item.context === readinessContext &&
        Number.isFinite(Date.parse(item.created_at)) &&
        Date.parse(item.created_at) <= Date.parse(pr.merged_at)
    )
    if (latestStatus || statuses.length < 100) break
  }
  assert(
    latestStatus?.state === 'success' &&
      latestStatus.description === description &&
      latestStatus.creator?.login === 'github-actions[bot]',
    'These exact packages were not ready before the human merge'
  )
  if (release.assets.some(item => item.name === 'certification.json')) {
    const existing = JSON.parse(downloadAsset(release, 'certification.json', directory))
    assertCertified(candidate, existing, bytes, inventory)
    assertMergeCertificate(existing, pr, context)
    return existing
  }
  verifyFinalized(release, candidate)
  const current = assertCurrent(context)
  assert(
    digest(encode(completeInventory(current, candidate))) === context.binding.inventorySha256,
    'Draft changed after the merge'
  )
  const latest = releasePr(prNumber)
  assertHumanMerge(latest)
  assert(
    latest.head.sha === proof.headRevision &&
      latest.merge_commit_sha === pr.merge_commit_sha &&
      selectedCandidate(latest.body) === id,
    'Merged release selection changed'
  )
  const certification = {
    schemaVersion: 4,
    ...context.binding,
    sourceRevision: candidate.sourceRevision,
    sourceTree: candidate.sourceTree,
    approval: {
      kind: 'pull_request_merge',
      verificationRunId: proof.verificationRunId,
      prNumber: pr.number,
      actor: pr.merged_by.login,
      recordedAt: pr.merged_at,
      headRevision: pr.head.sha,
      mergeRevision: pr.merge_commit_sha,
      readinessSha256: hash,
    },
    actor: pr.merged_by.login,
    toolingRevision: git(['rev-parse', 'HEAD']),
    certifiedAt: new Date().toISOString(),
  }
  writeAsset(release, 'certification.json', certification, directory)
  return certification
}
