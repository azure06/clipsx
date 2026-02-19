import { SquareArrowOutUpRight } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { SmartAction } from '../../types'

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
  shortcut: '⌘Shift+O', // Or another shortcut, check conflicts
  check: content => {
    // Available for almost all text-based content
    // Exclude image/files if they are handled differently, but text preview of them (e.g. base64) might be valid?
    // For now, allow all, but maybe prioritize text-based.
    // Actually, files type usually is a list of paths. If it's a list of paths, we might want to open them differently.
    // But for 'text', 'code', 'json', 'sql' etc., this is perfect.
    return content.type !== 'image' && content.type !== 'files'
  },
  execute: async content => {
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

    try {
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
