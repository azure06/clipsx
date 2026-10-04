import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepare, stagePlatform } from './prepare.mjs'
import { githubFixture } from '../testing/github-fixture.mjs'
import { services } from '../core/github.mjs'
import { digest, encode } from '../core/contracts.mjs'
import { platforms } from '../build/builds.mjs'

test('packaging-tool corrections consume an explicit older build and preserve successes', () => {
  const f = githubFixture(),
    previousId = process.env.GITHUB_RUN_ID,
    previousAttempt = process.env.GITHUB_RUN_ATTEMPT
  try {
    const artifacts = [
      { id: 101, name: 'frontend-1', digest: 'sha256:' + digest('frontend'), expired: false },
      ...Object.keys(platforms).map((platform, i) => ({
        id: 102 + i,
        name: `compiled-${platform}-1`,
        digest: 'sha256:' + digest(platform),
        expired: false,
      })),
    ]
    f.candidate.build.frontendArtifact = artifacts[0]
    f.candidate.build.platforms = Object.fromEntries(
      Object.keys(platforms).map((platform, i) => [
        platform,
        { artifact: artifacts[i + 1], sha256: digest(platform) },
      ])
    )
    f.candidate.preparation = { 'macos-arm64': { runId: 'older' }, 'linux-x64': { runId: 'older' } }
    f.candidate.windowsKit = [{ file: 'source.zip', sha256: digest('kit') }]
    f.put('candidate.json', f.candidate)
    const original = services.command
    services.command = (program, args, options) => {
      if (program === 'gh' && args[1]?.includes('/actions/runs/100/artifacts'))
        return JSON.stringify([{ artifacts }])
      return original(program, args, options)
    }
    services.api = (original => (path, method, body) =>
      path.includes('pulls?') ? [] : original(path, method, body))(services.api)
    const before = encode(f.candidate.artifacts)
    prepare('100', f.candidate.id, 'missing')
    const saved = JSON.parse(readFileSync(join(f.work, 'candidate.json')))
    assert.equal(encode(saved.artifacts), before)
    assert(!f.trace.some(item => item.program === 'node' || item.program === 'cargo'))
    assert.throws(() => prepare('999', f.candidate.id, 'missing'), /another build/)
    artifacts[0].expired = true
    assert.throws(() => prepare('100', f.candidate.id, 'missing', '', 'main'), /expired/)
    assert(!f.trace.some(item => item.program === 'gh' && item.args[1] === 'upload'))
  } finally {
    f.restore()
    if (previousId === undefined) delete process.env.GITHUB_RUN_ID
    else process.env.GITHUB_RUN_ID = previousId
    if (previousAttempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT
    else process.env.GITHUB_RUN_ATTEMPT = previousAttempt
  }
})
test('successful platform outputs survive retries and implicit replacement is rejected', () => {
  const f = githubFixture()
  try {
    const platform = 'linux-x64',
      path = join(f.work, platform)
    mkdirSync(path)
    const local = {
      candidateId: f.candidate.id,
      artifacts: f.candidate.artifacts.filter(
        item => item.file.endsWith('.deb') || item.file.endsWith('.AppImage')
      ),
      evidence: f.candidate.evidence.find(item => item.file.includes(platform)),
    }
    for (const item of [...local.artifacts, local.evidence]) {
      const asset = f.release.assets.find(asset => asset.name === item.file)
      writeFileSync(join(path, item.file), f.blobs.get(asset.id))
    }
    writeFileSync(join(path, `platform-${platform}.json`), encode(local))
    stagePlatform(f.candidate.id, platform)
    const writes = () =>
      f.trace.filter(item => item.program === 'gh' && item.args[1] === 'upload').length
    const count = writes()
    stagePlatform(f.candidate.id, platform)
    assert.equal(writes(), count)
    writeFileSync(join(path, local.artifacts[0].file), 'new package')
    local.artifacts[0].sha256 = digest('new package')
    local.artifacts[0].size = 11
    writeFileSync(join(path, `platform-${platform}.json`), encode(local))
    assert.throws(() => stagePlatform(f.candidate.id, platform), /explicit platform/)
    stagePlatform(f.candidate.id, platform, platform)
    assert(writes() > count)
  } finally {
    f.restore()
  }
})
