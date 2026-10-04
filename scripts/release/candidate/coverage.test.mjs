import test from 'node:test'
import assert from 'node:assert/strict'
import { services } from '../core/github.mjs'
import { releaseCoverage } from './coverage.mjs'

test('trusted readiness requires focused tooling checks on the exact PR head', () => {
  const previous = { ...services },
    revision = 'a'.repeat(40)
  const pr = {
    base: { sha: revision },
    head: { sha: revision, repo: { full_name: 'azure06/clipsx' } },
  }
  const candidate = { build: { origin: { runId: '100' } } }
  let paths = 'scripts/release/candidate/finalize.mjs\0',
    completed = false,
    conclusion = 'success'
  const trace = []
  try {
    services.command = (program, args) => {
      trace.push({ program, args })
      if (program === 'git') return args[0] === 'diff' ? paths : ''
      if (program === 'gh')
        return JSON.stringify([
          {
            jobs: ['ubuntu-latest', 'windows-latest'].map(os => ({
              name: `Release tooling (${os})`,
              status: completed ? 'completed' : 'in_progress',
              conclusion,
            })),
          },
        ])
      throw new Error('PR code must never execute')
    }
    services.api = path => {
      assert(path.includes(`head_sha=${revision}`))
      return {
        workflow_runs: [
          { id: 12, run_attempt: 2, head_sha: revision, event: 'pull_request' },
          { id: 999, head_sha: 'b'.repeat(40), event: 'pull_request' },
        ],
      }
    }
    assert.equal(releaseCoverage(pr, candidate).state, 'pending')
    completed = true
    assert.equal(releaseCoverage(pr, candidate).state, 'success')
    conclusion = 'failure'
    assert.equal(releaseCoverage(pr, candidate).state, 'failure')
    paths = 'src/app.ts\0'
    assert.equal(releaseCoverage(pr, candidate).state, 'success')
    assert(
      trace
        .filter(item => item.program === 'gh')
        .every(item => item.args[1].includes('/12/attempts/2/jobs'))
    )
  } finally {
    Object.keys(services).forEach(key => delete services[key])
    Object.assign(services, previous)
  }
})
