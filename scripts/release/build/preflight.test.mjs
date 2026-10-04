import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Evaluate the real command sequence with recording process/filesystem adapters.
// Production executables, frontend assets and credentials are never accessed.
function tracePreflight(phase, production) {
  const trace = []
  const code = readFileSync(new URL('preflight.mjs', import.meta.url), 'utf8').replace(
    /^import .*\r?\n/gm,
    ''
  )
  const env = {
    npm_execpath: '/npm-cli.js',
    RELEASE_MODE: String(production),
    NATIVE_TARGET: 'test-host',
  }
  runInNewContext(code, {
    process: {
      cwd: () => '/source',
      execPath: 'node',
      argv: ['node', 'preflight', phase],
      env,
      exit: () => {
        throw new Error('Unexpected exit')
      },
    },
    console: { log: () => {} },
    spawnSync: (program, args) => {
      trace.push({ program, args })
      return { status: 0 }
    },
    execFileSync: () => 'host: test-host',
    mkdirSync: () => {},
    writeFileSync: () => {},
    checkFrontend: () => {},
    frontendIdentity: () => ({}),
    recordFrontend: () => ({}),
    encode: JSON.stringify,
  })
  return trace
}
test('application preflight owns each frontend/helper/native command exactly once', () => {
  for (const production of [false, true]) {
    const trace = tracePreflight('all', production)
    const commands = trace.map(item => `${item.program} ${item.args.join(' ')}`)
    assert.equal(commands.filter(command => command.includes('/npm-cli.js ci')).length, 1)
    assert.equal(
      commands.filter(command => command.includes('/npm-cli.js test -- --run')).length,
      1
    )
    assert.equal(
      commands.filter(command =>
        command.includes(`/npm-cli.js run ${production ? 'build:production' : 'build'}`)
      ).length,
      1
    )
    assert.equal(
      commands.filter(command => command.includes('release.test.mjs')).length,
      production ? 1 : 0
    )
    assert.equal(commands.filter(command => command.includes('frontend-env.test.mjs')).length, 1)
    assert.equal(
      commands.filter(
        command => command.includes('cargo test') && command.includes('--bin clipsx ')
      ).length,
      1
    )
  }
  const native = tracePreflight('native', true)
  assert.equal(native.length, 1)
  assert(!native.some(item => item.program === 'node'))
})
