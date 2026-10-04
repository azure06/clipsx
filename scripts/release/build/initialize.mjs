import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkFrontend } from './frontend.mjs'
import { appInputs, inputsDigest, publicEnvironment } from '../core/inputs.mjs'
import {
  assert,
  assertIdentity,
  digest,
  encode,
  readJson,
  repository,
  validateVersion,
} from '../core/contracts.mjs'
import { directory, output, git } from '../core/context.mjs'

export function initialize() {
  const config = readJson('src-tauri/tauri.conf.json')
  assert(
    !config.plugins.updater.dangerousInsecureTransportProtocol,
    'Production updater cannot use insecure transport'
  )
  assert(
    config.plugins.updater.endpoints.length === 1 &&
      config.plugins.updater.endpoints[0] ===
        `https://github.com/${repository}/releases/latest/download/latest.json`,
    'Stable updater endpoint must be retained'
  )
  const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(
    /^version\s*=\s*"([^"]+)"/m
  )?.[1]
  const branch = process.env.GITHUB_REF_NAME
  const version = validateVersion(
    branch,
    readJson('package.json').version,
    cargoVersion,
    config.version
  )
  assert(
    existsSync(`docs/releases/${version}.md`),
    `Add docs/releases/${version}.md before preparing this release`
  )
  const runId = process.env.GITHUB_RUN_ID
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT
  const id = `${version}-${runId}-${runAttempt}`
  const candidate = {
    schemaVersion: 2,
    id,
    version,
    branch,
    runId,
    runAttempt,
    sourceRevision: git(['rev-parse', 'HEAD']),
    sourceTree: git(['rev-parse', 'HEAD^{tree}']),
    stagingTag: `candidate-${id}`,
    createdAt: new Date().toISOString(),
    build: {
      origin: { runId, attempt: runAttempt, sourceRevision: git(['rev-parse', 'HEAD']), branch },
      appInputs: appInputs(),
      appInputsSha256: inputsDigest(appInputs()),
      publicEnvironment: publicEnvironment(),
      recipeRevision: process.env.RELEASE_RECIPE_REVISION || git(['rev-parse', 'HEAD']),
      production: true,
      configuration: Object.fromEntries(
        [
          'src-tauri/tauri.conf.json',
          'src-tauri/tauri.production-build.conf.json',
          'package-lock.json',
          'src-tauri/Cargo.lock',
        ].map(file => [file, digest(readFileSync(file))])
      ),
      updaterPublicKey: config.plugins.updater.pubkey,
      windowsInstaller: 'nsis',
      macArchitectures: ['arm64', 'x64'],
      linuxPackages: ['appimage', 'deb'],
    },
    artifacts: [],
    evidence: [],
  }
  assertIdentity(candidate)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
  output('candidate-id', id)
  output('version', version)
}

export function checkedFrontend() {
  const candidate = readJson(join(directory, 'candidate.json'))
  return checkFrontend(process.cwd(), true, {
    GITHUB_RUN_ID: candidate.build.origin.runId,
    BUILD_RUN_ATTEMPT: candidate.build.origin.attempt,
  })
}
