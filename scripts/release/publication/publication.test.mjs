import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { githubFixture } from '../testing/github-fixture.mjs'
import { services } from '../core/github.mjs'
import { completeInventory } from '../core/candidate.mjs'
import { digest, encode, targets } from '../core/contracts.mjs'
import { finalize } from '../candidate/finalize.mjs'
import { verifyPublishedCommand } from './publish.mjs'

test('published verification and retries are read-only and retain certification hashes', () => {
  const f = githubFixture()
  try {
    finalize(f.candidate.id, f.windowsEvidence)
    const asset = f.release.assets.find(item => item.name === 'candidate.json'),
      bytes = f.blobs.get(asset.id),
      candidate = JSON.parse(bytes)
    const certification = {
      schemaVersion: 2,
      candidateId: candidate.id,
      sourceRevision: candidate.sourceRevision,
      sourceTree: candidate.sourceTree,
      candidateSha256: digest(bytes),
      inventorySha256: digest(encode(completeInventory(f.release, candidate))),
      evidence: 'https://example.test/tests',
      checks: { macExtensions: 'passed' },
      platforms: targets.map(item => item.id),
      releasePrNumber: 40,
      appInputsSha256: candidate.build.appInputsSha256,
    }
    f.put('certification.json', certification)
    Object.assign(f.release, { tag_name: 'v0.1.2', draft: false, prerelease: false })
    const pr = {
      number: 40,
      merged: true,
      merge_commit_sha: candidate.sourceRevision,
      base: { ref: 'main' },
      head: { ref: candidate.branch, repo: { full_name: 'azure06/clipsx' } },
      body: `<!-- clipsx-release-candidate: ${candidate.id} -->`,
    }
    const original = services.command
    services.command = (program, args, options) => {
      if (program === 'curl') {
        f.trace.push({ program, args })
        const name = args.at(-1).split('/').at(-1),
          data = f.blobs.get(f.release.assets.find(asset => asset.name === name).id)
        if (args.includes('--output')) {
          writeFileSync(args[args.indexOf('--output') + 1], data)
          return ''
        }
        return data.toString()
      }
      return original(program, args, options)
    }
    services.api = path => {
      f.trace.push({ path, method: 'GET' })
      if (path.endsWith('/pulls/40')) return pr
      if (path.includes('/git/ref/tags/'))
        return { object: { type: 'commit', sha: pr.merge_commit_sha } }
      if (path.endsWith('/releases/latest') || path.includes('/releases/tags/'))
        return structuredClone(f.release)
      throw new Error('Unexpected public verification operation')
    }
    f.trace.length = 0
    verifyPublishedCommand('40')
    verifyPublishedCommand('40')
    assert(f.trace.every(item => !item.method || item.method === 'GET'))
    assert(
      !f.trace.some(
        item => item.program === 'node' || item.program === 'cargo' || item.args?.includes('upload')
      )
    )
    f.put(candidate.artifacts[0].file, 'tampered certified bytes')
    assert.throws(() => verifyPublishedCommand('40'), /changed after certification/)
    assert(readFileSync(f.work + '/candidate.json').length > 0)
  } finally {
    f.restore()
  }
})
