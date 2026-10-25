import test from 'node:test'
import assert from 'node:assert/strict'
import { withTransientRetry } from './retry.mjs'

test('temporary transport errors retry twice without hiding persistent failures', () => {
  let calls = 0
  const waits = []
  const options = { wait: milliseconds => waits.push(milliseconds), report() {} }
  assert.equal(
    withTransientRetry(() => {
      if (++calls < 3) throw new Error('HTTP 503 Service Unavailable')
      return 'saved output'
    }, options),
    'saved output'
  )
  assert.equal(calls, 3)
  assert.deepEqual(waits, [2000, 5000])
  calls = 0
  assert.throws(
    () =>
      withTransientRetry(() => {
        calls++
        throw new Error('network connection was lost (-1005)')
      }, options),
    /network/
  )
  assert.equal(calls, 3)
})

test('signature, identity, credential and notarization rejections never count as transport failures', () => {
  for (const reason of [
    'Invalid signature',
    'Wrong executable identity',
    'HTTP 401 Unauthorized',
    'HTTP 403 Forbidden',
    'notarization status: Invalid',
    'Release assets changed',
  ]) {
    let calls = 0
    assert.throws(
      () =>
        withTransientRetry(
          () => {
            calls++
            throw new Error(reason)
          },
          {
            wait() {
              assert.fail('must not wait')
            },
          }
        ),
      new RegExp(reason)
    )
    assert.equal(calls, 1)
  }
})
