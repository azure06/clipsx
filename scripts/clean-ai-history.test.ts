import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanAiHistory, cleanupLocations } from './clean-ai-history.mjs'

const temporaryHomes: string[] = []

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), 'clipsx-clean-history-'))
  temporaryHomes.push(home)
  return home
}

async function put(path: string, value = 'data') {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.each(['darwin', 'win32'] as const)('AI history cleaner on %s', platform => {
  it('removes chat history while preserving configuration', async () => {
    const home = await fakeHome()
    const env = platform === 'win32' ? { ...process.env, APPDATA: '' } : process.env
    const paths = cleanupLocations({ home, platform, env })

    await put(join(paths.claude, 'history.jsonl'))
    await put(join(paths.claude, 'sessions', 'session.json'))
    await put(join(paths.claude, 'settings.json'), 'keep claude')
    await put(join(paths.codex, 'state_5.sqlite'))
    await put(join(paths.codex, 'sessions', 'session.jsonl'))
    await put(join(paths.codex, 'config.toml'), 'keep codex')
    await put(join(paths.copilotGlobal, 'copilotCli', 'session.json'))
    await put(join(paths.copilotGlobal, 'api.json'), 'keep copilot')
    await put(join(paths.emptyWindowChat, 'session.json'))
    await put(join(paths.workspaceStorage, 'workspace-1', 'chatSessions', 'session.json'))
    await put(join(paths.workspaceStorage, 'workspace-1', 'workspace.json'), 'keep workspace')

    await cleanAiHistory({ home, platform, env })

    for (const removed of [
      join(paths.claude, 'history.jsonl'),
      join(paths.codex, 'state_5.sqlite'),
      join(paths.copilotGlobal, 'copilotCli', 'session.json'),
      join(paths.emptyWindowChat, 'session.json'),
      join(paths.workspaceStorage, 'workspace-1', 'chatSessions', 'session.json'),
    ]) {
      await expect(readFile(removed)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(readFile(join(paths.claude, 'settings.json'), 'utf8')).resolves.toBe('keep claude')
    await expect(readFile(join(paths.codex, 'config.toml'), 'utf8')).resolves.toBe('keep codex')
    await expect(readFile(join(paths.copilotGlobal, 'api.json'), 'utf8')).resolves.toBe('keep copilot')
    await expect(readFile(join(paths.workspaceStorage, 'workspace-1', 'workspace.json'), 'utf8')).resolves.toBe(
      'keep workspace'
    )
  })

  it('does not remove anything during a dry run', async () => {
    const home = await fakeHome()
    const env = platform === 'win32' ? { ...process.env, APPDATA: '' } : process.env
    const paths = cleanupLocations({ home, platform, env })
    const history = join(paths.codex, 'history.jsonl')
    await put(history, 'keep during dry run')

    await cleanAiHistory({ home, platform, env, dryRun: true })

    await expect(readFile(history, 'utf8')).resolves.toBe('keep during dry run')
  })
})
