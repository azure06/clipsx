import { Calculator } from 'lucide-react'
import type { SmartAction } from '../../types'

const safeEval = (expr: string): number | null => {
  // Very strict regex: only numbers, whitespace, and basic operators

  if (!/^[\d\s+\-*/().]+$/.test(expr)) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
    return new Function(`return ${expr}`)()
  } catch {
    return null
  }
}

export const useCalculateAction = (): SmartAction => ({
  id: 'calculate-math',
  label: 'Calculate',
  icon: <Calculator size={16} />,
  category: 'transform',
  check: content => content.type === 'math',
  execute: async content => {
    const result = safeEval(content.text)
    if (result !== null) {
      await navigator.clipboard.writeText(result.toString())
    }
  },
})
