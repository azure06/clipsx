import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { classify, route, appInputs, inputsDigest, assertPublicEnvironment } from './inputs.mjs'
import { selectedCandidate, assertMutable } from './contracts.mjs'

test('routing classifies app, recipes, docs, packaging and unknown files conservatively', () => {
  for (const path of [
    'src/App.tsx',
    'src-tauri/Cargo.lock',
    'src-tauri/migrations/001.sql',
    'src-tauri/icons/new.ico',
    'public/logo.png',
    'vite.config.ts',
    'scripts/generate-tauri-auth-csp.mjs',
    'new-build-config.json',
  ]) {
    assert.equal(classify(path), 'app')
    assert(route([path]))
  }
  for (const path of [
    '.github/workflows/checks.yml',
    'scripts/release/preflight.mjs',
    'scripts/release/build/frontend.mjs',
  ]) {
    assert.equal(classify(path), 'recipe')
    assert(route([path]))
  }
  for (const path of [
    'docs/MODELS.md',
    'README.md',
    'scripts/release/sign-windows.ps1',
    '.github/workflows/release-prepare.yml',
    'tools/release-verify/Cargo.lock',
  ])
    assert(!route([path]))
  assert(route(['docs/MODELS.md', 'src/new.ts']))
})
test('app inventory tolerates docs/tooling commits and detects additions/deletions/config changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'clipsx-inputs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'test@example.com')
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'docs'))
  mkdirSync(join(root, 'scripts/release'), { recursive: true })
  writeFileSync(join(root, 'src/app.ts'), 'app')
  writeFileSync(join(root, 'docs/MODELS.md'), 'docs')
  git('add', '.')
  git('commit', '-m', 'fixture')
  const original = inputsDigest(appInputs('HEAD', root))
  writeFileSync(join(root, 'docs/MODELS.md'), 'new docs')
  writeFileSync(join(root, 'scripts/release/sign-windows.ps1'), 'new signing')
  git('add', '.')
  git('commit', '-m', 'tooling')
  assert.equal(inputsDigest(appInputs('HEAD', root)), original)
  writeFileSync(join(root, 'src/new.ts'), 'new app')
  git('add', '.')
  git('commit', '-m', 'app addition')
  assert.notEqual(inputsDigest(appInputs('HEAD', root)), original)
  rmSync(join(root, 'src/new.ts'))
  git('add', '.')
  git('commit', '-m', 'remove addition')
  assert.equal(inputsDigest(appInputs('HEAD', root)), original)
  rmSync(join(root, 'src/app.ts'))
  git('add', '.')
  git('commit', '-m', 'remove app')
  assert.notEqual(inputsDigest(appInputs('HEAD', root)), original)
})
test('environment changes require a new build and finalized candidates cannot be replaced', () => {
  const values = {
    VITE_SUPABASE_URL: 'https://example.com',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'public',
    VITE_NEXT_PUBLIC_SITE_URL: 'https://clipsx.app',
    VITE_SENTRY_DSN: 'dsn',
  }
  const candidate = { build: { publicEnvironment: values } }
  assertPublicEnvironment(candidate, values)
  assert.throws(() => assertPublicEnvironment(candidate, { ...values, VITE_SENTRY_DSN: 'changed' }))
  assertMutable(candidate, { assets: [] })
  assert.throws(() => assertMutable({ ...candidate, finalizedAt: 'now' }, { assets: [] }))
  assert.throws(() => assertMutable(candidate, { assets: [{ name: 'certification.json' }] }))
  assert.equal(
    selectedCandidate('hello\n<!-- clipsx-release-candidate: 0.1.0-123-1 -->'),
    '0.1.0-123-1'
  )
  assert.throws(() =>
    selectedCandidate(
      '<!-- clipsx-release-candidate: 0.1.0-123-1 --><!-- clipsx-release-candidate: 0.1.0-124-1 -->'
    )
  )
})
