import { assertAppInputs, assertPublicEnvironment } from '../core/inputs.mjs'
import { assert, selectedCandidate, readJson, repository } from '../core/contracts.mjs'
import { source, repoApi, status } from '../core/github.mjs'
import { fresh } from '../core/candidate.mjs'
import { releaseCoverage } from './coverage.mjs'
import { signoffContext, loadReadiness, readyDescription } from './signoff.mjs'

export function selectForPr(candidate, release, prNumber) {
  const pulls = prNumber
    ? [repoApi(`pulls/${prNumber}`)]
    : repoApi(
        `pulls?state=open&base=main&head=${encodeURIComponent(`azure06:${candidate.branch}`)}`
      )
  for (const pr of pulls) {
    if (pr.state === 'closed') continue
    assert(
      pr.base.ref === 'main' &&
        pr.head.ref === candidate.branch &&
        pr.head.repo.full_name === repository,
      'Wrong release PR'
    )
    // Automatic preparation does not replace a maintainer's existing selection.
    if (!prNumber && selectedCandidate(pr.body)) continue
    assertAppInputs(candidate, source(pr.head.sha))
    const body = (pr.body || '').replace(/\n?<!-- clipsx-release-candidate: [^\n]* -->/g, '')
    repoApi(`pulls/${pr.number}`, 'PATCH', {
      body: `${body}\n<!-- clipsx-release-candidate: ${candidate.id} -->`,
    })
    status(pr.head.sha, 'pending', `Awaiting Windows signing: ${candidate.id}`, pr.html_url)
  }
}

export function readiness() {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const pulls = event.pull_request
    ? [repoApi(`pulls/${event.pull_request.number}`)]
    : repoApi('pulls?state=open&base=main&per_page=100')
  for (const pr of pulls) {
    if (pr.state === 'closed') continue
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
      const { release, candidate } = fresh(id)
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
        status(pr.head.sha, 'pending', message, pr.html_url)
        continue
      }
      if (!release.assets.some(item => item.name === 'merge-readiness.json')) {
        status(pr.head.sha, 'pending', 'Verifying final packages before merge', pr.html_url)
        continue
      }
      const { hash, verified } = loadReadiness(signoffContext(id, pr.number))
      if (!verified) {
        status(pr.head.sha, 'pending', 'Final package verification is finishing', pr.html_url)
        continue
      }
      status(pr.head.sha, 'success', readyDescription(id, hash), pr.html_url)
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
