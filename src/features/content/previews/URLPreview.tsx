import { memo } from 'react'
import { ExternalLink, Globe, Link2 } from 'lucide-react'
import type { Content } from '../types'

type URLPreviewProps = {
  readonly content: Content
}

const URLPreviewComponent = ({ content }: URLPreviewProps) => {
  const url = content.metadata.url || content.text
  const domain = content.metadata.domain || new URL(url).hostname
  const protocol = content.metadata.protocol || new URL(url).protocol.replace(':', '')

  const handleOpen = () => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const isImage = url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)
  const isVideo = url.match(/\.(mp4|webm|ogg)$/i)

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Compact URL display */}
      <div
        onClick={handleOpen}
        className="group relative p-4 rounded-xl bg-linear-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 hover:border-blue-400/40 cursor-pointer transition-all duration-300 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] overflow-hidden"
      >
        {/* Animated background gradient */}
        <div className="absolute inset-0 bg-linear-to-r from-transparent via-blue-500/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

        <div className="relative flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30 group-hover:scale-110 transition-transform duration-200">
            <Link2 size={18} strokeWidth={2.5} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <Globe size={12} className="text-blue-400 shrink-0" />
              <span className="text-xs text-blue-300 font-semibold uppercase tracking-wider">
                {domain}
              </span>
            </div>
            <p className="text-base font-medium text-white/90 break-all leading-relaxed">{url}</p>
          </div>

          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0">
            <ExternalLink size={16} className="text-blue-400" />
          </div>
        </div>
      </div>

      {(isImage || isVideo) && (
        <div className="rounded-lg overflow-hidden bg-black/20 flex items-center justify-center border border-gray-100/5">
          {isImage ? (
            <img
              src={url}
              alt="URL Preview"
              className="max-w-full max-h-64 object-contain"
              onError={e => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <video
              src={url}
              controls
              className="max-w-full max-h-64 object-contain"
              onError={e => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>
      )}

      {/* Compact metadata badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 text-[10px] font-semibold uppercase tracking-wider">
          {protocol}
        </div>
        <div className="px-2.5 py-1 rounded-md bg-slate-100/5 text-gray-400 text-[10px] font-medium">
          {url.length} chars
        </div>
      </div>
    </div>
  )
}

export const URLPreview = memo(URLPreviewComponent)
