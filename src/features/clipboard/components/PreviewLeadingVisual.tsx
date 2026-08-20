import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipSummary, HistoryPreview } from '../../../shared/types/v2'
import {
  AlignLeft,
  Braces,
  Code2,
  Database,
  File,
  Globe,
  Hash,
  KeyRound,
  Link,
  Palette,
  Table2,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { getPlatform } from '../../../shared/keyboard/shortcuts'
import { managedAssetUrl } from '../../../shared/utils/assetUrl'

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
  text: AlignLeft,
}

// Same recipe as ContentIcon: a tinted ring + soft bg per content type, so the
// history list reads as colorful and alive rather than one flat gray blob.
const ICON_TINTS: Record<string, string> = {
  braces: 'bg-emerald-500/20 text-emerald-500 ring-emerald-500/30 dark:text-emerald-400',
  code: 'bg-green-500/20 text-green-500 ring-green-500/30 dark:text-green-400',
  database: 'bg-indigo-500/20 text-indigo-500 ring-indigo-500/30 dark:text-indigo-400',
  file: 'bg-slate-500/20 text-slate-500 ring-slate-500/30 dark:text-slate-400',
  globe: 'bg-sky-500/20 text-sky-500 ring-sky-500/30 dark:text-sky-400',
  hash: 'bg-cyan-500/20 text-cyan-500 ring-cyan-500/30 dark:text-cyan-400',
  key: 'bg-red-500/20 text-red-500 ring-red-500/30 dark:text-red-400',
  link: 'bg-blue-500/20 text-blue-500 ring-blue-500/30 dark:text-blue-400',
  palette: 'bg-fuchsia-500/20 text-fuchsia-500 ring-fuchsia-500/30 dark:text-fuchsia-400',
  table: 'bg-lime-500/20 text-lime-500 ring-lime-500/30 dark:text-lime-400',
  terminal: 'bg-violet-500/20 text-violet-500 ring-violet-500/30 dark:text-violet-400',
  text: 'bg-slate-500/20 text-slate-500 ring-slate-500/30 dark:text-slate-400',
}

const CIRCLE_CLASS =
  'flex items-center justify-center rounded-full ring-2 shadow-sm transition-all duration-200 hover:scale-110 hover:shadow-md'

const SIZES = {
  sm: { outer: 'h-7 w-7', icon: 'h-3.5 w-3.5' },
  lg: { outer: 'h-14 w-14', icon: 'h-6 w-6' },
} as const

type PreviewLeadingVisualProps = {
  readonly clip: ClipSummary
  readonly preview: HistoryPreview
  readonly size: 'sm' | 'lg'
}

export const PreviewLeadingVisual = ({ clip, preview, size }: PreviewLeadingVisualProps) => {
  const { t } = useTranslation()
  const platform = getPlatform()
  const [failedThumbnailId, setFailedThumbnailId] = useState<string | null>(null)
  const thumbnailFailed = failedThumbnailId === clip.thumbnailAssetId
  const dims = SIZES[size]

  if (preview.leading.kind === 'swatch') {
    const { red, green, blue, alpha } = preview.leading
    return (
      <div
        aria-label={preview.accessibilityLabel}
        className={`${dims.outer} rounded-full border border-black/15 shadow-sm dark:border-white/25`}
        style={{ backgroundColor: `rgba(${red}, ${green}, ${blue}, ${alpha / 255})` }}
      />
    )
  }
  if (preview.leading.kind === 'monogram') {
    return (
      <div
        aria-label={preview.accessibilityLabel}
        className={`${CIRCLE_CLASS} ${ICON_TINTS['file']} ${dims.outer} text-[10px] font-semibold`}
      >
        {preview.leading.text}
      </div>
    )
  }
  if (preview.leading.kind === 'input_thumbnail' && clip.thumbnailAssetId && !thumbnailFailed) {
    return (
      <img
        src={managedAssetUrl(clip.thumbnailAssetId, platform)}
        alt={t('clipboard.thumbnail')}
        className={`${dims.outer} rounded-full object-cover ring-2 ring-gray-200/50 dark:ring-gray-700/50 shadow-sm`}
        onError={() => setFailedThumbnailId(clip.thumbnailAssetId)}
      />
    )
  }
  const iconName = preview.leading.kind === 'host_icon' ? preview.leading.name : 'file'
  const Icon = HOST_ICON_CATALOG[iconName] ?? File
  const tint = ICON_TINTS[iconName] ?? ICON_TINTS['file']
  return (
    <div
      aria-label={preview.accessibilityLabel}
      className={`${CIRCLE_CLASS} ${tint} ${dims.outer}`}
    >
      <Icon className={dims.icon} />
    </div>
  )
}
