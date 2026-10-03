import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, digest, encode } from './model.mjs'

const configuration = [
  'package-lock.json',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.production-build.conf.json',
  'rust-toolchain.toml',
]
const generated = ['src-tauri/tauri.auth.csp.conf.json', 'src-tauri/tauri.ci-build.conf.json']

function inventory(root) {
  const walk = path => {
    const stat = lstatSync(join(root, path))
    assert(!stat.isSymbolicLink(), `Frontend contains a symbolic link: ${path}`)
    return stat.isDirectory()
      ? readdirSync(join(root, path)).flatMap(name => walk(`${path}/${name}`))
      : [path]
  }
  return [...walk('dist'), ...generated].sort()
}

function hashes(root, paths) {
  return Object.fromEntries(paths.map(path => [path, digest(readFileSync(join(root, path)))]))
}

export function frontendIdentity(root, production, env = process.env) {
  const git = ref => execFileSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8' }).trim()
  return {
    schemaVersion: 1,
    sourceRevision: git('HEAD'),
    sourceTree: git('HEAD^{tree}'),
    runId: env.GITHUB_RUN_ID || 'local',
    runAttempt: env.BUILD_RUN_ATTEMPT || env.GITHUB_RUN_ATTEMPT || 'local',
    production,
    configuration: hashes(root, configuration),
  }
}

export function recordFrontend(root, identity) {
  const paths = inventory(root)
  const html = readFileSync(join(root, 'dist/index.html'), 'utf8')
  assert(
    paths.some(path => /^dist\/assets\/.+\.js$/.test(path)),
    'Frontend has no compiled application'
  )
  assert(
    /<script\b[^>]*\bsrc=/.test(html),
    'Frontend index has no application script; stubs cannot ship'
  )
  const overlay = JSON.parse(readFileSync(join(root, generated[1]), 'utf8'))
  assert(
    overlay.build?.beforeBuildCommand === null,
    'CI must consume the checked frontend without rebuilding'
  )
  return { ...identity, files: hashes(root, paths) }
}

export function verifyFrontend(root, manifest, identity) {
  for (const key of [
    'schemaVersion',
    'sourceRevision',
    'sourceTree',
    'runId',
    'runAttempt',
    'production',
  ])
    assert(manifest[key] === identity[key], `Frontend ${key} mismatch`)
  assert(
    encode(manifest.configuration) === encode(identity.configuration),
    'Frontend build configuration changed'
  )
  const actual = recordFrontend(root, identity)
  assert(
    encode(actual.files) === encode(manifest.files),
    'Frontend files are missing, extra or changed'
  )
  return manifest
}

export function checkFrontend(root, production, env = process.env) {
  const manifest = JSON.parse(readFileSync(join(root, '.release/frontend.json'), 'utf8'))
  return verifyFrontend(root, manifest, frontendIdentity(root, production, env))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  const production = process.env.RELEASE_MODE === 'true'
  if (process.argv[2] === 'record') {
    mkdirSync(join(root, '.release'), { recursive: true })
    writeFileSync(
      join(root, '.release/frontend.json'),
      encode(recordFrontend(root, frontendIdentity(root, production)))
    )
  } else if (process.argv[2] === 'verify') checkFrontend(root, production)
  else throw new Error('Use frontend.mjs record|verify')
}
