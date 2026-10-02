import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise the actual app configuration only in app preflight, not infrastructure-only CI.
test(
  'frontend environment excludes updater signing credentials',
  { skip: process.env.RELEASE_CHECK_APP_ENV !== 'true' },
  async () => {
    const require = createRequire(resolve('package.json'))
    const { resolveConfig } = await import(pathToFileURL(require.resolve('vite')).href)
    const values = {
      TAURI_SIGNING_PRIVATE_KEY: 'release-test-private-key',
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'release-test-private-password',
      VITE_RELEASE_ENV_TEST: 'release-test-public-value',
    }
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
    try {
      Object.assign(process.env, values)
      const config = await resolveConfig({}, 'build', 'production')
      assert.equal(config.env.VITE_RELEASE_ENV_TEST, values.VITE_RELEASE_ENV_TEST)
      assert.equal(config.env.TAURI_SIGNING_PRIVATE_KEY, undefined)
      assert.equal(config.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, undefined)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }
)
