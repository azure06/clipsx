import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, digest, encode } from '../core/contracts.mjs'
import { loadBuild, platforms, restorePlatform, assertArtifact } from '../build/builds.mjs'
import { command, workflowArtifacts, downloadArtifact } from '../core/github.mjs'

export function restoreSymbols(runId, platform) {
  assert(platform.startsWith('macos-') && platforms[platform], 'Select a Mac platform')
  const build = loadBuild(runId, '.release')
  const artifacts = workflowArtifacts(runId)
  const frontend = artifacts.find(item => item.id === build.build.frontendArtifact.id)
  assertArtifact(frontend, build.build.frontendArtifact)
  downloadArtifact(frontend, '.release')
  const binary = restorePlatform(build, platform, `.release/builds/${platform}`)
  const archive = '.release/debug-symbols.tar.gz'
  mkdirSync('.release/symbols', { recursive: true })
  command('tar', ['-xzf', archive, '-C', '.release/symbols'])
  const binaryUuid = verifySymbolUuids(binary, '.release/symbols/clipsx.dSYM')
  writeFileSync(
    '.release/symbol-evidence.json',
    encode({
      buildRunId: String(runId),
      platform,
      binaryUuid,
      executableSha256: build.build.platforms[platform].sha256,
      archiveSha256: digest(readFileSync(archive)),
    })
  )
  console.log(`Debug symbols verified: build=${runId} platform=${platform} uuid=${binaryUuid}`)
}

export function verifySymbolUuids(binary, symbols) {
  const uuid = path => command('dwarfdump', ['--uuid', path]).trim().split(/\s+/)[1]
  const binaryUuid = uuid(binary)
  assert(
    /^[A-Fa-f0-9-]{36}$/.test(binaryUuid) && binaryUuid === uuid(symbols),
    'Debug symbol UUID does not match the saved executable'
  )
  return binaryUuid
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  restoreSymbols(...process.argv.slice(2))
