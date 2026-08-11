import { Copy, Globe, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { SmartAction } from '../../types'
import { useClipboardStore } from '../../../../stores/clipboardStore'
import type { ShortcutDef } from '../../../../shared/keyboard/shortcuts'

const OPEN_URL_SHORTCUT: ShortcutDef = {
  modifiers: ['primary'],
  key: 'O',
}

export const useOpenURLAction = (): SmartAction => ({
  id: 'open-url',
  label: 'Open Link',
  icon: <Globe size={16} />,
  category: 'external',
  placement: 'hidden',
  shortcut: OPEN_URL_SHORTCUT,
  check: content => content.type === 'url',
  execute: content => {
    const url = content.metadata.url || content.text
    void invoke('open_external_url', { url })
  },
})

export const useSearchURLAction = (): SmartAction => ({
  id: 'search-url',
  label: 'Search Domain',
  icon: <Search size={16} />,
  category: 'external',
  placement: 'preview_menu',
  check: content => content.type === 'url' && Boolean(content.metadata.domain),
  execute: content => {
    const domain = content.metadata.domain
    void invoke('open_external_url', {
      url: `https://www.google.com/search?q=${encodeURIComponent(domain || '')}`,
    })
  },
})

export const useCopyDomainAction = (): SmartAction => ({
  id: 'copy-domain',
  label: 'Copy Domain',
  icon: <Copy size={16} />,
  category: 'utility',
  placement: 'preview_inline',
  check: content => content.type === 'url' && Boolean(content.metadata.domain),
  execute: async content => {
    await useClipboardStore.getState().copyDerivedText(content.metadata.domain || '')
  },
})
