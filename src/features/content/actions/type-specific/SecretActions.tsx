import { Eye } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useRevealSecretAction = (): SmartAction => ({
  id: 'reveal-secret',
  label: 'Reveal',
  icon: <Eye size={16} />,
  category: 'core',
  check: content => content.type === 'secret',
  execute: () => {
    // This is a UI state toggle, which might be tricky with this stateless action model.
    // Ideally, the UI component handles the reveal state, and this action just signals it?
    // Or we just don't have a "Reveal" action here if it's UI state.
    // Let's implement a "Copy Masked" as a placeholder for now,
    // or maybe valid "Burn" action (delete immediately).
    console.log('Reveal secret triggered')
  },
})
