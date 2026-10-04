import { assertAppInputs, assertPublicEnvironment } from '../core/inputs.mjs'
import {
  assert,
  assertCertified,
  selectedCandidate,
  certificationChecks,
  digest,
  encode,
  readJson,
  repository,
  targets,
} from '../core/contracts.mjs'
import { command, source, downloadAsset, repoApi, status, writeAsset } from '../core/github.mjs'
import { directory, git, summarize } from '../core/context.mjs'
import { fresh, assertCurrent, verifyFinalized, completeInventory } from '../core/candidate.mjs'
import { releaseCoverage } from './coverage.mjs'

export function selectForPr(candidate, release, prNumber) {
  const pulls = prNumber
    ? [repoApi(`pulls/${prNumber}`)]
    : repoApi(
        `pulls?state=open&base=main&head=${encodeURIComponent(`azure06:${candidate.branch}`)}`
      )
  for (const pr of pulls) {
    assert(
      pr.base.ref === 'main' &&
        pr.head.ref === candidate.branch &&
        pr.head.repo.full_name === repository,
      'Wrong release PR'
    )
    // Automatic preparation does not replace a maintainer's existing selection.
    if (!prNumber && selectedCandidate(pr.body)) continue
    const body = (pr.body || '').replace(/\n?<!-- clipsx-release-candidate: [^\n]* -->/g, '')
    repoApi(`pulls/${pr.number}`, 'PATCH', {
      body: `${body}\n<!-- clipsx-release-candidate: ${candidate.id} -->`,
    })
    status(pr.head.sha, 'pending', `Awaiting Windows signing: ${candidate.id}`, release.html_url)
  }
}

export function certify(id, prNumber) {
  assert(/^\d+$/.test(String(prNumber)), 'Select the release PR number')
  const pr = repoApi(`pulls/${prNumber}`)
  const snapshot = fresh(id)
  const { release, candidate, bytes } = snapshot
  assert(candidate.finalizedAt, 'Candidate must be finalized before certification')
  assert(
    pr.base.ref === 'main' &&
      pr.head.ref === candidate.branch &&
      pr.head.repo.full_name === repository &&
      pr.state === 'open',
    'Wrong release PR'
  )
  assertAppInputs(candidate, source(pr.head.sha))
  assertPublicEnvironment(candidate)
  const coverage = releaseCoverage(pr, candidate)
  assert(coverage.state === 'success', coverage.description)
  assert(
    selectedCandidate(pr.body) === id,
    'Select this candidate on the release PR before certifying'
  )
  const checks = certificationChecks(
    process.env.CERTIFY_ALL_PLATFORMS,
    process.env.CERTIFY_MAC_EXTENSIONS
  )
  const evidence = process.env.CERTIFICATION_EVIDENCE?.trim()
  assert(
    evidence && /^https:\/\//.test(evidence),
    'Provide an HTTPS installed-test evidence reference'
  )
  verifyFinalized(release, candidate)
  const inventory = completeInventory(release, candidate)
  const current = assertCurrent(snapshot)
  assert(
    digest(encode(completeInventory(current, candidate))) === digest(encode(inventory)),
    'Draft changed during certification'
  )
  if (release.assets.some(item => item.name === 'certification.json')) {
    const existing = JSON.parse(downloadAsset(release, 'certification.json', directory))
    assert(existing.releasePrNumber === Number(prNumber), 'Candidate was certified for another PR')
    assertCertified(candidate, existing, bytes, inventory)
    status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
    if (pr.draft) command('gh', ['pr', 'ready', String(prNumber), '--repo', repository])
    return
  }
  const certification = {
    schemaVersion: 2,
    releasePrNumber: Number(prNumber),
    appInputsSha256: candidate.build.appInputsSha256,
    candidateId: id,
    sourceRevision: candidate.sourceRevision,
    sourceTree: candidate.sourceTree,
    candidateSha256: digest(bytes),
    inventorySha256: digest(encode(inventory)),
    evidence,
    checks,
    platforms: targets.map(item => item.id),
    actor: process.env.GITHUB_ACTOR,
    toolingRevision: git(['rev-parse', 'HEAD']),
    certifiedAt: new Date().toISOString(),
  }
  writeAsset(release, 'certification.json', certification, directory)
  status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
  if (pr.draft) command('gh', ['pr', 'ready', String(prNumber), '--repo', repository])
  summarize(
    `Candidate ${id}; build ${candidate.build.origin.runId}. Next action: merge [release PR #${prNumber}](${pr.html_url}) after required checks pass.`
  )
}

export function readiness() {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const pulls = event.pull_request
    ? [repoApi(`pulls/${event.pull_request.number}`)]
    : repoApi('pulls?state=open&base=main&per_page=100')
  for (const pr of pulls) {
    if (!pr.head.ref.startsWith('release/')) {
      status(pr.head.sha, 'success', 'No desktop release is associated with this PR', pr.html_url)
      continue
    }
    try {
      assert(
        pr.head.repo.full_name === repository,
        'Release candidates must originate from this repository'
      )
      const id = selectedCandidate(pr.body)
      if (!id) {
        status(
          pr.head.sha,
          'pending',
          'Build/prepare a candidate, then select it for this PR',
          pr.html_url
        )
        continue
      }
      const { release, candidate, bytes } = fresh(id)
      assertAppInputs(candidate, source(pr.head.sha))
      assertPublicEnvironment(candidate)
      // CI coverage belongs to the selected successful build, even after docs-only pushes.
      const coverage = releaseCoverage(pr, candidate)
      repoApi(`statuses/${pr.head.sha}`, 'POST', {
        state: coverage.state,
        context: 'CI',
        description: coverage.description,
        target_url: `https://github.com/${repository}/actions/runs/${candidate.build.origin.runId}`,
      })
      if (coverage.state !== 'success') {
        status(pr.head.sha, coverage.state, coverage.description, pr.html_url)
        continue
      }
      if (!candidate.finalizedAt) {
        const missing = ['macos-arm64', 'macos-x64', 'linux-x64'].filter(
          platform => !candidate.preparation?.[platform]
        )
        const message = missing.length
          ? `Awaiting packaging: ${missing.join(', ')}`
          : release.assets.some(item => item.name === 'windows-submission.json')
            ? 'Awaiting Windows verification and finalization'
            : 'Awaiting local Windows signing'
        status(pr.head.sha, 'pending', message, release.html_url)
        continue
      }
      if (!release.assets.some(item => item.name === 'certification.json')) {
        status(
          pr.head.sha,
          'pending',
          'Awaiting installed-platform and updater certification',
          release.html_url
        )
        continue
      }
      const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
      assert(
        certification.releasePrNumber === pr.number &&
          certification.appInputsSha256 === candidate.build.appInputsSha256,
        'Certification belongs to another release selection'
      )
      assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
      status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
    } catch (error) {
      repoApi(`statuses/${pr.head.sha}`, 'POST', {
        state: 'failure',
        context: 'CI',
        description: error.message.slice(0, 140),
        target_url: pr.html_url,
      })
      status(pr.head.sha, 'failure', error.message, pr.html_url)
      console.error(`Release PR ${pr.number}: ${error.message}`)
      process.exitCode = 1
    }
  }
}
