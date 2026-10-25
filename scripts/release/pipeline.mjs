import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { directory, output } from './core/context.mjs'
import { fresh } from './core/candidate.mjs'
import { clearAssetCache } from './core/github.mjs'
import { assert } from './core/contracts.mjs'

const commands = {
  initialize: ['./build/initialize.mjs', 'initialize', 0, 0],
  collect: ['./candidate/prepare.mjs', 'collect', 2, 2],
  'windows-kit': ['./platforms/windows/operations.mjs', 'windowsKit', 0, 0],
  'package-source': ['./candidate/prepare.mjs', 'packageSource', 1, 1],
  'stage-prepared': ['./candidate/prepare.mjs', 'stagePrepared', 1, 2],
  prepare: ['./candidate/prepare.mjs', 'prepare', 1, 5],
  restore: ['./candidate/prepare.mjs', 'restore', 2, 2],
  'prepare-windows': ['./platforms/windows/operations.mjs', 'prepareWindows', 1, 1],
  'submit-windows': ['./platforms/windows/operations.mjs', 'submitWindows', 3, 3],
  'download-windows': ['./platforms/windows/operations.mjs', 'downloadWindows', 1, 1],
  finalize: ['./candidate/finalize.mjs', 'finalize', 1, 2],
  'verify-for-merge': ['./candidate/signoff.mjs', 'verifyForMerge', 3, 3],
  controls: ['./candidate/controls.mjs', 'controls', 0, 2],
  'configure-approval': ['./setup/approval.mjs', 'configureApproval', 1, 1],
  'prepare-version': ['./setup/version.mjs', 'prepareVersion', 1, 1],
  readiness: ['./candidate/approval.mjs', 'readiness', 0, 0],
  publish: ['./publication/publish.mjs', 'publish', 0, 0],
  'verify-published': ['./publication/publish.mjs', 'verifyPublishedCommand', 1, 1],
  'configure-public': ['./setup/public.mjs', 'configurePublic', 0, 0],
  'upgrade-feed': ['./testing/upgrade-feed.mjs', 'upgradeFeed', 1, 2],
}

export async function main([operation, ...parameters]) {
  clearAssetCache()
  if (operation === 'finalization-state') {
    if (parameters.length !== 1) throw new Error('finalization-state requires a candidate ID')
    mkdirSync(directory, { recursive: true })
    const { candidate, release } = fresh(parameters[0])
    if (!candidate.finalizedAt) {
      const { finalizationReady } = await import('./candidate/controls.mjs')
      assert(
        finalizationReady(candidate, release),
        'Waiting for all platform packages, native evidence and the Windows submission; use the PR dashboard to retry missing stages'
      )
    }
    output('finalized', String(Boolean(candidate.finalizedAt)))
    return
  }
  const entry = commands[operation]
  if (!entry) throw new Error(`Unknown release operation: ${operation}`)
  const [module, name, minimum, maximum] = entry
  if (parameters.length < minimum || parameters.length > maximum)
    throw new Error(`Invalid arguments for ${operation}`)
  mkdirSync(directory, { recursive: true })
  return (await import(module))[name](...parameters)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
