import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, digest, encode } from './model.mjs'
import { loadBuild, platforms, restorePlatform, assertArtifact } from './builds.mjs'
import { command, repoApi, workflowArtifacts, downloadArtifact } from './github.mjs'

export function assertRecovery(run, build, platform, evidence, archiveHash) {
  const cacheKeys = {
    'macos-arm64': 'release-macos-arm64-Darwin-arm64-ff44c5d7-be351c3c',
    'macos-x64': 'release-macos-x64-Darwin-x64-b02e1cc6-be351c3c',
  }
  assert(
    String(build.build.origin.runId) === '37122124538' &&
      build.sourceRevision === '2c4573d8b02e91e18f1ef97a0df48cc3b0af7730' &&
      run.conclusion === 'success' &&
      run.head_repository?.full_name === 'azure06/clipsx' &&
      run.head_branch === 'release/0.1.1' &&
      run.path === '.github/workflows/recover-0.1.1-symbols.yml' &&
      evidence.buildRunId === '37122124538' &&
      evidence.platform === platform &&
      evidence.cacheKey === cacheKeys[platform] &&
      evidence.executableSha256 === build.build.platforms[platform]?.sha256 &&
      evidence.archiveSha256 === archiveHash,
    'Symbol recovery does not belong to the original 0.1.1 build'
  )
}

function restore(runId, platform, recoveryRunId) {
  assert(platform.startsWith('macos-') && platforms[platform], 'Select a Mac platform')
  const build = loadBuild(runId, '.release')
  const artifacts = workflowArtifacts(runId)
  const frontend = artifacts.find(item => item.id === build.build.frontendArtifact.id)
  assertArtifact(frontend, build.build.frontendArtifact)
  downloadArtifact(frontend, '.release')
  const binary = restorePlatform(build, platform, `.release/builds/${platform}`)
  let archive = '.release/debug-symbols.tar.gz'
  let recovery = null
  if (recoveryRunId) {
    assert(/^\d+$/.test(recoveryRunId), 'Invalid recovery run ID')
    const run = repoApi(`actions/runs/${recoveryRunId}`)
    const artifact = workflowArtifacts(recoveryRunId).find(
      item => item.name === `recovered-symbols-${platform}`
    )
    downloadArtifact(artifact, '.release/recovered')
    archive = '.release/recovered/debug-symbols.tar.gz'
    const evidence = JSON.parse(readFileSync('.release/recovered/recovery.json', 'utf8'))
    assertRecovery(run, build, platform, evidence, digest(readFileSync(archive)))
    recovery = { runId: recoveryRunId, artifactId: artifact.id, digest: artifact.digest, evidence }
  }
  mkdirSync('.release/symbols', { recursive: true })
  command('tar', ['-xzf', archive, '-C', '.release/symbols'])
  const uuid = path => command('dwarfdump', ['--uuid', path]).trim().split(/\s+/)[1]
  const binaryUuid = uuid(binary)
  assert(
    /^[A-Fa-f0-9-]{36}$/.test(binaryUuid) && binaryUuid === uuid('.release/symbols/clipsx.dSYM'),
    'Debug symbol UUID does not match the saved executable'
  )
  writeFileSync(
    '.release/symbol-evidence.json',
    encode({
      buildRunId: String(runId),
      platform,
      binaryUuid,
      executableSha256: build.build.platforms[platform].sha256,
      archiveSha256: digest(readFileSync(archive)),
      recovery,
    })
  )
  console.log(`Debug symbols verified: build=${runId} platform=${platform} uuid=${binaryUuid}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  restore(...process.argv.slice(2))
