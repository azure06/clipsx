import test from 'node:test'
import assert from 'node:assert/strict'
import { publicEnvironment, consumerEnvironment, assertPublicEnvironment } from './environment.mjs'
import { classify, decisions } from './inputs.mjs'

test('public mapping preserves recorded descriptors and excludes secrets', () => {
  const env = {
    SENTRY_DESKTOP_DSN: 'public-dsn',
    VITE_NEXT_PUBLIC_SITE_URL: 'https://clipsx.app',
    TAURI_SIGNING_PRIVATE_KEY: 'secret',
    SENTRY_AUTH_TOKEN: 'secret',
  }
  const mapped = consumerEnvironment(env)
  assert.equal(mapped.SENTRY_DSN, 'public-dsn')
  assert.equal(mapped.VITE_SENTRY_DSN, 'public-dsn')
  assert.equal(mapped.VITE_NEXT_PUBLIC_SITE_URL, env.VITE_NEXT_PUBLIC_SITE_URL)
  assert(!JSON.stringify(mapped).includes('secret'))
  const candidate = { build: { publicEnvironment: publicEnvironment(env) } }
  assertPublicEnvironment(candidate, env)
  assert.throws(() => assertPublicEnvironment(candidate, { ...env, SENTRY_DESKTOP_DSN: 'changed' }))
  assert.equal(consumerEnvironment(env, 'checks').VITE_SENTRY_DSN, '')
})
test('relocated, new, deleted and mixed inputs select independent check owners', () => {
  assert.deepEqual(decisions(['docs/RELEASE.md']), {
    app: false,
    build: false,
    tooling: false,
    docs: true,
  })
  assert.deepEqual(decisions(['scripts/release/candidate/finalize.mjs']), {
    app: false,
    build: false,
    tooling: true,
    docs: false,
  })
  assert.equal(classify('scripts/release/build/builds.mjs'), 'recipe')
  assert.equal(classify('scripts/release/build/builds.test.mjs'), 'release')
  assert.equal(classify('scripts/release/core/environment.mjs'), 'recipe')
  assert.equal(classify('scripts/production-env.mjs'), 'app')
  for (const path of ['src/new.ts', 'src/deleted.ts', 'unknown.config'])
    assert(decisions([path]).app)
  assert.deepEqual(
    decisions(['src/new.ts', 'docs/RELEASE.md', 'scripts/release/platforms/windows/image.mjs']),
    { app: true, build: true, tooling: true, docs: true }
  )
})
