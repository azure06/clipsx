import { Archive, Check } from 'lucide-react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { Content, SmartAction } from '../../types'
import { useAuthStore } from '../../../../stores/authStore'

export const useVaultAction = (): SmartAction => {
  const [saved, setSaved] = useState(false)
  const userId = useAuthStore(state => state.userId)

  return {
    id: 'vault',
    label: saved ? 'Added to Vault' : 'Add to Vault',
    icon: saved ? <Check size={16} /> : <Archive size={16} />,
    category: 'core',
    placement: 'global_bar',
    check: () => Boolean(userId),
    execute: async (content: Content) => {
      if (!userId) return
      await invoke('add_clip_to_vault', { clipId: content.clip.id, ownerId: userId })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  }
}
