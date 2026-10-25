import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { operatorFixture } from '../testing/operator-fixture.mjs'
import { services } from '../core/github.mjs'
import { assertCertified, digest, encode } from '../core/contracts.mjs'
import { completeInventory } from '../core/candidate.mjs'
import { finalize } from './finalize.mjs'
import { approvalSnapshot, approvedReview, certify, completeRelease } from './signoff.mjs'
import { assertApprovalEnvironment } from './operator.mjs'

function finalized() {
  const f = operatorFixture()
  finalize(f.candidate.id, f.windowsEvidence)
  return f
}

test('a real environment approval creates a hash-bound certification without inventing manual-test results', () => {
  const f = finalized()
  try {
    approvalSnapshot(f.candidate.id, 45)
    certify(f.candidate.id, 45)
    const asset = f.release.assets.find(asset => asset.name === 'certification.json')
    const certificate = JSON.parse(f.blobs.get(asset.id))
    assert.equal(certificate.schemaVersion, 3)
    assert.equal(certificate.approval.actor, 'maintainer')
    assert.equal(certificate.approval.runId, '999')
    assert.equal(certificate.checks, undefined)
    assert.equal(certificate.evidence, undefined)
    const candidateAsset = f.release.assets.find(asset => asset.name === 'candidate.json')
    const bytes = f.blobs.get(candidateAsset.id)
    assertCertified(
      JSON.parse(bytes),
      certificate,
      bytes,
      completeInventory(f.release, JSON.parse(bytes))
    )
    assert.equal(f.pr.draft, false)
    f.state.reviews = []
    certify(f.candidate.id, 45)
    assert.deepEqual(JSON.parse(f.blobs.get(asset.id)), certificate)
  } finally {
    f.restore()
  }
})

test('missing reviewers, admin bypass and missing human approval fail closed', () => {
  const f = finalized()
  try {
    f.state.environment.can_admins_bypass = true
    assert.throws(() => approvalSnapshot(f.candidate.id, 45), /administrator bypass/)
    f.state.environment.can_admins_bypass = false
    const reviewers = f.state.environment.protection_rules
    f.state.environment.protection_rules = []
    assert.throws(() => assertApprovalEnvironment(), /required reviewer/)
    f.state.environment.protection_rules = reviewers
    approvalSnapshot(f.candidate.id, 45)
    f.state.reviews = []
    assert.throws(() => certify(f.candidate.id, 45), /not been approved/)
    f.state.reviews = [
      {
        state: 'approved',
        environments: [{ id: 10, name: 'desktop-release' }],
        user: { type: 'Bot', login: 'automation' },
      },
    ]
    assert.throws(() => certify(f.candidate.id, 45), /human/)
    assert(!f.release.assets.some(asset => asset.name === 'certification.json'))
  } finally {
    f.restore()
  }
})

test('changed packages, metadata, approval runs and selections invalidate a pending approval', () => {
  for (const change of ['inventory', 'descriptor', 'run', 'selection']) {
    const f = finalized()
    try {
      approvalSnapshot(f.candidate.id, 45)
      if (change === 'inventory') f.put('unexpected-file.txt', 'changed')
      if (change === 'descriptor') {
        const asset = f.release.assets.find(asset => asset.name === 'candidate.json')
        f.put('candidate.json', { ...JSON.parse(f.blobs.get(asset.id)), createdAt: 'changed' })
      }
      if (change === 'run') {
        const path = join(f.work, 'approval-snapshot.json')
        writeFileSync(path, encode({ ...JSON.parse(readFileSync(path)), runId: 'another-run' }))
      }
      if (change === 'selection') f.pr.body = '<!-- clipsx-release-candidate: 0.1.2-201-1 -->'
      assert.throws(() => certify(f.candidate.id, 45), /changed|Wrong approval snapshot/)
      assert(!f.release.assets.some(asset => asset.name === 'certification.json'))
    } finally {
      f.restore()
    }
  }
})

test('an untrusted workflow cannot supply release approval history', () => {
  const f = finalized()
  try {
    const original = services.api
    services.api = (path, method, body) =>
      path.endsWith('/actions/runs/999')
        ? { path: '.github/workflows/ci.yml', head_branch: 'feature' }
        : original(path, method, body)
    assert.throws(() => approvedReview('999', f.state.environment), /trusted main/)
  } finally {
    f.restore()
  }
})

test('rerunning an approval workflow reuses its original immutable snapshot', () => {
  const f = finalized()
  try {
    const original = approvalSnapshot(f.candidate.id, 45)
    const contents = readFileSync(join(f.work, 'approval-snapshot.json'))
    f.state.artifacts = [{ name: 'release-approval-999', id: 8, expired: false }]
    services.artifact = (_artifact, directory) =>
      writeFileSync(join(directory, 'approval-snapshot.json'), contents)
    assert.deepEqual(approvalSnapshot(f.candidate.id, 45), original)
    f.put('another-asset.txt', 'changed after snapshot')
    assert.throws(() => approvalSnapshot(f.candidate.id, 45), /changed while waiting/)
  } finally {
    f.restore()
  }
})

test('protected merge binds the PR head and explicitly dispatches publication when merge events are suppressed', () => {
  const f = finalized()
  try {
    approvalSnapshot(f.candidate.id, 45)
    certify(f.candidate.id, 45)
    completeRelease(f.candidate.id, 45)
    const merge = f.trace.find(item => item.path?.endsWith('/pulls/45/merge'))
    assert.deepEqual(merge.body, { sha: f.pr.head.sha, merge_method: 'rebase' })
    const publication = f.trace.find(item => item.path?.includes('/release-publish.yml/dispatches'))
    assert.deepEqual(publication.body, { ref: 'main', inputs: { pr_number: '45' } })
    assert(!f.trace.some(item => item.args?.includes('--admin')))
    assert.equal(f.pr.merged, true)
  } finally {
    f.restore()
  }
})

test('a merge failure retains approval for retry and never dispatches publication prematurely', () => {
  const f = finalized()
  try {
    approvalSnapshot(f.candidate.id, 45)
    certify(f.candidate.id, 45)
    const original = services.api
    services.api = (path, method, body) => {
      if (path.endsWith('/pulls/45/merge')) throw new Error('Required check pending')
      return original(path, method, body)
    }
    assert.throws(() => completeRelease(f.candidate.id, 45), /Required check/)
    assert(!f.trace.some(item => item.path?.includes('/release-publish.yml/dispatches')))
    const certificate = f.release.assets.find(asset => asset.name === 'certification.json')
    const before = digest(f.blobs.get(certificate.id))
    services.api = original
    f.state.reviews = []
    certify(f.candidate.id, 45)
    completeRelease(f.candidate.id, 45)
    assert.equal(digest(f.blobs.get(certificate.id)), before)
  } finally {
    f.restore()
  }
})
