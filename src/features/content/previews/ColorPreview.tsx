import { memo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { Content } from '../types'
import { hexToRgb, hexToHsl } from '../utils/color'

type ColorPreviewProps = {
  readonly content: Content
}

const ColorFormatRow = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      onClick={handleCopy}
      className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-all duration-200 group"
    >
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</span>
        <span className="text-sm font-mono font-medium text-white/90">{value}</span>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? (
          <Check size={16} className="text-green-400" />
        ) : (
          <Copy size={16} className="text-gray-400" />
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
          className="w-full h-32 rounded-xl shadow-lg ring-1 ring-white/10 transition-transform duration-300 hover:scale-[1.01]"
          style={{ backgroundColor: colorValue }}
        />
      </div>

      {/* Formats List */}
      <div className="flex flex-col gap-2">
        <ColorFormatRow label="HEX" value={hex.toUpperCase()} />
        {rgbString && <ColorFormatRow label="RGB" value={rgbString} />}
        {hslString && <ColorFormatRow label="HSL" value={hslString} />}
      </div>
    </div>
  )
}

export const ColorPreview = memo(ColorPreviewComponent)
