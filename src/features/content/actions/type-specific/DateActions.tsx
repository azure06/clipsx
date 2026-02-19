import { Calendar, Clock } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useCopyIsoDateAction = (): SmartAction => ({
  id: 'copy-iso-date',
  label: 'Copy ISO 8601',
  icon: <Calendar size={16} />,
  category: 'utility',
  check: content => content.type === 'date' || content.type === 'timestamp',
  execute: async content => {
    // If it's already an ISO date (from metadata) or we need to parse it
    let iso = content.metadata.iso || content.text
    if (content.type === 'timestamp' && content.metadata.value) {
      const date = new Date(
        Number(content.metadata.value) * (content.metadata.unit === 'seconds' ? 1000 : 1)
      )
      iso = date.toISOString()
    }
    await navigator.clipboard.writeText(iso)
  },
})

export const useCopyTimestampAction = (): SmartAction => ({
  id: 'copy-timestamp',
  label: 'Copy Timestamp',
  icon: <Clock size={16} />,
  category: 'utility',
  check: content => content.type === 'date',
  execute: async content => {
    const date = new Date(content.text)
    if (!isNaN(date.getTime())) {
      await navigator.clipboard.writeText(Math.floor(date.getTime() / 1000).toString())
    }
  },
})
