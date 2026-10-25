import test from 'node:test'
import assert from 'node:assert/strict'
import { operatorFixture } from '../testing/operator-fixture.mjs'
import { assertCertified, digest } from '../core/contracts.mjs'
import { completeInventory } from '../core/candidate.mjs'
import { services } from '../core/github.mjs'
import { finalize } from './finalize.mjs'
import {
  verifyForMerge,
  certifyMerged,
  signoffContext,
  loadReadiness,
  assertMergeCertificate,
} from './signoff.mjs'

function ready() {
  const f = operatorFixture()
  finalize(f.candidate.id, f.windowsEvidence)
  verifyForMerge(f.candidate.id, 45, f.pr.head.sha)
  return f
}
function merge(f) {
  Object.assign(f.pr, {
    state: 'closed',
    merged: true,
    merged_by: { type: 'User', login: 'maintainer' },
    merged_at: new Date(Date.now() + 2000).toISOString(),
    merge_commit_sha: f.pr.head.sha,
  })
}
const certificate = f =>
  JSON.parse(f.blobs.get(f.release.assets.find(a => a.name === 'certification.json').id))

test('verification enables a human merge without creating approval or changing distributed files', () => {
  const f = operatorFixture()
  try {
    finalize(f.candidate.id, f.windowsEvidence)
    const before = new Map(f.release.assets.map(a => [a.id, a.digest]))
    verifyForMerge(f.candidate.id, 45, f.pr.head.sha)
    for (const [id, hash] of before)
      assert.equal(f.release.assets.find(a => a.id === id).digest, hash)
    assert.match(f.state.statuses[0].description, /Ready to merge .*; proof [a-f0-9]{64}/)
    assert.equal(f.state.statuses[0].state, 'success')
    assert(!f.release.assets.some(a => a.name === 'certification.json'))
    assert(!f.trace.some(t => t.path?.endsWith('/merge') || t.path?.includes('/deployments')))
    assert.equal(f.pr.draft, false)
    const proof = loadReadiness(signoffContext(f.candidate.id, 45))
    assert.equal(proof.proof.headRevision, f.pr.head.sha)
  } finally {
    f.restore()
  }
})

test('a human merge records exact hashes, merger and merge time without claiming manual tests ran automatically', () => {
  const f = ready()
  try {
    merge(f)
    certifyMerged(f.candidate.id, 45)
    const cert = certificate(f),
      context = signoffContext(f.candidate.id, 45)
    assert.equal(cert.schemaVersion, 4)
    assert.equal(cert.approval.kind, 'pull_request_merge')
    assert.equal(cert.approval.actor, 'maintainer')
    assert.equal(cert.approval.recordedAt, f.pr.merged_at)
    assert.equal(cert.approval.mergeRevision, f.pr.merge_commit_sha)
    assert.equal(cert.checks, undefined)
    assert.equal(cert.evidence, undefined)
    assertCertified(
      context.candidate,
      cert,
      context.bytes,
      completeInventory(f.release, context.candidate)
    )
    assertMergeCertificate(cert, f.pr, context)
    const before = f.release.assets.find(a => a.name === 'certification.json').digest
    certifyMerged(f.candidate.id, 45)
    assert.equal(f.release.assets.find(a => a.name === 'certification.json').digest, before)
  } finally {
    f.restore()
  }
})

test('an open PR or a bot merge cannot approve publication', () => {
  const f = ready()
  try {
    assert.throws(() => certifyMerged(f.candidate.id, 45), /merged PR/)
    merge(f)
    f.pr.merged_by = { type: 'Bot', login: 'github-actions[bot]' }
    assert.throws(() => certifyMerged(f.candidate.id, 45), /human/)
    assert(!f.release.assets.some(a => a.name === 'certification.json'))
  } finally {
    f.restore()
  }
})

test('later pending statuses, wrong actors and readiness after the merge fail closed', () => {
  for (const kind of ['pending', 'actor', 'late']) {
    const f = ready()
    try {
      merge(f)
      if (kind === 'pending') f.state.statuses.unshift({ ...f.state.statuses[0], state: 'pending' })
      if (kind === 'actor') f.state.statuses[0].creator = { login: 'someone' }
      if (kind === 'late')
        f.state.statuses[0].created_at = new Date(Date.parse(f.pr.merged_at) + 1000).toISOString()
      assert.throws(() => certifyMerged(f.candidate.id, 45), /not ready before/)
      assert(!f.release.assets.some(a => a.name === 'certification.json'))
    } finally {
      f.restore()
    }
  }
})

test('changed packages, descriptor, head, selection or readiness proof cannot be approved by an old ready status', () => {
  for (const kind of ['package', 'descriptor', 'head', 'selection', 'proof']) {
    const f = ready()
    try {
      merge(f)
      if (kind === 'package') f.put(f.candidate.artifacts[0].file, 'changed bytes')
      if (kind === 'descriptor') {
        const a = f.release.assets.find(a => a.name === 'candidate.json')
        f.put('candidate.json', { ...JSON.parse(f.blobs.get(a.id)), extra: 'changed' })
      }
      if (kind === 'head') f.pr.head.sha = 'c'.repeat(40)
      if (kind === 'selection') f.pr.body = '<!-- clipsx-release-candidate: 0.1.2-201-1 -->'
      if (kind === 'proof') {
        const a = f.release.assets.find(a => a.name === 'merge-readiness.json')
        f.put('merge-readiness.json', {
          ...JSON.parse(f.blobs.get(a.id)),
          verifiedAt: new Date(0).toISOString(),
        })
      }
      assert.throws(() => certifyMerged(f.candidate.id, 45))
      assert(!f.release.assets.some(a => a.name === 'certification.json'))
    } finally {
      f.restore()
    }
  }
})

test('a stale queued verification refuses another PR head and retrying unchanged readiness reuses its proof', () => {
  const f = ready()
  try {
    assert.throws(() => verifyForMerge(f.candidate.id, 45, 'c'.repeat(40)), /head changed before/)
    const asset = f.release.assets.find(a => a.name === 'merge-readiness.json')
    const before = digest(f.blobs.get(asset.id))
    verifyForMerge(f.candidate.id, 45, f.pr.head.sha)
    assert.equal(digest(f.blobs.get(asset.id)), before)
  } finally {
    f.restore()
  }
})

test('a changed merge identity cannot reuse an existing certification', () => {
  const f = ready()
  try {
    merge(f)
    certifyMerged(f.candidate.id, 45)
    f.pr.merged_by.login = 'other'
    assert.throws(() => certifyMerged(f.candidate.id, 45), /differs from the human/)
  } finally {
    f.restore()
  }
})

test('readiness history is paginated and post-merge statuses cannot replace the pre-merge decision', () => {
  const f = ready()
  try {
    merge(f)
    const actual = f.state.statuses[0],
      api = services.api
    services.api = (path, method, body) => {
      if (path.includes('/statuses?')) {
        if (path.endsWith('page=1'))
          return Array.from({ length: 100 }, () => ({ ...actual, context: 'CI' }))
        return [actual]
      }
      return api(path, method, body)
    }
    certifyMerged(f.candidate.id, 45)
    assert.equal(certificate(f).actor, 'maintainer')
  } finally {
    f.restore()
  }
})

test('a missing or untrusted verification run cannot make packages merge-ready', () => {
  for (const kind of ['path', 'branch', 'failed', 'running']) {
    const f = ready()
    try {
      const api = services.api
      services.api = (path, method, body) => {
        const result = api(path, method, body)
        if (path.endsWith('/actions/runs/999')) {
          if (kind === 'path') result.path = '.github/workflows/ci.yml'
          if (kind === 'branch') result.head_branch = 'feature'
          if (kind === 'failed') result.conclusion = 'failure'
          if (kind === 'running') {
            result.status = 'in_progress'
            result.conclusion = null
          }
        }
        return result
      }
      if (kind === 'path' || kind === 'branch')
        assert.throws(() => loadReadiness(signoffContext(f.candidate.id, 45)), /trusted/)
      else assert.equal(loadReadiness(signoffContext(f.candidate.id, 45)).verified, false)
      merge(f)
      assert.throws(() => certifyMerged(f.candidate.id, 45))
      assert(!f.release.assets.some(a => a.name === 'certification.json'))
    } finally {
      f.restore()
    }
  }
})
