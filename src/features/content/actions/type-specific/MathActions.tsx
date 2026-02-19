import { Calculator, Equal } from 'lucide-react'
import type { SmartAction } from '../../types'
import { safeEval } from '../../utils/math'

export const useCopyResultAction = (): SmartAction => ({
  id: 'copy-math-result',
  label: 'Copy Result',
  icon: <Equal size={16} />,
  category: 'core', // Changed to core so it appears prominently if needed, or transform
  check: content => content.type === 'math',
  execute: async content => {
    const result = safeEval(content.text)
    if (result !== null) {
      await navigator.clipboard.writeText(result.toString())
    }
  },
})

export const useCopyEquationAction = (): SmartAction => ({
  id: 'copy-equation',
  label: 'Copy Equation',
  icon: <Calculator size={16} />, // reuse calculator or use specific icon
  category: 'core',
  check: content => content.type === 'math',
  execute: async content => {
    await navigator.clipboard.writeText(content.text)
  },
})
