import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ensureStapled } from './staple.mjs'

const app = '/tmp/ClipsX.app'
const dmg = '/tmp/ClipsX.dmg'
const env = {
  APPLE_SIGNING_IDENTITY: 'Developer ID Application: Fixture',
  APPLE_API_KEY_PATH: '/tmp/fixture.p8',
  APPLE_API_KEY: 'fixture-key',
  APPLE_API_ISSUER: 'fixture-issuer',
}
const retryOptions = { wait() {}, report() {} }
const failure = (stdout, status = 65, stderr = '') =>
  Object.assign(new Error('command failed'), { stdout, status, stderr })
const missing = path => failure(`${path} does not have a ticket stapled to it.`)

function fixture({ ticket = false, validate, staple, submit } = {}) {
  const calls = []
  return {
    calls,
    run(program, args) {
      calls.push([program, ...args])
      if (program === 'codesign') return ''
      if (args[0] === 'notarytool') return submit?.(calls) ?? JSON.stringify({ status: 'Accepted' })
      if (args[1] === 'validate') {
        if (validate) return validate(calls)
        if (!ticket) throw missing(args[2])
        return 'The validate action worked!'
      }
      assert.equal(args[1], 'staple')
      const output = staple?.(value => {
        ticket = value
      })
      ticket = true
      return output ?? 'The staple action worked!'
    },
  }
}

test('valid app and DMG tickets skip stapling, signing and submission', () => {
  for (const path of [app, dmg]) {
    const state = fixture({ ticket: true })
    ensureStapled(path, { run: state.run, notarize: path === dmg, env: {}, retryOptions })
    assert.deepEqual(state.calls, [['xcrun', 'stapler', 'validate', path]])
  }
})

test('an explicit missing app ticket is stapled and validated before success', () => {
  const state = fixture()
  ensureStapled(app, { run: state.run, retryOptions })
  assert.deepEqual(state.calls, [
    ['xcrun', 'stapler', 'validate', app],
    ['xcrun', 'stapler', 'staple', app],
    ['xcrun', 'stapler', 'validate', app],
  ])
})

test('an unstapled DMG requires signing and accepted notarization before stapling', () => {
  const state = fixture()
  ensureStapled(dmg, { run: state.run, notarize: true, env, retryOptions })
  assert.deepEqual(state.calls, [
    ['xcrun', 'stapler', 'validate', dmg],
    ['codesign', '--force', '--sign', env.APPLE_SIGNING_IDENTITY, dmg],
    [
      'xcrun',
      'notarytool',
      'submit',
      dmg,
      '--key',
      env.APPLE_API_KEY_PATH,
      '--key-id',
      env.APPLE_API_KEY,
      '--issuer',
      env.APPLE_API_ISSUER,
      '--wait',
      '--timeout',
      '20m',
      '--output-format',
      'json',
    ],
    ['xcrun', 'stapler', 'staple', dmg],
    ['xcrun', 'stapler', 'validate', dmg],
  ])
})

test('network failures during validation never imply a missing ticket', () => {
  for (const diagnostic of [
    'CloudKit network unavailable',
    `${app} does not have a ticket stapled to it.\nHTTP 503 Service Unavailable`,
  ]) {
    const state = fixture({
      validate() {
        throw failure(diagnostic)
      },
    })
    const waits = []
    assert.throws(() =>
      ensureStapled(dmg, {
        run: state.run,
        notarize: true,
        env,
        retryOptions: { wait: ms => waits.push(ms), report() {} },
      })
    )
    assert.equal(state.calls.length, 3)
    assert(state.calls.every(call => call[2] === 'validate'))
    assert.deepEqual(waits, [2000, 5000])
  }
})

test('temporary validation failures can recover without modifying an existing ticket', () => {
  let validations = 0
  const state = fixture({
    validate() {
      if (++validations === 1) throw failure('CloudKit network unavailable')
      return 'The validate action worked!'
    },
  })
  ensureStapled(dmg, { run: state.run, notarize: true, env: {}, retryOptions })
  assert.equal(state.calls.length, 2)
  assert(state.calls.every(call => call[2] === 'validate'))
})

test('invalid, indeterminate and missing-input validation failures do not modify packages', () => {
  for (const error of [
    failure('Ticket signature is invalid'),
    failure('An unknown validation error occurred'),
    failure('No such file or directory', 66),
    failure(`${app} does not have a ticket stapled to it.`, 77),
  ]) {
    const state = fixture({
      validate() {
        throw error
      },
    })
    assert.throws(() => ensureStapled(dmg, { run: state.run, notarize: true, env, retryOptions }))
    assert.equal(state.calls.length, 1)
  }
})

test('a transport failure after stapling revalidates rather than stapling again', () => {
  const state = fixture({
    staple(setTicket) {
      setTicket(true)
      throw failure('HTTP 503 Service Unavailable', 1)
    },
  })
  ensureStapled(app, { run: state.run, retryOptions })
  assert.deepEqual(
    state.calls.map(call => call[2]),
    ['validate', 'staple', 'validate']
  )
})

test('retrying DMG notarization does not sign the file again', () => {
  let submissions = 0
  const state = fixture({
    submit() {
      if (++submissions === 1) throw failure('HTTP 503 Service Unavailable', 1)
      return JSON.stringify({ status: 'Accepted' })
    },
  })
  ensureStapled(dmg, { run: state.run, notarize: true, env, retryOptions })
  assert.equal(state.calls.filter(call => call[0] === 'codesign').length, 1)
  assert.equal(submissions, 2)
  assert.equal(state.calls.filter(call => call[2] === 'staple').length, 1)
})

test('a completed notarization is not resubmitted after a stapling transport failure', () => {
  let staples = 0
  const state = fixture({
    staple() {
      if (++staples === 1) throw failure('HTTP 503 Service Unavailable', 1)
    },
  })
  ensureStapled(dmg, { run: state.run, notarize: true, env, retryOptions })
  assert.equal(state.calls.filter(call => call[1] === 'notarytool').length, 1)
  assert.equal(state.calls.filter(call => call[0] === 'codesign').length, 1)
  assert.equal(staples, 2)
})

test('rejected or malformed notarization cannot reach stapling', () => {
  for (const response of [JSON.stringify({ status: 'Invalid' }), '{}', 'not json']) {
    const state = fixture({
      submit() {
        return response
      },
    })
    assert.throws(
      () => ensureStapled(dmg, { run: state.run, notarize: true, env, retryOptions }),
      /notarization/
    )
    assert(!state.calls.some(call => call[2] === 'staple'))
  }
})

test('stapling success cannot hide a failed final validation', () => {
  let validations = 0
  const state = fixture({
    validate() {
      if (++validations === 1) throw missing(app)
      throw failure('Ticket signature is invalid')
    },
  })
  assert.throws(() => ensureStapled(app, { run: state.run, retryOptions }))
  assert.deepEqual(
    state.calls.map(call => call[2]),
    ['validate', 'staple', 'validate']
  )
})

test('packaging uses the helper and retains signature, entitlement and Gatekeeper checks', () => {
  const workflow = readFileSync(
    new URL('../../../../.github/workflows/release-prepare.yml', import.meta.url),
    'utf8'
  )
  assert(workflow.includes('staple.mjs "$bundle/macos/ClipsX.app"'))
  assert(workflow.includes('staple.mjs "$dmg" --notarize-dmg'))
  assert(workflow.includes('codesign --verify --deep --strict'))
  assert(workflow.includes('codesign --verify --strict "$dmg"'))
  assert(workflow.includes('spctl --assess --verbose=4 --type execute'))
  assert(workflow.includes('spctl --assess --verbose=4 --type open'))
  assert(workflow.includes('com.apple.security.cs.allow-unsigned-executable-memory'))
  assert(
    workflow.indexOf('staple.mjs "$bundle/macos/ClipsX.app"') <
      workflow.indexOf('spctl --assess --verbose=4 --type execute')
  )
})
