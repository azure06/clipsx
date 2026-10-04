import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  verifyExecutable,
  validateBuildDescriptor,
  platforms,
  preparationTargets,
} from './builds.mjs'
import { digest } from '../core/contracts.mjs'
import { inputsDigest } from '../core/inputs.mjs'

test('saved executable verifies exact build/platform/frontend and rejects tampered files', () => {
  const bytes = Buffer.from('app'),
    frontend = Buffer.from('frontend'),
    origin = { runId: '123', attempt: '1' }
  const candidate = { version: '0.1.0', build: { origin } }
  const checkpoint = {
    candidateId: '0.1.0-123-1',
    platform: 'macos-x64',
    target: platforms['macos-x64'].target,
    sha256: digest(bytes),
    frontendSha256: digest(frontend),
  }
  verifyExecutable(bytes, checkpoint, candidate, 'macos-x64', frontend)
  assert.throws(() =>
    verifyExecutable(Buffer.from('tampered'), checkpoint, candidate, 'macos-x64', frontend)
  )
  assert.throws(() => verifyExecutable(bytes, checkpoint, candidate, 'macos-arm64', frontend))
  assert.throws(() =>
    verifyExecutable(bytes, checkpoint, candidate, 'macos-x64', Buffer.from('other'))
  )
  assert.throws(() =>
    verifyExecutable(
      bytes,
      checkpoint,
      { ...candidate, build: { origin: { runId: '124', attempt: '1' } } },
      'macos-x64',
      frontend
    )
  )
})
test('selected build inventory stays valid independently of newer runs and rejects expired/missing artifacts', () => {
  const origin = {
    runId: '123',
    attempt: '1',
    sourceRevision: 'a'.repeat(40),
    branch: 'release/0.1.0',
  }
  const run = {
    id: 123,
    run_attempt: 1,
    head_sha: origin.sourceRevision,
    head_branch: origin.branch,
    head_repository: { full_name: 'azure06/clipsx' },
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    path: '.github/workflows/release.yml',
  }
  const artifacts = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? 'frontend-1' : `compiled-${Object.keys(platforms)[i - 1]}-1`,
    digest: `sha256:${'a'.repeat(64)}`,
    expired: false,
  }))
  const candidate = {
    build: {
      origin,
      appInputs: [],
      appInputsSha256: inputsDigest([]),
      frontendArtifact: artifacts[0],
      platforms: Object.fromEntries(
        Object.keys(platforms).map((platform, i) => [
          platform,
          { sha256: 'b'.repeat(64), artifact: artifacts[i + 1] },
        ])
      ),
    },
  }
  validateBuildDescriptor(candidate, run, artifacts)
  assert.throws(() => validateBuildDescriptor(candidate, { ...run, run_attempt: 2 }, artifacts))
  assert.throws(() => validateBuildDescriptor(candidate, run, artifacts.slice(1)))
  assert.throws(() =>
    validateBuildDescriptor(
      candidate,
      run,
      artifacts.map(item => ({ ...item, expired: true }))
    )
  )
  assert.throws(() =>
    validateBuildDescriptor(
      { ...candidate, build: { ...candidate.build, platforms: {} } },
      run,
      artifacts
    )
  )
})
test('packaging lifecycle never compiles the app and updater credentials only enter finalization', () => {
  const root = new URL('../../../', import.meta.url)
  const packaging = readFileSync(new URL('.github/workflows/release-prepare.yml', root), 'utf8')
  assert(!/tauri\.js build|cargo build|npm run build|preflight/.test(packaging))
  assert(!packaging.includes('TAURI_SIGNING_PRIVATE_KEY'))
  assert(packaging.includes('tauri.js bundle'))
  const checks = readFileSync(new URL('.github/workflows/checks.yml', root), 'utf8')
  assert(checks.includes('fail-fast: false'))
  assert(!checks.includes('APPLE_CERTIFICATE'))
  assert(!checks.includes('tauri.js bundle'))
  const finalizer = readFileSync(new URL('.github/workflows/release-finalize.yml', root), 'utf8')
  assert(finalizer.includes('./.github/actions/release-verifier'))
  assert(!finalizer.includes('libwebkit'))
})

test('preparation retries preserve successes and replace only an explicitly chosen platform', () => {
  const candidate = {
    preparation: { 'macos-arm64': { runId: 'older' }, 'linux-x64': { runId: 'older' } },
    windowsKit: [{ sha256: 'original' }],
    artifacts: [{ file: 'original.dmg', sha256: 'original' }],
  }
  const before = JSON.stringify(candidate)
  assert.deepEqual(
    preparationTargets(candidate).map(item => item.platform),
    ['macos-x64']
  )
  assert.deepEqual(
    preparationTargets(candidate, 'linux-x64').map(item => item.platform),
    ['linux-x64']
  )
  assert.equal(preparationTargets(candidate, 'all').length, 4)
  assert.equal(JSON.stringify(candidate), before)
  assert.throws(() => preparationTargets(candidate, 'latest'))
})
