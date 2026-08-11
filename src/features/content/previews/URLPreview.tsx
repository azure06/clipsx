import { memo, useMemo } from 'react'
import { ExternalLink, Link2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { Content } from '../types'
import { useActionRegistry } from '../actions/registry'
import { CopyableRow, MetaChip, PreviewLocalMenu } from './PreviewShell'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

type URLPreviewProps = {
  readonly content: Content
}

type ParsedURL = {
  href: string
  protocol: string
  hostname: string
  pathname: string
  search: string
  hash: string
  searchParams: [string, string][]
}

const parseURL = (raw: string): ParsedURL | null => {
  try {
    const u = new URL(raw)
    return {
      href: u.href,
      protocol: u.protocol.replace(':', ''),
      hostname: u.hostname,
      pathname: u.pathname === '/' ? '' : u.pathname,
      search: u.search,
      hash: u.hash ? u.hash.slice(1) : '',
      searchParams: [...u.searchParams.entries()],
    }
  } catch {
    return null
  }
}

const URLPreviewComponent = ({ content }: URLPreviewProps) => {
  const { t } = useTranslation()
  const raw = content.metadata.url || content.text
  const parsed = useMemo(() => parseURL(raw), [raw])

  const { getPreviewMenuActions } = useActionRegistry()
  const menuActions = getPreviewMenuActions(content)

  const handleOpen = () => {
    void invoke('open_external_url', { url: raw })
  }

  const isImage = raw.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)
  const isVideo = raw.match(/\.(mp4|webm|ogg)$/i)

  if (!parsed) {
    return (
      <div className="p-4 text-sm text-gray-600 dark:text-gray-400 font-mono break-all">{raw}</div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Clickable URL card */}
      <div
        onClick={handleOpen}
        className="group relative p-4 rounded-xl bg-linear-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 hover:border-blue-400/40 cursor-pointer transition-all duration-300 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] overflow-hidden"
      >
        <div className="absolute inset-0 bg-linear-to-r from-transparent via-blue-500/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
        <div className="relative flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30 group-hover:scale-110 transition-transform duration-200 shrink-0">
            <Link2 size={18} strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <MetaChip className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                {parsed.protocol}
              </MetaChip>
              <span className="text-xs text-blue-700 dark:text-blue-300 font-semibold">
                {parsed.hostname}
              </span>
            </div>
            <p
              className={`text-sm font-medium break-all leading-relaxed ${previewTheme.textPrimary}`}
            >
              {raw}
            </p>
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0">
            <ExternalLink size={16} className="text-blue-400" />
          </div>
        </div>
      </div>

      {/* Embedded media */}
      {(isImage || isVideo) && (
        <div
          className={`rounded-lg overflow-hidden flex items-center justify-center ${previewTheme.surfaceInset}`}
        >
          {isImage ? (
            <img
              src={raw}
              alt={t('preview.urlPreview')}
              className="max-w-full max-h-64 object-contain"
              onError={e => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <video
              src={raw}
              controls
              className="max-w-full max-h-64 object-contain"
              onError={e => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>
      )}

      {/* Structured URL breakdown */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            {t('preview.urlStructure')}
          </span>
          {menuActions.length > 0 && <PreviewLocalMenu actions={menuActions} content={content} />}
        </div>

        <CopyableRow
          label={t('preview.domain')}
          value={parsed.hostname}
          sourceClipId={content.clip.id}
        />
        {parsed.pathname && (
          <CopyableRow
            label={t('preview.path')}
            value={parsed.pathname}
            sourceClipId={content.clip.id}
          />
        )}
        {parsed.hash && (
          <CopyableRow
            label={t('preview.fragment')}
            value={parsed.hash}
            sourceClipId={content.clip.id}
          />
        )}
        {parsed.searchParams.map(([key, val]) => (
          <CopyableRow key={key} label={`?${key}`} value={val} sourceClipId={content.clip.id} />
        ))}
      </div>
    </div>
  )
}

export const URLPreview = memo(URLPreviewComponent)
