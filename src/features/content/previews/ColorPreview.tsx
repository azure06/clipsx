import { memo } from 'react'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import type { Content } from '../types'

type ColorPreviewProps = {
  readonly content: Content
}

const ColorPreviewComponent = ({ content }: ColorPreviewProps) => {
  const [copied, setCopied] = useState(false)
  const colorValue = content.metadata.hex || content.metadata.value || content.text

  // Check if color has transparency (rgba, hsla, or 8-digit hex with alpha)
  const hasTransparency =
    colorValue.toLowerCase().includes('rgba') ||
    colorValue.toLowerCase().includes('hsla') ||
    (colorValue.startsWith('#') && colorValue.length === 9) // #RRGGBBAA format

  const handleCopy = () => {
    void navigator.clipboard.writeText(colorValue)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact color swatch */}
      <div className="relative group">
        {/* Checkered pattern ONLY for transparency - behind the color */}
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
          className="w-full h-36 rounded-xl shadow-xl ring-1 ring-white/10 transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_15px_40px_-10px_rgba(0,0,0,0.4)]"
          style={{ backgroundColor: colorValue }}
        />
      </div>

      {/* Compact color values */}
      <div className="flex flex-col gap-2">
        <div
          onClick={handleCopy}
          className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-all duration-200 group"
        >
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Hex</span>
            <span className="text-xl font-mono font-bold text-white/90">{colorValue}</span>
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            {copied ? (
              <Check size={18} className="text-green-400" />
            ) : (
              <Copy size={18} className="text-gray-400" />
            )}
          </div>
        </div>

        {/* Additional formats if available */}
        {content.metadata.value && content.metadata.value !== colorValue && (
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-0.5">
              Original
            </span>
            <span className="text-base font-mono text-white/80">{content.metadata.value}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export const ColorPreview = memo(ColorPreviewComponent)
