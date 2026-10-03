import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { verifyMacRuntime } from './mac-runtime.mjs'

test('Mac evidence requires the actual entitlement and exact cold-cache fixture result', () => {
  const key = 'com.apple.security.cs.allow-unsigned-executable-memory'
  const hash = 'a'.repeat(64)
  const log = `extension-runtime verified sha256=${hash} cold_cache=true`
  verifyMacRuntime({ [key]: true }, log, hash)
  assert.throws(() => verifyMacRuntime({}, log, hash))
  assert.throws(() => verifyMacRuntime({ [key]: true, 'com.apple.security.get-task-allow': true }, log, hash))
  assert.throws(() => verifyMacRuntime({ [key]: true }, log, 'b'.repeat(64)))
  assert.throws(() => verifyMacRuntime({ [key]: true }, 'notarization accepted', hash))
  const workflow = readFileSync('.github/workflows/release-prepare.yml', 'utf8')
  assert(workflow.indexOf('Remove Apple credentials') < workflow.indexOf('--verify-extension-runtime'))
  assert.equal((workflow.match(/name: prepared-/g) || []).length, 1)
})
