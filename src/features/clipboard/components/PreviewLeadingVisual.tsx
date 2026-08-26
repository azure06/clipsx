import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipSummary, HistoryPreview } from '../../../shared/types/v2'
import {
  Braces,
  Briefcase,
  CalendarDays,
  Code2,
  Database,
  File,
  FileCode2,
  FileQuestion,
  FileText,
  FileType,
  Files,
  Folder,
  Globe,
  Hash,
  Image as ImageIcon,
  KeyRound,
  Link,
  Mail,
  Palette,
  Phone,
  Sigma,
  Table2,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { getPlatform } from '../../../shared/keyboard/shortcuts'
import { managedAssetUrl } from '../../../shared/utils/assetUrl'

const HOST_ICON_CATALOG: Record<string, LucideIcon> = {
  braces: Braces,
  briefcase: Briefcase,
  calendar: CalendarDays,
  code: Code2,
  database: Database,
  file: File,
  file_code: FileCode2,
  file_question: FileQuestion,
  file_text: FileText,
  files: Files,
  folder: Folder,
  globe: Globe,
  hash: Hash,
  image: ImageIcon,
  key: KeyRound,
  link: Link,
  mail: Mail,
  palette: Palette,
  phone: Phone,
  sigma: Sigma,
  table: Table2,
  terminal: Terminal,
  text: FileType,
  html: FileCode2,
}

// Same recipe as ContentIcon: a tinted ring + soft bg per content type, so the
// history list reads as colorful and alive rather than one flat gray blob.
const ICON_TINTS: Record<string, string> = {
  braces: 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/25 dark:text-cyan-300',
  briefcase: 'bg-blue-500/15 text-blue-600 ring-blue-500/25 dark:text-blue-300',
  calendar: 'bg-teal-500/15 text-teal-600 ring-teal-500/25 dark:text-teal-300',
  code: 'bg-violet-500/15 text-violet-600 ring-violet-500/25 dark:text-violet-300',
  database: 'bg-indigo-500/15 text-indigo-600 ring-indigo-500/25 dark:text-indigo-300',
  file: 'bg-slate-500/15 text-slate-600 ring-slate-400/25 dark:text-slate-300',
  file_code: 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/25 dark:text-cyan-300',
  file_question: 'bg-slate-500/15 text-slate-600 ring-slate-400/25 dark:text-slate-300',
  file_text: 'bg-blue-500/15 text-blue-600 ring-blue-500/25 dark:text-blue-300',
  files: 'bg-amber-500/15 text-amber-600 ring-amber-500/25 dark:text-amber-300',
  folder: 'bg-amber-500/15 text-amber-600 ring-amber-500/25 dark:text-amber-300',
  globe: 'bg-sky-500/15 text-sky-600 ring-sky-500/25 dark:text-sky-300',
  hash: 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/25 dark:text-cyan-300',
  html: 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/25 dark:text-cyan-300',
  image: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300',
  key: 'bg-rose-500/15 text-rose-600 ring-rose-500/25 dark:text-rose-300',
  link: 'bg-sky-500/15 text-sky-600 ring-sky-500/25 dark:text-sky-300',
  mail: 'bg-sky-500/15 text-sky-600 ring-sky-500/25 dark:text-sky-300',
  palette: 'bg-fuchsia-500/15 text-fuchsia-600 ring-fuchsia-500/25 dark:text-fuchsia-300',
  phone: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300',
  sigma: 'bg-violet-500/15 text-violet-600 ring-violet-500/25 dark:text-violet-300',
  table: 'bg-amber-500/15 text-amber-600 ring-amber-500/25 dark:text-amber-300',
  terminal: 'bg-violet-500/15 text-violet-600 ring-violet-500/25 dark:text-violet-300',
  text: 'bg-slate-500/15 text-slate-600 ring-slate-400/25 dark:text-slate-300',
}

const CIRCLE_CLASS =
  'flex items-center justify-center rounded-full ring-2 shadow-sm transition-all duration-200 hover:scale-110 hover:shadow-md'

// Extension glyphs bring their own color, so keep their shared container neutral.
const EXTENSION_ICON_TINT =
  'bg-gradient-to-br from-white/90 to-slate-100/70 ring-black/10 dark:from-white/15 dark:to-white/5 dark:ring-white/15'

const SIZES = {
  sm: { outer: 'h-[26px] w-[26px]', icon: 'h-3 w-3', packageIcon: 'h-4 w-4' },
  lg: { outer: 'h-14 w-14', icon: 'h-6 w-6', packageIcon: 'h-8 w-8' },
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
  if (preview.leading.kind === 'package_icon') {
    const style =
      preview.leading.scalePercent === 100
        ? undefined
        : { transform: `scale(${preview.leading.scalePercent / 100})` }
    return (
      <div
        aria-label={preview.accessibilityLabel}
        className={`${CIRCLE_CLASS} ${EXTENSION_ICON_TINT} ${dims.outer}`}
      >
        <img
          alt=""
          className={`${dims.packageIcon} shrink-0 ${preview.leading.dark ? 'dark:hidden' : ''}`}
          src={preview.leading.light}
          style={style}
        />
        {preview.leading.dark && (
          <img
            alt=""
            className={`hidden ${dims.packageIcon} shrink-0 dark:block`}
            src={preview.leading.dark}
            style={style}
          />
        )}
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
