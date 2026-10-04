import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
test('Windows delegation resolves trusted helpers and a fresh signing workspace', () => {
  const root = new URL('../../../../', import.meta.url)
  const wrapper = readFileSync(new URL('scripts/release/sign-windows.ps1', root), 'utf8')
  assert(wrapper.includes('platforms/windows/sign-windows.ps1'))
  const helper = readFileSync(new URL('sign-windows.ps1', import.meta.url), 'utf8')
  assert(helper.includes("Join-Path $PSScriptRoot '../../../..'"))
  assert(existsSync(fileURLToPath(new URL('scripts/release/pipeline.mjs', root))))
  for (const file of ['image.mjs', 'sign-file.ps1', 'verify-windows.ps1'])
    assert(existsSync(new URL(file, import.meta.url)))
  assert(helper.includes('WorkingDirectory already exists'))
  assert(!/cargo build|tauri\.js build|npm run build/.test(helper))
  const hosted = readFileSync(new URL('verify-windows.ps1', import.meta.url), 'utf8')
  assert(hosted.includes('$installRoot installed'))
})
