import i18n from '../../i18n/index'
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
  {
    id: 'core.focus_search',
    get label() {
      return i18n.t('desktopUi.focusSearch')
    },
    shortcut: 'Primary+K',
  },
  {
    id: 'core.recall',
    get label() {
      return i18n.t('desktopUi.askRecall')
    },
    shortcut: 'Primary+Enter',
  },
  {
    id: 'core.copy',
    get label() {
      return i18n.t('desktopUi.copySelectedClip')
    },
    shortcut: 'Primary+C',
  },
  {
    id: 'core.copy_plain_text',
    get label() {
      return i18n.t('desktopUi.copyPlainText')
    },
    shortcut: 'Primary+Shift+C',
  },
  {
    id: 'core.share',
    get label() {
      return i18n.t('desktopUi.share')
    },
    shortcut: 'Primary+Shift+S',
  },
  {
    id: 'core.favorite',
    get label() {
      return i18n.t('desktopUi.toggleFavorite')
    },
    shortcut: 'Primary+F',
  },
  {
    id: 'core.pin',
    get label() {
      return i18n.t('desktopUi.togglePin')
    },
    shortcut: 'Primary+P',
  },
  {
    id: 'core.open',
    get label() {
      return i18n.t('desktopUi.openInEditorea1d')
    },
    shortcut: 'Primary+Shift+O',
  },
  {
    id: 'core.delete',
    get label() {
      return i18n.t('desktopUi.deleteSelectedClip')
    },
    shortcut: '',
  },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `core.quick_slot_${index + 1}`,
    label: `Quick slot ${index + 1}`,
    shortcut: `Primary+${index + 1}`,
  })),
]
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
