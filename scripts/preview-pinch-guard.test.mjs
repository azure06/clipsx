import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const script = readFileSync(
  new URL('../src-tauri/src/app/preview_pinch_guard.js', import.meta.url),
  'utf8'
)
test('native pinch guard prevents page scaling and still delivers the event to a preview', () => {
  let guard, options
  runInNewContext(script, {
    window: {
      addEventListener(name, handler, opts) {
        assert.equal(name, 'wheel')
        guard = handler
        options = opts
      },
    },
  })
  assert.equal(options.capture, true)
  assert.equal(options.passive, false)
  const pinch = new globalThis.Event('wheel', { cancelable: true })
  Object.defineProperty(pinch, 'ctrlKey', { value: true })
  guard(pinch)
  assert.equal(pinch.defaultPrevented, true)
  assert.equal(pinch.cancelBubble, false)
  const preview = new globalThis.EventTarget()
  let received = false
  preview.addEventListener('wheel', () => {
    received = true
  })
  preview.dispatchEvent(pinch)
  assert.equal(received, true)
  const scrolling = new globalThis.Event('wheel', { cancelable: true })
  Object.defineProperty(scrolling, 'ctrlKey', { value: false })
  guard(scrolling)
  assert.equal(scrolling.defaultPrevented, false)
})
