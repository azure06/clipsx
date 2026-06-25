import { memo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { Content } from '../types'
import { hexToRgb, hexToHsl } from '../utils/color'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { previewTheme } from './previewTheme'

type ColorPreviewProps = {
  readonly content: Content
}

type ColorFormatRowProps = {
  readonly label: string
  readonly value: string
  readonly sourceClipId?: string
}

const ColorFormatRow = ({ label, value }: ColorFormatRowProps) => {
  const [copied, setCopied] = useState(false)
  const copyDerivedText = useClipboardStore(state => state.copyDerivedText)

  const handleCopy = async () => {
    await copyDerivedText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      onClick={() => void handleCopy()}
      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all duration-200 group ${previewTheme.surfaceMuted} hover:bg-slate-100 dark:hover:bg-slate-100/10`}
    >
      <div className="flex flex-col">
        <span className={`text-[10px] uppercase tracking-wider mb-0.5 ${previewTheme.textMuted}`}>
          {label}
        </span>
        <span className={`text-sm font-mono font-medium ${previewTheme.textPrimary}`}>{value}</span>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? (
          <Check size={16} className="text-green-400" />
        ) : (
          <Copy size={16} className={previewTheme.textMuted} />
        )}
      </div>
    </div>
  )
}

const ColorPreviewComponent = ({ content }: ColorPreviewProps) => {
  const colorValue = content.metadata.hex || content.metadata.value || content.text

  // Normalize hex
  const hex = colorValue.startsWith('#') ? colorValue : `#${colorValue}`

  // Calculate formats
  const rgb = hexToRgb(hex)
  const hsl = hexToHsl(hex)

  const rgbString = rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : null
  const hslString = hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : null

  // Check transparency for background pattern
  const hasTransparency =
    colorValue.toLowerCase().includes('rgba') ||
    colorValue.toLowerCase().includes('hsla') ||
    (colorValue.startsWith('#') && colorValue.length === 9)

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Large visual swatch */}
      <div className="relative group">
        {hasTransparency && (
          <div
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{
              backgroundImage: 'repeating-conic-gradient(#fff 0% 25%, #ddd 0% 50%)',
              backgroundPosition: '0 0, 10px 10px',
              backgroundSize: '20px 20px',
            }}
          />
        )}
        <div
          className="w-full h-32 rounded-xl shadow-lg ring-1 ring-slate-200/70 dark:ring-white/10 transition-transform duration-300 hover:scale-[1.01]"
          style={{ backgroundColor: colorValue }}
        />
      </div>

      {/* Formats List */}
      <div className="flex flex-col gap-2">
        <ColorFormatRow label="HEX" value={hex.toUpperCase()} sourceClipId={content.clip.id} />
        {rgbString && (
          <ColorFormatRow label="RGB" value={rgbString} sourceClipId={content.clip.id} />
        )}
        {hslString && (
          <ColorFormatRow label="HSL" value={hslString} sourceClipId={content.clip.id} />
        )}
      </div>
    </div>
  )
}

export const ColorPreview = memo(ColorPreviewComponent)
