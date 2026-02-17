import { ExternalLink, Globe, Search } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useOpenURLAction = (): SmartAction => ({
  id: 'open-url',
  label: 'Open Link',
  icon: <ExternalLink size={16} />,
  category: 'external',
  shortcut: '⌘O',
  check: (content) => content.type === 'url',
  execute: (content) => {
    const url = content.metadata.url || content.text
    window.open(url, '_blank', 'noopener,noreferrer')
  },
})

export const useSearchURLAction = (): SmartAction => ({
  id: 'search-url',
  label: 'Search Domain',
  icon: <Search size={16} />,
  category: 'external',
  check: (content) => content.type === 'url' && Boolean(content.metadata.domain),
  execute: (content) => {
    const domain = content.metadata.domain
    window.open(`https://www.google.com/search?q=${encodeURIComponent(domain || '')}`, '_blank')
  },
})

export const useCopyDomainAction = (): SmartAction => ({
  id: 'copy-domain',
  label: 'Copy Domain',
  icon: <Globe size={16} />,
  category: 'utility',
  check: (content) => content.type === 'url' && Boolean(content.metadata.domain),
  execute: async (content) => {
    await navigator.clipboard.writeText(content.metadata.domain || '')
  },
})
