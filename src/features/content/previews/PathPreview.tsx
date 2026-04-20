import { memo } from 'react'
import { FolderOpen } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { Content } from '../types'
import { CopyableRow, InlineCTAButton, MetaChip } from './PreviewShell'

type PathPreviewProps = {
  readonly content: Content
}

const parsePath = (raw: string) => {
  const isWindows = raw.includes('\\') && !raw.startsWith('/')
  const sep = isWindows ? '\\' : '/'
  const parts = raw.split(sep)
  const filename = parts[parts.length - 1] || ''
  const ext = filename.includes('.') ? (filename.split('.').pop() ?? '') : ''
  const dir = parts.slice(0, -1).join(sep) || sep
  const platform = isWindows ? 'Windows' : 'Unix'
  return { filename, ext, dir, platform }
}

const PathPreviewComponent = ({ content }: PathPreviewProps) => {
  const raw = content.text
  const { filename, ext, dir, platform } = parsePath(raw)

  const handleOpen = async () => {
    try {
      await invoke('open_path', { path: raw })
    } catch (error) {
      console.error('Failed to open path:', error)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header card */}
      <div className="flex flex-col items-center gap-2 p-5 rounded-xl bg-linear-to-br from-orange-500/10 to-amber-500/10 border border-orange-500/20">
        <div className="p-3 rounded-full bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30">
          <FolderOpen size={22} strokeWidth={2} />
        </div>
        <span className="text-lg font-semibold text-white/90 font-mono text-center break-all">
          {filename || raw}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          {ext && (
            <MetaChip className="bg-orange-500/10 text-orange-400 border-orange-500/20">
              .{ext}
            </MetaChip>
          )}
          <MetaChip>{platform}</MetaChip>
        </div>
      </div>

      {/* Open CTA */}
      <div className="flex justify-center">
        <InlineCTAButton
          icon={<FolderOpen size={16} />}
          label="Open Path"
          onClick={() => void handleOpen()}
          variant="primary"
        />
      </div>

      {/* Copyable fields */}
      <div className="flex flex-col gap-2">
        <CopyableRow label="Full Path" value={raw} sourceClipId={content.clip.id} />
        {filename && (
          <CopyableRow label="Filename" value={filename} sourceClipId={content.clip.id} />
        )}
        {dir && dir !== raw && (
          <CopyableRow label="Directory" value={dir} sourceClipId={content.clip.id} />
        )}
      </div>
    </div>
  )
}

export const PathPreview = memo(PathPreviewComponent)
