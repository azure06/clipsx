import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { operatorFixture } from '../testing/operator-fixture.mjs'
import { services } from '../core/github.mjs'
import { finalizationReady, updateRelease, controls } from './controls.mjs'
import { finalize } from './finalize.mjs'
import { panel, requestPhase, savePanel } from './operator.mjs'

function packaged(f) {
  f.candidate.preparation = Object.fromEntries(
    ['macos-arm64', 'macos-x64', 'linux-x64'].map(platform => [platform, { runId: '200' }])
  )
  f.candidate.windowsKitArtifact = { id: 5 }
  f.save()
}
const requests = f =>
  f.trace.filter(item => item.method === 'POST' && item.path.includes('/dispatches'))

test('Windows upload cannot start finalization while another platform is missing', () => {
  const f = operatorFixture()
  try {
    packaged(f)
    assert(finalizationReady(f.candidate, f.release))
    delete f.candidate.preparation['macos-x64']
    f.save()
    assert(!finalizationReady(f.candidate, f.release))
    assert.equal(updateRelease(f.pr), 'Running')
    assert.equal(requests(f).length, 0)
    assert.match(f.state.comments[0].body, /macos-x64/)
    f.candidate.preparation['macos-x64'] = {}
    f.save()
    updateRelease(f.pr)
    updateRelease(f.pr)
    assert.equal(requests(f).length, 1)
    assert.match(requests(f)[0].path, /release-finalize.yml/)
  } finally {
    f.restore()
  }
})

test('the signing panel provides a complete command only after the kit is registered', () => {
  const f = operatorFixture()
  try {
    packaged(f)
    f.release.assets = f.release.assets.filter(asset => asset.name !== 'windows-submission.json')
    assert.equal(updateRelease(f.pr), 'Waiting for signing')
    assert.match(f.state.comments[0].body, /-CandidateId 0.1.2-200-1 -CertificateThumbprint A{40}/)
    assert.match(f.state.comments[0].body, /\[guid\]::NewGuid/)
    assert.equal(requests(f).length, 0)
    delete f.candidate.windowsKitArtifact
    f.save()
    updateRelease(f.pr)
    assert.doesNotMatch(f.state.comments[0].body, /scripts\/release\/sign-windows.ps1/)
  } finally {
    f.restore()
  }
})

test('finalized packages automatically request one approval without rewriting assets', () => {
  const f = operatorFixture()
  try {
    finalize(f.candidate.id, f.windowsEvidence)
    const before = f.release.assets.map(asset => asset.digest)
    assert.equal(updateRelease(f.pr), 'Waiting for approval')
    updateRelease(f.pr)
    assert.equal(requests(f).length, 1)
    assert.deepEqual(requests(f)[0].body.inputs, { candidate_id: f.candidate.id, pr_number: '45' })
    assert.deepEqual(
      f.release.assets.map(asset => asset.digest),
      before
    )
    assert.match(f.state.comments[0].body, /Approve and deploy/)
    assert.match(f.state.comments[0].body, /Download final installers/)
  } finally {
    f.restore()
  }
})

test('automatic events never rerun failures; explicit retry preserves successful jobs', () => {
  const f = operatorFixture()
  try {
    packaged(f)
    f.addRun('release-finalize.yml', `Finalize candidate ${f.candidate.id}`, 'completed', 'failure')
    assert.equal(updateRelease(f.pr), 'Failed')
    assert.equal(f.trace.filter(item => item.path?.includes('/rerun')).length, 0)
    updateRelease(f.pr, 'retry')
    assert.equal(f.trace.filter(item => item.path?.endsWith('/1234/rerun-failed-jobs')).length, 1)
    assert.equal(requests(f).length, 0)
  } finally {
    f.restore()
  }
})

test('uncertain dispatch is recorded before the request and requires an explicit retry', () => {
  const f = operatorFixture()
  try {
    packaged(f)
    const original = services.api
    services.api = (path, method, body) => {
      if (path.includes('/dispatches')) {
        assert.match(f.state.comments[0].body, /clipsx-release-state/)
        throw new Error('connection lost after submission')
      }
      return original(path, method, body)
    }
    assert.equal(updateRelease(f.pr), 'Failed')
    services.api = original
    updateRelease(f.pr)
    assert.equal(requests(f).length, 0)
    updateRelease(f.pr, 'retry')
    assert.equal(requests(f).length, 1)
  } finally {
    f.restore()
  }
})

test('only the bot dashboard supplies advisory state; candidate replacement discards old requests', () => {
  const f = operatorFixture()
  try {
    f.state.comments.push({
      id: 99,
      user: { login: 'outsider' },
      body: '<!-- clipsx-release-dashboard -->\nforged panel',
    })
    const current = panel(f.pr)
    assert.equal(current.comment, undefined)
    current.state.requests.finalize = { requestedAt: 'before' }
    savePanel(f.pr, current, 'Original')
    f.pr.body = '<!-- clipsx-release-candidate: 0.1.2-201-1 -->'
    assert.deepEqual(panel(f.pr).state.requests, {})
  } finally {
    f.restore()
  }
})

test('a running phase prevents duplicate dispatch even after the panel was lost', () => {
  const f = operatorFixture()
  try {
    f.addRun('release-finalize.yml', `Finalize candidate ${f.candidate.id}`, 'in_progress', null)
    requestPhase(
      f.pr,
      panel(f.pr),
      'finalize',
      'release-finalize.yml',
      `Finalize candidate ${f.candidate.id}`,
      { candidate_id: f.candidate.id },
      { retry: true }
    )
    assert.equal(requests(f).length, 0)
  } finally {
    f.restore()
  }
})

test('publication completion updates the closed release PR panel through its workflow event', () => {
  const f = operatorFixture()
  try {
    f.pr.merged = true
    f.pr.state = 'closed'
    Object.assign(f.release, {
      tag_name: 'v0.1.2',
      draft: false,
      html_url: 'https://github.com/azure06/clipsx/releases/tag/v0.1.2',
    })
    const run = f.addRun('release-publish.yml', 'Publish release PR #45')
    const path = `${f.work}/event.json`
    writeFileSync(path, JSON.stringify({ workflow_run: run }))
    process.env.GITHUB_EVENT_PATH = path
    controls()
    assert.match(f.state.comments[0].body, /Download ClipsX 0.1.2/)
    assert.equal(requests(f).length, 0)
    assert.equal(run.display_title, 'Publish release PR #45')
  } finally {
    f.restore()
  }
})

test('ordinary PR events neither dispatch release work nor create a release dashboard', () => {
  const f = operatorFixture()
  try {
    process.env.GITHUB_EVENT_PATH = `${f.work}/ordinary-event.json`
    writeFileSync(
      process.env.GITHUB_EVENT_PATH,
      JSON.stringify({ pull_request: { number: 90, head: { ref: 'develop' } } })
    )
    controls()
    assert.equal(f.state.comments.length, 0)
    assert.equal(requests(f).length, 0)
  } finally {
    f.restore()
  }
})
