import { Send, AtSign, Mail } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useSendEmailAction = (): SmartAction => ({
  id: 'send-email',
  label: 'Compose Email',
  icon: <Send size={16} />,
  category: 'external',
  shortcut: '⌘E',
  check: content => content.type === 'email',
  execute: content => {
    const email = content.metadata.email || content.text
    window.open(`mailto:${email}`, '_blank')
  },
})

export const useCopyEmailAction = (): SmartAction => ({
  id: 'copy-email',
  label: 'Copy Address',
  icon: <Mail size={16} />,
  category: 'core',
  check: content => content.type === 'email',
  execute: async content => {
    const email = content.metadata.email || content.text
    await navigator.clipboard.writeText(email)
  },
})

export const useCopyDomainFromEmailAction = (): SmartAction => ({
  id: 'copy-email-domain',
  label: 'Copy Domain',
  icon: <AtSign size={16} />,
  category: 'utility',
  check: content => content.type === 'email' && Boolean(content.metadata.domain),
  execute: async content => {
    await navigator.clipboard.writeText(content.metadata.domain || '')
  },
})
