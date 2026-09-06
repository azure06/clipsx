import { invoke } from '@tauri-apps/api/core'
import {
  getDeleteShortcut,
  getPlatform,
  matchShortcut,
  parseAccelerator,
  type Platform,
  type ShortcutDef,
} from './shortcuts'

export const APP_COMMANDS = [
  { id: 'core.recall', label: 'Ask Recall', shortcut: 'Primary+Enter' },
  { id: 'core.copy', label: 'Copy selected clip', shortcut: 'Primary+C' },
  { id: 'core.favorite', label: 'Toggle favorite', shortcut: 'Primary+F' },
  { id: 'core.pin', label: 'Toggle pin', shortcut: 'Primary+P' },
  { id: 'core.open', label: 'Open in editor', shortcut: 'Primary+Shift+O' },
  { id: 'core.delete', label: 'Delete selected clip', shortcut: '' },
] as const
let bindings: Record<string, string> = {}
export async function loadCommandBindings() {
  bindings = await invoke<Record<string, string>>('get_command_shortcuts')
  return bindings
}
export function commandShortcut(
  id: string,
  fallback: ShortcutDef,
  platform: Platform = getPlatform()
) {
  const portable = bindings[id]
  if (!portable) return fallback
  return (
    parseAccelerator(
      portable.replaceAll('Primary+', platform === 'macos' ? 'Cmd+' : 'Ctrl+'),
      platform
    ) ?? fallback
  )
}
export function matchCommandShortcut(
  event: KeyboardEvent,
  id: string,
  fallback: ShortcutDef,
  platform: Platform = getPlatform()
) {
  return matchShortcut(event, commandShortcut(id, fallback, platform), platform)
}
export function defaultCommandShortcut(id: string): ShortcutDef {
  if (id === 'core.delete') return getDeleteShortcut()
  const command = APP_COMMANDS.find(command => command.id === id)
  return (
    parseAccelerator(
      (command?.shortcut ?? '').replaceAll('Primary+', getPlatform() === 'macos' ? 'Cmd+' : 'Ctrl+')
    ) ?? { modifiers: [], key: '' }
  )
}
