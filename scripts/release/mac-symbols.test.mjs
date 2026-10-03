import test from 'node:test'
import assert from 'node:assert/strict'
import { assertRecovery } from './mac-symbols.mjs'

test('one-time symbol recovery rejects unrelated builds, runs and changed archives', () => {
  const platform = 'macos-arm64'
  const build = {
    sourceRevision: '2c4573d8b02e91e18f1ef97a0df48cc3b0af7730',
    build: { origin: { runId: '37122124538' }, platforms: { [platform]: { sha256: 'binary' } } },
  }
  const run = {
    conclusion: 'success',
    head_repository: { full_name: 'azure06/clipsx' },
    head_branch: 'release/0.1.1',
    path: '.github/workflows/recover-0.1.1-symbols.yml',
  }
  const evidence = {
    buildRunId: '37122124538',
    platform,
    cacheKey: 'release-macos-arm64-Darwin-arm64-ff44c5d7-be351c3c',
    executableSha256: 'binary',
    archiveSha256: 'symbols',
  }
  assertRecovery(run, build, platform, evidence, 'symbols')
  for (const change of [
    { conclusion: 'failure' },
    { head_repository: { full_name: 'someone/fork' } },
    { head_branch: 'main' },
    { path: '.github/workflows/other.yml' },
  ])
    assert.throws(() => assertRecovery({ ...run, ...change }, build, platform, evidence, 'symbols'))
  assert.throws(() =>
    assertRecovery(
      run,
      { ...build, build: { ...build.build, origin: { runId: '123' } } },
      platform,
      evidence,
      'symbols'
    )
  )
  for (const change of [
    { archiveSha256: 'changed' },
    { executableSha256: 'changed' },
    { cacheKey: 'other' },
    { platform: 'macos-x64' },
    { buildRunId: '123' },
  ])
    assert.throws(() => assertRecovery(run, build, platform, { ...evidence, ...change }, 'symbols'))
})
