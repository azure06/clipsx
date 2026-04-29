import { SquareArrowOutUpRight } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { SmartAction } from '../../types'
import type { ShortcutDef } from '../../../../shared/keyboard/shortcuts'

const OPEN_IN_EDITOR_SHORTCUT: ShortcutDef = {
  modifiers: ['primary', 'shift'],
  key: 'O',
}

const LANGUAGE_TO_EXTENSION: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  rust: 'rs',
  html: 'html',
  css: 'css',
  json: 'json',
  markdown: 'md',
  sql: 'sql',
  xml: 'xml',
  yaml: 'yaml',
  bash: 'sh',
  shell: 'sh',
  bat: 'bat',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  go: 'go',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  dart: 'dart',
  r: 'r',
  lua: 'lua',
}

export const useOpenInDefaultEditorAction = (): SmartAction => ({
  id: 'open-default-editor',
  label: 'Open in Editor',
  icon: <SquareArrowOutUpRight size={16} />,
  category: 'utility',
  placement: 'global_bar' as const,
  shortcut: OPEN_IN_EDITOR_SHORTCUT,
  check: content =>
    content.type === 'text' ||
    content.type === 'code' ||
    content.type === 'json' ||
    content.type === 'csv' ||
    content.type === 'office',
  execute: async content => {
    try {
      // If it's an image, we should have a local path already saved
      if (content.type === 'image' && content.clip.imagePath) {
        await invoke('open_path', { path: content.clip.imagePath })
        return
      }

      let extension = 'txt'

      if (content.type === 'code' && content.metadata.language) {
        const lang = content.metadata.language.toLowerCase()
        extension = LANGUAGE_TO_EXTENSION[lang] || lang
      } else if (content.type === 'json') {
        extension = 'json'
      } else if (content.type === 'csv') {
        extension = 'csv'
      } else if (content.metadata.language) {
        // Fallback for text/other types if they have language metadata (e.g. html, markdown)
        const lang = content.metadata.language.toLowerCase()
        extension = LANGUAGE_TO_EXTENSION[lang] || 'txt'
      }

      await invoke('open_text_in_editor', {
        text: content.text,
        extension,
      })
    } catch (error) {
      console.error('Failed to open in default editor:', error)
      // Ideally show a toast here
    }
  },
})
