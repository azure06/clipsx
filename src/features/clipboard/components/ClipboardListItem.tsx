import { memo, useState } from 'react'
import type { ClipSummary } from '../../../shared/types/v2'
import {
  Command,
  CornerDownLeft,
  Hash,
  MessageSquare,
  Pin,
  ScanText,
  Sparkles,
  Star,
  Braces,
  Code2,
  Database,
  File,
  Globe,
  KeyRound,
  Link,
  Palette,
  Table2,
  Terminal,
  Text,
  type LucideIcon,
} from 'lucide-react'
import { ContentIcon } from '../../content/icons'
import { getPlatform } from '../../../shared/keyboard/shortcuts'
import { useTranslation } from 'react-i18next'
import { managedAssetUrl } from '../../../shared/utils/assetUrl'

type ClipboardListItemProps = {
  readonly clip: ClipSummary
  readonly onCopy: (text: string, id: string) => void
  readonly onSelect?: (text: string, id: string) => void
  readonly onDoubleClick?: (text: string, id: string) => void
  readonly isSelected?: boolean
  readonly index?: number
}

const ClipboardListItemComponent = ({
  clip,
  onCopy,
  onSelect,
  onDoubleClick,
  isSelected = false,
  index,
}: ClipboardListItemProps) => {
  const { t } = useTranslation()
  const platform = getPlatform()
  const isMac = platform === 'macos'
  const [failedThumbnailId, setFailedThumbnailId] = useState<string | null>(null)
  const thumbnailFailed = failedThumbnailId === clip.thumbnailAssetId
  const compact = clip.compactPresentation
  const summary = compact?.title ?? clip.safeSummary
  const preview = summary.length > 100 ? `${summary.slice(0, 100)}...` : summary

  const isPinned = Boolean(clip.isPinned)
  const isFavorite = Boolean(clip.isFavorite)
  const tags = clip.tags ?? []
  const hasScore = (clip.similarityScore ?? 0) > 0
  const semanticMatch = clip.searchMatches?.find(
    match => match.sourceId === 'builtin.search.semantic_text'
  )
  const isMeaningOnly = Boolean(
    semanticMatch && !clip.searchMatches?.some(match => match.sourceId === 'builtin.search.fts')
  )
  const semanticPercent =
    isMeaningOnly && typeof semanticMatch?.sourceScore === 'number'
      ? Math.round(Math.min(1, Math.max(0, semanticMatch.sourceScore)) * 100)
      : null
  const ocrActive = clip.ocrStatus === 'pending' || clip.ocrStatus === 'running'
  const hasAttributes =
    isPinned ||
    isFavorite ||
    tags.length > 0 ||
    Boolean(clip.note) ||
    hasScore ||
    isMeaningOnly ||
    Boolean(clip.hasEmbedding) ||
    ocrActive

  const handleClick = () => {
    if (onSelect) {
      onSelect(clip.safeSummary, clip.id)
    } else {
      onCopy(clip.safeSummary, clip.id)
    }
  }

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={() => onDoubleClick?.(clip.safeSummary, clip.id)}
        data-clip-index={index}
        className={`group relative flex items-center gap-3 py-2 px-3 transition-all duration-200 cursor-pointer mx-2 my-0.5 rounded-lg border ${
          isSelected
            ? 'bg-linear-to-r from-blue-100/40 dark:from-blue-500/20 to-violet-100/40 dark:to-violet-500/20 border-blue-200/60 dark:border-blue-500/30 backdrop-blur-md shadow-sm'
            : isPinned
              ? 'bg-violet-50/40 dark:bg-violet-500/5 border-violet-200/50 dark:border-violet-500/10'
              : 'bg-transparent border-transparent hover:bg-slate-100/50 dark:hover:bg-slate-100/5 hover:border-gray-100/60 dark:hover:border-gray-100/5 hover:shadow-sm dark:hover:shadow-none'
        }`}
      >
        {/* Accent border for pinned items */}
        {isPinned && (
          <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-violet-400/50 dark:bg-violet-400/50"></div>
        )}

        {/* Type icon or thumbnail */}
        <div className="shrink-0">
          {compact?.leading.kind === 'swatch' ? (
            <div
              aria-label={compact.accessibilityLabel}
              className="h-6 w-6 rounded-full border border-black/15 shadow-sm dark:border-white/25"
              style={{
                backgroundColor: `rgba(${compact.leading.red}, ${compact.leading.green}, ${compact.leading.blue}, ${compact.leading.alpha / 255})`,
              }}
            />
          ) : compact?.leading.kind === 'monogram' ? (
            <div
              aria-label={compact.accessibilityLabel}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold dark:bg-slate-700"
            >
              {compact.leading.text}
            </div>
          ) : compact?.leading.kind === 'host_icon' ? (
            <HostIcon name={compact.leading.name} label={compact.accessibilityLabel} />
          ) : (compact?.leading.kind === 'input_thumbnail' ||
              (!compact && clip.primaryPresentationKind === 'image')) &&
            clip.thumbnailAssetId &&
            !thumbnailFailed ? (
            <img
              src={managedAssetUrl(clip.thumbnailAssetId, platform)}
              alt={t('clipboard.thumbnail')}
              className="h-6 w-6 rounded-full object-cover ring-2 ring-gray-200/50 dark:ring-gray-700/50 shadow-sm"
              onError={() => setFailedThumbnailId(clip.thumbnailAssetId)}
            />
          ) : (
            <div className="text-gray-500 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              <ContentIcon presentationKind={clip.primaryPresentationKind} size="sm" />
            </div>
          )}
        </div>

        {/* Main content area - Horizontal Flow */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {/* Preview text - Strictly 1 line */}
          <div className="min-w-0">
            <div
              className={`truncate text-xs ${isSelected ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}
            >
              {preview}
            </div>
            {compact?.subtitle && (
              <div className="truncate text-[10px] text-gray-400">{compact.subtitle}</div>
            )}
          </div>
          {semanticPercent !== null && (
            <span
              className="ml-1 flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded border border-pink-300/60 bg-linear-to-r from-violet-500/10 to-pink-500/10 px-1.5 py-px text-[10px] font-bold text-pink-500 shadow-sm dark:border-pink-500/30 dark:text-pink-400"
              title={t('clipboard.semanticScore', { score: semanticPercent })}
              aria-label={t('clipboard.semanticScore', { score: semanticPercent })}
            >
              <Sparkles className="mr-0.5 h-2.5 w-2.5" strokeWidth={3} />
              {semanticPercent}%
            </span>
          )}
        </div>

        {/* Far Right Area: Shortcut, Icons, Enter Key */}
        <div className="flex items-center gap-2 shrink-0 ml-auto pl-2">
          {compact?.badge && (
            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[9px] text-gray-500 dark:bg-white/10">
              {compact.badge}
            </span>
          )}
          {/* Attributes - Right Aligned */}
          {hasAttributes && (
            <div className="flex items-center gap-1.5 shrink-0 opacity-70">
              {isPinned && <Pin className="h-3 w-3 text-violet-500" strokeWidth={2.5} />}
              {isFavorite && (
                <Star className="h-3 w-3 text-amber-500 fill-amber-500" strokeWidth={2.5} />
              )}
              {tags.length > 0 && <Hash className="h-3 w-3 text-blue-400" strokeWidth={2.5} />}
              {clip.note && (
                <MessageSquare className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
              )}
              {ocrActive && (
                <ScanText className="h-3 w-3 animate-pulse text-sky-400" strokeWidth={2.5} />
              )}
              {clip.hasEmbedding && (
                <Sparkles
                  className="h-3 w-3 shrink-0 text-violet-400"
                  strokeWidth={2}
                  aria-label="Embedded"
                />
              )}
            </div>
          )}

          {/* Shortcut / Action Hint */}
          {isSelected || (index !== undefined && index >= 0 && index < 9) ? (
            <div className="flex shrink-0 items-center justify-center h-5 min-w-5 px-1.5 rounded border border-gray-300/60 dark:border-gray-700/50 bg-slate-50/60 dark:bg-slate-800/50 text-[10px] font-medium text-gray-600 dark:text-gray-400 shadow-sm transition-opacity">
              {isSelected ? (
                <CornerDownLeft
                  className="h-3 w-3 opacity-70 text-blue-500 dark:text-blue-400"
                  strokeWidth={2.5}
                />
              ) : (
                <>
                  {isMac ? (
                    <>
                      <Command className="w-2.5 h-2.5 mr-0.5 opacity-70" />
                      <span className="opacity-70">{index! + 1}</span>
                    </>
                  ) : (
                    <>
                      <span className="opacity-70">Ctrl</span>
                      <span className="opacity-50">+</span>
                      <span className="opacity-70">{index! + 1}</span>
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="h-5 w-5 shrink-0 opacity-0 pointer-events-none" /> /* Placeholder space to prevent jump */
          )}
        </div>
      </div>
    </>
  )
} // Memoize the component to prevent re-renders when other items change
export const ClipboardListItem = memo(ClipboardListItemComponent)

const HOST_ICON_CATALOG: Record<string, LucideIcon> = {
  braces: Braces,
  code: Code2,
  database: Database,
  file: File,
  globe: Globe,
  hash: Hash,
  key: KeyRound,
  link: Link,
  palette: Palette,
  table: Table2,
  terminal: Terminal,
  text: Text,
}

const HostIcon = ({ name, label }: { name: string; label: string }) => {
  const Icon = HOST_ICON_CATALOG[name] ?? File
  return <Icon aria-label={label} className="h-5 w-5 text-gray-500" />
}
