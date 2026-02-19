import { Phone, MessageSquare } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useCallPhoneAction = (): SmartAction => ({
  id: 'call-phone',
  label: 'Call',
  icon: <Phone size={16} />,
  category: 'external',
  check: content => content.type === 'phone',
  execute: content => {
    window.open(`tel:${content.text}`)
  },
})

export const useSmsAction = (): SmartAction => ({
  id: 'sms-phone',
  label: 'Send SMS',
  icon: <MessageSquare size={16} />,
  category: 'external',
  check: content => content.type === 'phone',
  execute: content => {
    window.open(`sms:${content.text}`)
  },
})
