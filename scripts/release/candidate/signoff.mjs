import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { assertAppInputs, assertPublicEnvironment } from '../core/inputs.mjs'
import {
  assert,
  assertCertified,
  digest,
  encode,
  readJson,
  repository,
  selectedCandidate,
} from '../core/contracts.mjs'
import {
  command,
  source,
  downloadAsset,
  downloadArtifact,
  workflowArtifacts,
  repoApi,
  status,
  writeAsset,
} from '../core/github.mjs'
import { directory, git, output, summarize } from '../core/context.mjs'
import { fresh, assertCurrent, verifyFinalized, completeInventory } from '../core/candidate.mjs'
import { releaseCoverage } from './coverage.mjs'
import {
  approvalEnvironment,
  assertApprovalEnvironment,
  releasePr,
  panel,
  requestPhase,
  runUrl,
} from './operator.mjs'

export function signoffContext(id, prNumber) {
  const pr = releasePr(prNumber)
  const snapshot = fresh(id)
  const { release, candidate, bytes } = snapshot
  assert(candidate.finalizedAt, 'Candidate must be finalized before approval')
  assert(
    pr.head.ref === candidate.branch && selectedCandidate(pr.body) === id,
    'Release selection changed; approve the selected candidate'
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
  let certification
  if (release.assets.some(item => item.name === 'certification.json')) {
    certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
    assert(
      certification.releasePrNumber === Number(prNumber) &&
        certification.appInputsSha256 === binding.appInputsSha256,
      'Approval belongs to another release PR'
    )
    assertCertified(candidate, certification, bytes, inventory)
  }
  return { ...snapshot, pr, inventory, binding, certification }
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
      `Release changed while waiting for approval: ${field}; start a new approval`
    )
}

export function approvalSnapshot(id, prNumber) {
  const context = signoffContext(id, prNumber)
  assert(context.pr.state === 'open', 'Approval requires an open release PR')
  assert(/^\d+$/.test(process.env.GITHUB_RUN_ID || ''), 'Approval snapshots require a workflow run')
  if (!context.certification) assertApprovalEnvironment()
  const name = `release-approval-${process.env.GITHUB_RUN_ID}`
  const existing = workflowArtifacts(process.env.GITHUB_RUN_ID).find(item => item.name === name)
  let snapshot = { ...context.binding, runId: process.env.GITHUB_RUN_ID }
  if (existing) {
    downloadArtifact(existing, directory)
    snapshot = readJson(join(directory, 'approval-snapshot.json'))
    assertApprovalBinding(snapshot, context.binding)
    assert(snapshot.runId === process.env.GITHUB_RUN_ID, 'Wrong approval run')
  } else writeFileSync(join(directory, 'approval-snapshot.json'), encode(snapshot))
  output('upload-snapshot', String(!existing))
  output('approved', String(Boolean(context.certification)))
  output('candidate-url', context.release.html_url)
  summarize(
    `## ClipsX ${context.candidate.version}\n\n[Download final packages](${context.release.html_url}) · Candidate \`${id}\`\n\nTest Windows, both Macs, Linux AppImage/deb and the updater; include extension installation, an action and restart on both Macs. Then **Review deployments → Approve and deploy** to authorize merging and publishing these exact files. No evidence form is required.\n\nCandidate SHA-256: \`${snapshot.candidateSha256}\`\nInventory SHA-256: \`${snapshot.inventorySha256}\``
  )
  return snapshot
}

export function approvedReview(runId, environment) {
  const run = repoApi(`actions/runs/${runId}`)
  assert(
    run.path?.split('@')[0] === '.github/workflows/release-certify.yml' &&
      run.event === 'workflow_dispatch' &&
      run.head_branch === 'main' &&
      run.head_sha === git(['rev-parse', 'HEAD']) &&
      run.head_repository?.full_name === repository,
    'Approval must run trusted main release tooling'
  )
  const reviews = repoApi(`actions/runs/${runId}/approvals`).filter(review =>
    review.environments?.some(
      item => item.id === environment.id && item.name === approvalEnvironment
    )
  )
  assert(
    reviews.length > 0 && reviews.every(review => review.state === 'approved'),
    'The release environment has not been approved'
  )
  const review = reviews.at(-1)
  assert(review.user?.type === 'User' && review.user.login, 'A human release approval is required')
  return {
    environment: approvalEnvironment,
    environmentId: environment.id,
    runId: String(runId),
    runUrl: runUrl(runId),
    actor: review.user.login,
    recordedAt: new Date().toISOString(),
  }
}

export function certify(id, prNumber) {
  const context = signoffContext(id, prNumber)
  const { release, candidate, inventory, pr } = context
  assert(pr.state === 'open', 'Certification requires an open release PR')
  if (!context.certification) {
    const snapshot = readJson(join(directory, 'approval-snapshot.json'))
    assertApprovalBinding(snapshot, context.binding)
    assert(snapshot.runId === process.env.GITHUB_RUN_ID, 'Wrong approval snapshot run')
    const approval = approvedReview(snapshot.runId, assertApprovalEnvironment())
    const coverage = releaseCoverage(pr, candidate)
    assert(coverage.state === 'success', coverage.description)
    verifyFinalized(release, candidate)
    const current = assertCurrent(context)
    assert(
      digest(encode(completeInventory(current, candidate))) === digest(encode(inventory)),
      'Draft changed during approval'
    )
    assert(
      selectedCandidate(releasePr(prNumber).body) === id,
      'Release selection changed during approval'
    )
    writeAsset(
      release,
      'certification.json',
      {
        schemaVersion: 3,
        ...context.binding,
        sourceRevision: candidate.sourceRevision,
        sourceTree: candidate.sourceTree,
        approval,
        actor: approval.actor,
        toolingRevision: git(['rev-parse', 'HEAD']),
        certifiedAt: approval.recordedAt,
      },
      directory
    )
  }
  status(pr.head.sha, 'success', `Approved candidate ${id}`, release.html_url)
  if (pr.draft) command('gh', ['pr', 'ready', String(prNumber), '--repo', repository])
  summarize(
    `Release approved. Continuing with the protected merge and publication of candidate ${id}.`
  )
}

export function completeRelease(id, prNumber) {
  let pr = releasePr(prNumber)
  if (!pr.merged) {
    const context = signoffContext(id, prNumber)
    pr = context.pr
    assert(context.certification, 'Release approval is required before merging')
    const coverage = releaseCoverage(pr, context.candidate)
    assert(coverage.state === 'success', coverage.description)
    status(pr.head.sha, 'success', `Approved candidate ${id}`, context.release.html_url)
    repoApi(`statuses/${pr.head.sha}`, 'POST', {
      state: 'success',
      context: 'CI',
      description: coverage.description,
      target_url: runUrl(context.candidate.build.origin.runId),
    })
    const result = repoApi(`pulls/${prNumber}/merge`, 'PUT', {
      sha: pr.head.sha,
      merge_method: 'rebase',
    })
    assert(
      result.merged,
      result.message || 'Protected merge is blocked; inspect the PR and retry this job'
    )
    pr = releasePr(prNumber)
  }
  assert(pr.merged && selectedCandidate(pr.body) === id, 'Merged release selection changed')
  const current = panel(pr)
  requestPhase(
    pr,
    current,
    'publish',
    'release-publish.yml',
    `Publish release PR #${prNumber}`,
    { pr_number: String(prNumber) },
    { retry: true }
  )
  summarize(
    `Release PR #${prNumber} merged. Publication was explicitly dispatched; it does not depend on a workflow-token merge event.`
  )
}
