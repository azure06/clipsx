import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { checkFrontend, frontendIdentity, recordFrontend } from './frontend.mjs'
import { encode } from './model.mjs'

const root = process.cwd()
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this command with npm run release:preflight.')
const phase = process.argv[2] || 'all'
if (!['all', 'frontend', 'quality', 'native'].includes(phase))
  throw new Error('Unknown preflight phase')
const production = process.env.RELEASE_MODE !== 'false'

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const npmRun = (...args) => run(process.execPath, [npm, ...args])
const cargo = (...args) => run('cargo', [...args, '--manifest-path', 'src-tauri/Cargo.toml'])

if (phase === 'all' || phase === 'frontend') {
  // Fail cheap checks before starting any native compilation.
  for (const tool of ['audit', 'deny', 'cyclonedx']) run('cargo', [tool, '--version'])
  npmRun('ci')
  npmRun('audit', '--omit=dev')
  run('cargo', ['audit', '--file', 'src-tauri/Cargo.lock'])
  run(process.execPath, ['scripts/check-js-licenses.mjs'])
  run('cargo', [
    'deny',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    'check',
    'licenses',
    'bans',
    'sources',
  ])
  for (const task of ['lint', 'format:check']) npmRun('run', task)
  process.env.RELEASE_CHECK_APP_ENV = 'true'
  run(process.execPath, [
    '--test',
    `${process.env.RELEASE_TOOLS_ROOT || 'scripts/release'}/*.test.mjs`,
  ])
  npmRun('test', '--', '--run')
  npmRun('run', production ? 'prepare:tauri-auth-csp:production' : 'prepare:tauri-auth-csp')
  npmRun('run', production ? 'build:production' : 'build')
  writeFileSync(
    `${root}/src-tauri/tauri.ci-build.conf.json`,
    encode({ build: { beforeBuildCommand: null } })
  )
  mkdirSync(`${root}/.release/`, { recursive: true })
  writeFileSync(
    `${root}/.release/frontend.json`,
    encode(recordFrontend(root, frontendIdentity(root, production)))
  )
  cargo('cyclonedx', '--format', 'json')
}
// Shared dependency boundary: local checks and CI cannot compile missing/stale assets.
checkFrontend(root, production)
if (phase === 'all' || phase === 'quality') {
  run('cargo', ['fmt', '--all', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--check'])
  run('cargo', [
    'clippy',
    '--locked',
    '--all-targets',
    '--all-features',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--',
    '-D',
    'warnings',
  ])
  for (const binary of ['clipsx-extension-tool'])
    cargo('test', '--locked', '--all-features', '--bin', binary)
}
if (phase === 'all' || phase === 'native') {
  if (process.env.NATIVE_TARGET) {
    const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1]
    if (host !== process.env.NATIVE_TARGET)
      throw new Error('Native tests must run on the advertised architecture')
  }
  cargo('test', '--locked', '--all-features', '--bin', 'clipsx')
}
console.log(`\nRelease preflight ${phase} passed.`)
