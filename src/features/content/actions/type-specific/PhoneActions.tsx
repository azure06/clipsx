import { Phone, MessageSquare } from 'lucide-react'
import type { SmartAction } from '../../types'
import { invoke } from '@tauri-apps/api/core'

export const useCallPhoneAction = (): SmartAction => ({
  id: 'call-phone',
  label: 'Call',
  icon: <Phone size={16} />,
  category: 'external',
  placement: 'preview_inline',
  check: content => content.type === 'phone',
  execute: content => {
    void invoke('start_phone_action', { number: content.text, message: false })
  },
})

export const useSmsAction = (): SmartAction => ({
  id: 'sms-phone',
  label: 'Send SMS',
  icon: <MessageSquare size={16} />,
  category: 'external',
  placement: 'preview_inline',
  check: content => content.type === 'phone',
  execute: content => {
    void invoke('start_phone_action', { number: content.text, message: true })
  },
})
