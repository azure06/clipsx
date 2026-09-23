#!/usr/bin/env node

import { lstat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function vscodeUserRoot(home, platform, env) {
  if (platform === 'win32') {
    return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Code', 'User')
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Code', 'User')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Code', 'User')
}

export function cleanupLocations({ home = homedir(), platform = process.platform, env = process.env } = {}) {
  const safeHome = resolve(home)
  if (safeHome === parse(safeHome).root) throw new Error('Refusing to use a filesystem root as home.')

  const codeUser = vscodeUserRoot(safeHome, platform, env)
  return {
    claude: join(safeHome, '.claude'),
    codex: join(safeHome, '.codex'),
    copilotGlobal: join(codeUser, 'globalStorage', 'github.copilot-chat'),
    emptyWindowChat: join(codeUser, 'globalStorage', 'emptyWindowChatSessions'),
    workspaceStorage: join(codeUser, 'workspaceStorage'),
  }
}

async function removePath(path, options) {
  if (!(await exists(path))) return
  if (options.verbose || options.dryRun) console.log(`  remove: ${path}`)
  if (!options.dryRun) {
    try {
      await rm(path, { recursive: true, force: true })
    } catch (error) {
      options.failures.push({ path, error })
      console.warn(`  unable to remove: ${path} (${error.code || error.message})`)
    }
  }
}

async function removeChildren(path, options) {
  if (!(await exists(path))) return
  for (const entry of await readdir(path)) await removePath(join(path, entry), options)
}

function section(name) {
  console.log(`\n--- ${name} ---`)
}

export async function cleanAiHistory({
  home = homedir(),
  platform = process.platform,
  env = process.env,
  dryRun = false,
  verbose = false,
} = {}) {
  const locations = cleanupLocations({ home, platform, env })
  const options = { dryRun, verbose, failures: [] }

  section('Claude')
  if (await exists(locations.claude)) {
    await removePath(join(locations.claude, 'history.jsonl'), options)
    for (const name of [
      'sessions',
      'file-history',
      'cache',
      'session-env',
      'shell-snapshots',
      'backups',
      'plans',
      'projects',
    ]) {
      await removeChildren(join(locations.claude, name), options)
    }
    console.log('  preserved: plugins/ skills/ settings.json ide/')
  } else console.log('  ~/.claude not found, skipping')

  section('Codex')
  if (await exists(locations.codex)) {
    for (const name of ['history.jsonl', 'session_index.jsonl']) {
      await removePath(join(locations.codex, name), options)
    }
    for (const name of ['sessions', 'shell_snapshots', '.tmp']) {
      await removeChildren(join(locations.codex, name), options)
    }
    for (const database of ['logs_2.sqlite', 'state_5.sqlite']) {
      for (const suffix of ['', '-shm', '-wal']) {
        await removePath(join(locations.codex, `${database}${suffix}`), options)
      }
    }
    console.log('  preserved: config.toml installation_id version.json memories/ rules/ skills/ vendor_imports/')
  } else console.log('  ~/.codex not found, skipping')

  section('VS Code Copilot - global storage')
  if (await exists(locations.copilotGlobal)) {
    await removePath(join(locations.copilotGlobal, 'logContextRecordings', 'state.json'), options)
    await removePath(join(locations.copilotGlobal, 'copilot.cli.oldGlobalSessions.json'), options)
    await removeChildren(join(locations.copilotGlobal, 'copilotCli'), options)
    await removeChildren(join(locations.copilotGlobal, 'copilot-cli-images'), options)
    console.log('  preserved: api.json *Embeddings.json *.bin ask-agent/ explore-agent/ plan-agent/ debugCommand/')
  } else console.log('  Copilot global storage not found, skipping')
  await removeChildren(locations.emptyWindowChat, options)

  section('VS Code Copilot - workspace storage (all workspaces)')
  if (await exists(locations.workspaceStorage)) {
    for (const workspace of await readdir(locations.workspaceStorage, { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue
      const root = join(locations.workspaceStorage, workspace.name)
      for (const relativePath of [
        'chatSessions',
        'chatEditingSessions',
        join('GitHub.copilot-chat', 'transcripts'),
        join('GitHub.copilot-chat', 'debug-logs'),
      ]) {
        await removeChildren(join(root, relativePath), options)
      }
    }
    console.log('  preserved: workspace.json state.vscdb* ms-python.* GitHub.copilot-chat/(non-log dirs)')
  } else console.log('  VS Code workspaceStorage not found, skipping')

  console.log(dryRun ? '\nDry run complete - nothing was deleted.' : '\nDone. History/logs cleared.')
  if (options.failures.length > 0) {
    throw new Error(`${options.failures.length} item(s) could not be removed, usually because an app has them open.`)
  }
}

function parseArguments(args) {
  const options = { dryRun: false, verbose: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--verbose') options.verbose = true
    else if (argument === '--home') {
      if (!args[index + 1]) throw new Error('--home requires a directory.')
      options.home = args[index + 1]
      index += 1
    } else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

function printHelp() {
  console.log('Usage: clean-ai-history [--dry-run] [--verbose] [--home <directory>]')
  console.log('  --dry-run          Show what would be deleted without deleting')
  console.log('  --verbose          Print each item as it is removed')
  console.log('  --home <directory> Override the home directory (useful for testing)')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) printHelp()
    else {
      if (options.home) options.env = { ...process.env, APPDATA: '', XDG_CONFIG_HOME: '' }
      await cleanAiHistory(options)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
