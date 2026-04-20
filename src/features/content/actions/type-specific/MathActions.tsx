import { Calculator, Equal } from 'lucide-react'
import type { SmartAction } from '../../types'
import { safeEval } from '../../utils/math'
import { useClipboardStore } from '../../../../stores/clipboardStore'

export const useCopyResultAction = (): SmartAction => ({
  id: 'copy-math-result',
  label: 'Copy Result',
  icon: <Equal size={16} />,
  category: 'core',
  placement: 'hidden',
  check: content => content.type === 'math',
  execute: async content => {
    const result = safeEval(content.text)
    if (result !== null) {
      await useClipboardStore.getState().copyDerivedText(result.toString(), content.clip.id)
    }
  },
})

export const useCopyEquationAction = (): SmartAction => ({
  id: 'copy-equation',
  label: 'Copy Equation',
  icon: <Calculator size={16} />,
  category: 'core',
  placement: 'hidden',
  check: content => content.type === 'math',
  execute: async content => {
    await useClipboardStore.getState().copyDerivedText(content.text, content.clip.id)
  },
})
