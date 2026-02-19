import { Palette, Pipette, Copy } from 'lucide-react'
import type { SmartAction } from '../../types'

export const useCopyHexAction = (): SmartAction => ({
  id: 'copy-hex',
  label: 'Copy Hex',
  icon: <Palette size={16} />,
  category: 'utility',
  check: content => content.type === 'color',
  execute: async content => {
    const hex = content.metadata.hex || content.text
    await navigator.clipboard.writeText(hex)
  },
})

export const useCopyRGBAction = (): SmartAction => ({
  id: 'copy-rgb',
  label: 'Copy RGB',
  icon: <Pipette size={16} />,
  category: 'transform',
  check: content => content.type === 'color',
  execute: async content => {
    // Convert hex to RGB
    const hex = (content.metadata.hex || content.text).replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    await navigator.clipboard.writeText(`rgb(${r}, ${g}, ${b})`)
  },
})

export const useCopyHSLAction = (): SmartAction => ({
  id: 'copy-hsl',
  label: 'Copy HSL',
  icon: <Copy size={16} />,
  category: 'transform',
  check: content => content.type === 'color',
  execute: async content => {
    // Convert hex to HSL (simplified)
    const hex = (content.metadata.hex || content.text).replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2

    let h = 0
    let s = 0

    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (max === g) h = ((b - r) / d + 2) / 6
      else h = ((r - g) / d + 4) / 6
    }

    await navigator.clipboard.writeText(
      `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
    )
  },
})
