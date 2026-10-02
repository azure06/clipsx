import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { verifyCheckpoint } from './checkpoint.mjs'
import { assertCurrent, digest, preparationAttempt } from './model.mjs'

test('compiled checkpoints reject changed binaries and another candidate/platform/frontend', () => {
  const bytes = Buffer.from('compiled application')
  const identity = { schemaVersion: 1, candidateId: '0.1.0-123-1', platform: 'macos-x64', target: 'x86_64-apple-darwin', frontendSha256: 'a'.repeat(64) }
  const checkpoint = { ...identity, sha256: digest(bytes) }
  verifyCheckpoint(bytes, checkpoint, identity)
  assert.throws(() => verifyCheckpoint(Buffer.from('changed'), checkpoint, identity), /executable changed/)
  for (const key of ['candidateId', 'platform', 'target', 'frontendSha256'])
    assert.throws(() => verifyCheckpoint(bytes, checkpoint, { ...identity, [key]: 'different' }), /mismatch/)
})

test('failed-job retries retain the build generation; a new frontend generation supersedes it', () => {
  const candidate = { schemaVersion: 1, id: '0.1.0-123-1', stagingTag: 'candidate-0.1.0-123-1', version: '0.1.0', branch: 'release/0.1.0', runId: '123', runAttempt: '1', sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), build: { production: true, updaterPublicKey: 'key' } }
  const retry = { id: 123, run_attempt: 2, head_sha: candidate.sourceRevision, conclusion: 'success' }
  const jobs = [{ name: 'checks / Frontend and dependency checks', run_attempt: 1, conclusion: 'success' }]
  const artifacts = [{ name: 'frontend-1', expired: false }, { name: 'compiled-macos-x64-1', expired: false }]
  assert.equal(preparationAttempt(retry, artifacts, jobs), '1')
  assertCurrent(candidate, candidate.sourceRevision, { ...retry, preparation_attempt: preparationAttempt(retry, artifacts, jobs) })
  assert.throws(() => assertCurrent(candidate, 'c'.repeat(40), { ...retry, preparation_attempt: '1' }))
  assert.throws(() => assertCurrent(candidate, candidate.sourceRevision, { ...retry, conclusion: 'failure', preparation_attempt: '1' }))
  jobs.push({ name: 'checks / Frontend and dependency checks', run_attempt: 2, conclusion: 'success' })
  artifacts.push({ name: 'frontend-2', expired: false })
  assert.equal(preparationAttempt(retry, artifacts, jobs), '2')
  assert.throws(() => assertCurrent(candidate, candidate.sourceRevision, { ...retry, preparation_attempt: preparationAttempt(retry, artifacts, jobs) }))
  assert.throws(() => preparationAttempt(retry, [{ name: 'frontend-1', expired: false }], jobs), /generation evidence/)
  assert.throws(() => preparationAttempt(retry, [], jobs), /missing/)
  assert.throws(() => preparationAttempt(retry, [{ name: 'frontend-2', expired: true }], jobs), /expired/)
  assert.throws(() => preparationAttempt(retry, [{ name: 'frontend-3', expired: false }], jobs), /invalid/)
})

test('production desktop bundle selects only ClipsX, while the packaging tool remains opt-in', () => {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], { encoding: 'utf8' }))
  const app = metadata.packages.find(pkg => pkg.name === 'clipsx')
  const defaults = app.features.default
  const binaries = app.targets.filter(target => target.kind.includes('bin'))
  const bundled = binaries.filter(target => (target['required-features'] || []).every(feature => defaults.includes(feature)))
  assert.deepEqual(bundled.map(target => target.name), ['clipsx'])
  assert.deepEqual(binaries.find(target => target.name === 'clipsx-extension-tool')['required-features'], ['extension-tools'])
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
  assert.match(scripts['extension:pack'], /--features extension-tools/)
  assert.match(scripts['extension:validate'], /--features extension-tools/)
})
