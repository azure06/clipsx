import { memo } from 'react'
import { FolderOpen } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { Content } from '../types'
import { CopyableRow, MetaChip } from './PreviewShell'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const raw = content.text
  const { filename, ext, dir, platform } = parsePath(raw)

  const handleOpen = async () => {
    try {
      await invoke('open_detected_path', { clipId: content.clip.id, path: raw })
    } catch (error) {
      console.error('Failed to open path:', error)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header card */}
      <div
        onClick={() => void handleOpen()}
        className="group flex flex-col items-center gap-2 p-5 rounded-xl bg-linear-to-br from-orange-500/10 to-amber-500/10 border border-orange-500/20 hover:border-orange-400/40 cursor-pointer transition-all duration-300 hover:shadow-[0_0_20px_rgba(251,146,60,0.15)]"
      >
        <div className="p-3 rounded-full bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30 group-hover:scale-110 transition-transform duration-200">
          <FolderOpen size={22} strokeWidth={2} />
        </div>
        <span
          className={`text-lg font-semibold font-mono text-center break-all ${previewTheme.textPrimary}`}
        >
          {filename || raw}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          {ext && (
            <MetaChip className="bg-orange-500/10 text-orange-400 border-orange-500/20">
              .{ext}
            </MetaChip>
          )}
          <MetaChip>{platform}</MetaChip>
          <MetaChip className="bg-orange-500/10 text-orange-400 border-orange-500/20 opacity-0 group-hover:opacity-100 transition-opacity">
            {t('common.open')}
          </MetaChip>
        </div>
      </div>

      {/* Copyable fields */}
      <div className="flex flex-col gap-2">
        <CopyableRow label={t('preview.fullPath')} value={raw} sourceClipId={content.clip.id} />
        {filename && (
          <CopyableRow
            label={t('preview.filename')}
            value={filename}
            sourceClipId={content.clip.id}
          />
        )}
        {dir && dir !== raw && (
          <CopyableRow label={t('preview.directory')} value={dir} sourceClipId={content.clip.id} />
        )}
      </div>
    </div>
  )
}

export const PathPreview = memo(PathPreviewComponent)
