import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { githubFixture } from '../testing/github-fixture.mjs'
import { finalize } from './finalize.mjs'
import { updateNotes } from './notes.mjs'
import { services, loadCandidate, downloadAsset } from '../core/github.mjs'
import { assertCurrent } from '../core/candidate.mjs'
import { digest, encode } from '../core/contracts.mjs'

test('finalization retries reuse signatures and assets without compilation or identical downloads', () => {
  const f = githubFixture()
  try {
    const original = services.command
    let interrupted = true
    services.command = (program, args, options) => {
      if (
        interrupted &&
        program === 'gh' &&
        args[1] === 'upload' &&
        args[3].endsWith('latest.json')
      ) {
        interrupted = false
        throw new Error('Interrupted upload')
      }
      return original(program, args, options)
    }
    assert.throws(() => finalize(f.candidate.id, f.windowsEvidence), /Interrupted/)
    assert.equal(f.trace.filter(item => item.program === 'node').length, 5)
    finalize(f.candidate.id, f.windowsEvidence)
    const writes = f.trace.filter(item => item.program === 'gh' && item.args[1] === 'upload').length
    finalize(f.candidate.id)
    assert.equal(
      f.trace.filter(item => item.program === 'gh' && item.args[1] === 'upload').length,
      writes
    )
    assert.equal(f.trace.filter(item => item.program === 'node').length, 5)
    assert(
      !f.trace.some(
        item =>
          item.program === 'cargo' || item.args?.includes('build') || item.args?.includes('test')
      )
    )
    const transfers = f.trace
      .filter(item => item.args?.[1]?.includes('/releases/assets/'))
      .map(item => item.args[1])
    // Descriptors legitimately transfer again when their bytes change; unchanged packages do not.
    for (const asset of f.release.assets.filter(asset =>
      f.candidate.artifacts.some(item => item.file === asset.name)
    ))
      assert.equal(transfers.filter(path => path.endsWith(`/${asset.id}`)).length, 1)
  } finally {
    f.restore()
  }
})
test('explicit notes corrections preserve package bytes and reject finalized/certified updates', () => {
  const f = githubFixture()
  try {
    const before = encode(f.candidate.artifacts)
    updateNotes(f.release, f.candidate, 'main')
    assert.equal(encode(f.candidate.artifacts), before)
    assert.equal(f.candidate.releaseNotesSha256, digest('Corrected notes\n'))
    assert.equal(f.candidate.releaseNotesRevision, f.candidate.sourceRevision)
    f.candidate.finalizedAt = 'now'
    assert.throws(() => updateNotes(f.release, f.candidate, 'main'), /immutable/)
    delete f.candidate.finalizedAt
    f.put('certification.json', {})
    assert.throws(() => updateNotes(f.release, f.candidate, 'main'), /immutable/)
  } finally {
    f.restore()
  }
})
test('changed descriptor, changed bytes and wrong signatures block lifecycle writes', () => {
  const f = githubFixture()
  try {
    const snapshot = { release: f.release, ...loadCandidate(f.release, f.work) }
    f.put('candidate.json', { ...f.candidate, createdAt: 'different' })
    assert.throws(() => assertCurrent(snapshot, true), /descriptor changed/)
    f.put('candidate.json', f.candidate)
    f.put(f.candidate.artifacts[1].file, 'tampered')
    assert.throws(() => finalize(f.candidate.id, f.windowsEvidence), /Asset changed/)
  } finally {
    f.restore()
  }
  const second = githubFixture()
  try {
    second.put(`${second.candidate.artifacts[0].file}.sig`, 'invalid signature')
    assert.throws(() => finalize(second.candidate.id, second.windowsEvidence), /Wrong updater/)
  } finally {
    second.restore()
  }
})
test('historical notes provenance is read without rewriting published bytes', () => {
  const f = githubFixture()
  try {
    delete f.candidate.releaseNotesRevision
    f.put('candidate.json', f.candidate)
    const result = loadCandidate(f.release, f.work)
    assert.equal(result.releaseNotesRevision, f.candidate.sourceRevision)
    assert.equal(result.bytes.toString(), encode(f.candidate))
    assert.equal(readFileSync(join(f.work, 'candidate.json'), 'utf8'), encode(f.candidate))
    writeFileSync(join(f.work, 'unused'), 'test')
    downloadAsset(f.release, 'candidate.json', f.work)
  } finally {
    f.restore()
  }
})
