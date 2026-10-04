import { command, repoApi, source } from '../core/github.mjs'
import { decisions } from '../core/inputs.mjs'

// Inspect PR files and check results as data; never execute privileged PR code.
export function releaseCoverage(pr, candidate) {
  source(pr.base.sha)
  source(pr.head.sha)
  const paths = command('git', ['diff', '--name-only', '-z', pr.base.sha, pr.head.sha])
    .split('\0')
    .filter(Boolean)
  const needed = decisions(paths)
  const required = [
    ...(needed.tooling
      ? ['Release tooling (ubuntu-latest)', 'Release tooling (windows-latest)']
      : []),
    ...(needed.docs ? ['docs'] : []),
  ]
  if (required.length) {
    const runs = repoApi(
      `actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`
    ).workflow_runs
    const run = runs
      .filter(run => run.head_sha === pr.head.sha && run.event === 'pull_request')
      .sort((a, b) => b.id - a.id)[0]
    if (!run) return { state: 'pending', description: 'Awaiting focused PR checks on this head' }
    const jobs = JSON.parse(
      command('gh', [
        'api',
        `repos/${pr.head.repo.full_name}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
        '--paginate',
        '--slurp',
      ])
    ).flatMap(page => page.jobs)
    for (const name of required) {
      const job = jobs.find(job => job.name === name)
      if (!job || job.status !== 'completed')
        return { state: 'pending', description: `Awaiting ${name}` }
      if (job.conclusion !== 'success')
        return { state: 'failure', description: `${name} failed; inspect CI run ${run.id}` }
    }
  }
  return {
    state: 'success',
    description: `Verified build ${candidate.build.origin.runId}; PR checks passed`,
  }
}
