import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'vitest'
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, '../src-tauri', path), 'utf8')

test('pinned shortcuts are dispatched and included in generated application permissions', () => {
  assert.match(read('src/ipc/mod.rs'), /generate_handler![\s\S]*\blist_pinned_shortcuts,/)
  assert.match(read('build.rs'), /"list_pinned_shortcuts"/)
  assert.match(read('permissions/main-app-commands.toml'), /"allow-list-pinned-shortcuts"/)
})

test('the main webview receives the pinned shortcut permission set', () => {
  const capability = JSON.parse(read('capabilities/default.json'))
  assert.deepEqual(capability.webviews, ['main'])
  assert.ok(capability.permissions.includes('main-app-commands'))
})

test('moving pins has complete command and main webview permission wiring', () => {
  assert.match(read('src/ipc/mod.rs'), /generate_handler![\s\S]*\bmove_pinned_clip,/)
  assert.match(read('build.rs'), /"move_pinned_clip"/)
  assert.match(read('permissions/main-app-commands.toml'), /"allow-move-pinned-clip"/)
})
