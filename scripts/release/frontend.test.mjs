import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordFrontend, verifyFrontend } from './frontend.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'clipsx-frontend-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'dist/assets'), { recursive: true })
  mkdirSync(join(root, 'src-tauri'))
  writeFileSync(
    join(root, 'dist/index.html'),
    '<script type="module" src="/assets/app.js"></script>'
  )
  writeFileSync(join(root, 'dist/assets/app.js'), 'console.log("app")')
  writeFileSync(
    join(root, 'src-tauri/tauri.auth.csp.conf.json'),
    '{"app":{"security":{"csp":"production"}}}'
  )
  writeFileSync(
    join(root, 'src-tauri/tauri.ci-build.conf.json'),
    '{"build":{"beforeBuildCommand":null}}'
  )
  const identity = {
    schemaVersion: 1,
    sourceRevision: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    runId: '123',
    runAttempt: '1',
    production: true,
    configuration: { lock: 'c'.repeat(64) },
  }
  return { root, identity, manifest: recordFrontend(root, identity) }
}

test('checked frontend survives transfer and rejects another source, attempt or build mode', t => {
  const { root, identity, manifest } = fixture(t)
  assert.equal(verifyFrontend(root, manifest, identity), manifest)
  for (const [key, value] of Object.entries({
    sourceRevision: 'd'.repeat(40),
    sourceTree: 'e'.repeat(40),
    runId: '124',
    runAttempt: '2',
    production: false,
    configuration: { lock: 'f'.repeat(64) },
  }))
    assert.throws(
      () => verifyFrontend(root, manifest, { ...identity, [key]: value }),
      /mismatch|configuration changed/
    )
})

test('missing and changed assets fail before native compilation', t => {
  const { root, identity, manifest } = fixture(t)
  writeFileSync(join(root, 'dist/assets/app.js'), 'tampered')
  assert.throws(() => verifyFrontend(root, manifest, identity), /missing, extra or changed/)
  rmSync(join(root, 'dist/index.html'))
  assert.throws(() => verifyFrontend(root, manifest, identity), /ENOENT/)
})

test('extra files, changed CSP and rebuild hooks invalidate checked frontend', t => {
  const { root, identity, manifest } = fixture(t)
  writeFileSync(join(root, 'dist/unexpected.js'), 'unexpected')
  assert.throws(() => verifyFrontend(root, manifest, identity), /missing, extra or changed/)
  rmSync(join(root, 'dist/unexpected.js'))
  writeFileSync(join(root, 'src-tauri/tauri.auth.csp.conf.json'), '{}')
  assert.throws(() => verifyFrontend(root, manifest, identity), /missing, extra or changed/)
  writeFileSync(
    join(root, 'src-tauri/tauri.ci-build.conf.json'),
    '{"build":{"beforeBuildCommand":"npm run build"}}'
  )
  assert.throws(() => verifyFrontend(root, manifest, identity), /without rebuilding/)
})

test('test stub frontend cannot become a release artifact', t => {
  const { root, identity } = fixture(t)
  writeFileSync(join(root, 'dist/index.html'), '<!DOCTYPE html><html></html>')
  assert.throws(() => recordFrontend(root, identity), /stubs cannot ship/)
  rmSync(join(root, 'dist/assets/app.js'))
  assert.throws(() => recordFrontend(root, identity), /no compiled application/)
})
