import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, assertBuildRun, digest, encode, readJson } from '../core/contracts.mjs'
import { command, repoApi, workflowArtifacts, downloadArtifact } from '../core/github.mjs'
import { appInputs, inputsDigest } from '../core/inputs.mjs'

export const platforms = {
  'macos-arm64': { target: 'aarch64-apple-darwin', os: 'macos-15', bundles: 'app,dmg' },
  'macos-x64': { target: 'x86_64-apple-darwin', os: 'macos-15-intel', bundles: 'app,dmg' },
  'linux-x64': { target: 'x86_64-unknown-linux-gnu', os: 'ubuntu-24.04', bundles: 'appimage,deb' },
  'windows-x64': { target: 'x86_64-pc-windows-msvc', os: 'windows-latest', bundles: 'nsis' },
}
export function preparationTargets(candidate, target = 'missing') {
  assert(
    ['missing', 'all', ...Object.keys(platforms)].includes(target),
    'Unknown preparation target'
  )
  return Object.entries(platforms)
    .filter(
      ([platform]) =>
        target === 'all' ||
        target === platform ||
        (target === 'missing' &&
          !candidate.preparation?.[platform] &&
          !(platform === 'windows-x64' && candidate.windowsKit))
    )
    .map(([platform, settings]) => ({ platform, ...settings }))
}
export const platformMatrix = () => ({
  include: Object.entries(platforms).map(([platform, settings]) => ({ platform, ...settings })),
})

export const artifactRecord = item => ({ id: item.id, name: item.name, digest: item.digest })
export function assertArtifact(actual, selected) {
  assert(
    actual &&
      !actual.expired &&
      actual.id === selected.id &&
      actual.name === selected.name &&
      actual.digest === selected.digest,
    'Selected build artifact missing, expired or changed'
  )
}
export function verifyExecutable(bytes, checkpoint, candidate, platform, frontendBytes) {
  assert(platforms[platform], 'Unknown build platform')
  assert(
    checkpoint.platform === platform && checkpoint.target === platforms[platform].target,
    'Executable platform mismatch'
  )
  const origin = candidate.build.origin
  assert(
    checkpoint.candidateId === `${candidate.version}-${origin.runId}-${origin.attempt}` &&
      checkpoint.frontendSha256 === digest(frontendBytes),
    'Mixed build executable/frontend'
  )
  assert(checkpoint.sha256 === digest(bytes), 'Compiled executable changed')
}
export function verifyAuxiliary(checkpoint) {
  assert(
    checkpoint.runtimeFixtureSha256 === digest(readFileSync('.release/runtime-fixture.wasm')),
    'Runtime fixture changed'
  )
  if (checkpoint.platform.startsWith('macos-'))
    assert(
      checkpoint.debugSymbolsSha256 === digest(readFileSync('.release/debug-symbols.tar.gz')),
      'Mac debug symbols changed'
    )
}
export function validateBuildDescriptor(candidate, run, artifacts) {
  assertBuildRun(run, candidate.build.origin)
  assert(
    inputsDigest(candidate.build.appInputs) === candidate.build.appInputsSha256,
    'Build app inventory changed'
  )
  assert(
    candidate.build.frontendArtifact?.name === `frontend-${candidate.build.origin.attempt}`,
    'Wrong build frontend artifact'
  )
  assertArtifact(
    artifacts.find(item => item.id === candidate.build.frontendArtifact.id),
    candidate.build.frontendArtifact
  )
  for (const [platform, saved] of Object.entries(candidate.build.platforms)) {
    assert(
      platforms[platform] &&
        saved.artifact?.name === `compiled-${platform}-${candidate.build.origin.attempt}`,
      'Mixed build platform inventory'
    )
    assertArtifact(
      artifacts.find(item => item.id === saved.artifact.id),
      saved.artifact
    )
  }
  assert(
    Object.keys(platforms).every(platform => candidate.build.platforms[platform]?.sha256),
    'Incomplete compiled platform inventory'
  )
}
export function loadBuild(runId, directory, existing) {
  assert(/^\d+$/.test(String(runId)), 'Invalid build run ID')
  const artifacts = workflowArtifacts(runId)
  if (existing) {
    validateBuildDescriptor(
      existing,
      repoApi(`actions/runs/${runId}/attempts/${existing.build.origin.attempt}`),
      artifacts
    )
    return existing
  }
  const ready = artifacts
    .filter(item => /^build-ready-\d+$/.test(item.name))
    .sort((a, b) => b.id - a.id)[0]
  assert(ready && !ready.expired, 'Selected build is not ready or its artifacts expired')
  downloadArtifact(ready, directory)
  const candidate = readJson(join(directory, 'candidate.json'))
  validateBuildDescriptor(
    candidate,
    repoApi(`actions/runs/${runId}/attempts/${candidate.build.origin.attempt}`),
    artifacts
  )
  assert(
    String(candidate.build.origin.runId) === String(runId),
    'Build descriptor belongs to another run'
  )
  return candidate
}
export function restorePlatform(candidate, platform, directory) {
  const origin = candidate.build.origin
  const artifacts = workflowArtifacts(origin.runId)
  const selected = candidate.build.platforms[platform]?.artifact
  assert(selected, 'Platform is missing from selected build')
  const actual = artifacts.find(item => item.id === selected.id)
  assertArtifact(actual, selected)
  downloadArtifact(actual, directory)
  command('tar', ['-xzf', resolve(directory, 'compiled.tar.gz')])
  const binary = `src-tauri/target/${platforms[platform].target}/release/clipsx${platform === 'windows-x64' ? '.exe' : ''}`
  verifyExecutable(
    readFileSync(binary),
    readJson('.release/compiled.json'),
    candidate,
    platform,
    readFileSync('.release/frontend.json')
  )
  const checkpoint = readJson('.release/compiled.json')
  const saved = candidate.build.platforms[platform]
  assert(
    checkpoint.runtimeFixtureSha256 === saved.runtimeFixtureSha256 &&
      checkpoint.debugSymbolsSha256 === saved.debugSymbolsSha256,
    'Mixed build auxiliary inventory'
  )
  verifyAuxiliary(checkpoint, candidate)
  assert(
    digest(readFileSync(binary)) === candidate.build.platforms[platform].sha256,
    'Build executable hash mismatch'
  )
  return binary
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2]
  if (operation === 'matrix') {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(platformMatrix())}\n`)
    process.exit(0)
  }
  const candidate = readJson('.release/candidate.json')
  const origin = candidate.build.origin
  if (operation === 'record') {
    const platform = process.env.PLATFORM,
      target = platforms[platform].target
    const binary = `src-tauri/target/${target}/release/clipsx${platform === 'windows-x64' ? '.exe' : ''}`
    writeFileSync(
      '.release/compiled.json',
      encode({
        candidateId: `${candidate.version}-${origin.runId}-${origin.attempt}`,
        platform,
        target,
        frontendSha256: digest(readFileSync('.release/frontend.json')),
        sha256: digest(readFileSync(binary)),
        checksExecutionAttempt: process.env.GITHUB_RUN_ATTEMPT,
        compiler: command('rustc', ['-vV']).trim(),
        runtimeFixtureSha256: digest(readFileSync('.release/runtime-fixture.wasm')),
        debugSymbolsSha256: existsSync('.release/debug-symbols.tar.gz')
          ? digest(readFileSync('.release/debug-symbols.tar.gz'))
          : null,
        debugProfile: process.env.PLATFORM.startsWith('macos-')
          ? { debug: 'line-tables-only', splitDebuginfo: 'packed' }
          : null,
      })
    )
  } else if (operation === 'ready') {
    const artifacts = workflowArtifacts(origin.runId)
    const frontend = artifacts.find(item => item.name === `frontend-${origin.attempt}`)
    assert(frontend && !frontend.expired, 'Frontend artifact missing')
    candidate.build.frontendArtifact = artifactRecord(frontend)
    candidate.build.platforms = {}
    for (const platform of Object.keys(platforms)) {
      const artifact = artifacts.find(
        item => item.name === `compiled-${platform}-${origin.attempt}`
      )
      assert(artifact && !artifact.expired, `Missing executable: ${platform}`)
      const path = `.release/builds/${platform}`
      downloadArtifact(artifact, path)
      command('tar', ['-xzf', resolve(path, 'compiled.tar.gz')])
      const checkpoint = readJson('.release/compiled.json')
      const binary = `src-tauri/target/${platforms[platform].target}/release/clipsx${platform === 'windows-x64' ? '.exe' : ''}`
      verifyExecutable(
        readFileSync(binary),
        checkpoint,
        candidate,
        platform,
        readFileSync('.release/frontend.json')
      )
      verifyAuxiliary(checkpoint, candidate)
      candidate.build.platforms[platform] = { ...checkpoint, artifact: artifactRecord(artifact) }
    }
    candidate.build.appInputs = appInputs(candidate.sourceRevision)
    candidate.build.appInputsSha256 = inputsDigest(candidate.build.appInputs)
    writeFileSync('.release/candidate.json', encode(candidate))
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## ClipsX ${candidate.version} — Build ${origin.runId}\nSource: ${candidate.sourceRevision}\n\nAll four platforms passed. **Ready for packaging.**\n\nPrepare release with build_run_id=${origin.runId}.\n`
      )
  } else throw new Error('Use builds.mjs record|ready')
}
