import { Send, AtSign, Mail } from 'lucide-react'
import type { SmartAction } from '../../types'
import { useClipboardStore } from '../../../../stores/clipboardStore'
import type { ShortcutDef } from '../../../../shared/keyboard/shortcuts'

const SEND_EMAIL_SHORTCUT: ShortcutDef = {
  modifiers: ['primary'],
  key: 'E',
}

export const useSendEmailAction = (): SmartAction => ({
  id: 'send-email',
  label: 'Compose Email',
  icon: <Send size={16} />,
  category: 'external',
  placement: 'hidden',
  shortcut: SEND_EMAIL_SHORTCUT,
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
  placement: 'hidden',
  check: content => content.type === 'email',
  execute: async content => {
    const email = content.metadata.email || content.text
    await useClipboardStore.getState().copyDerivedText(email, content.clip.id)
  },
})

export const useCopyDomainFromEmailAction = (): SmartAction => ({
  id: 'copy-email-domain',
  label: 'Copy Domain',
  icon: <AtSign size={16} />,
  category: 'utility',
  placement: 'preview_inline',
  check: content => content.type === 'email' && Boolean(content.metadata.domain),
  execute: async content => {
    await useClipboardStore
      .getState()
      .copyDerivedText(content.metadata.domain || '', content.clip.id)
  },
})
