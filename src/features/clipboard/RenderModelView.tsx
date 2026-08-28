import { invoke } from '@tauri-apps/api/core'
import {
  Archive,
  AtSign,
  Binary,
  Braces,
  Calculator,
  CalendarDays,
  Check,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  File,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  Image,
  ImageOff,
  MessageSquare,
  Music,
  Palette,
  Phone,
  Send,
  ShieldAlert,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { copyLiteralText } from '../../shared/clipboardOutput'
import { managedAssetUrl, transformImageUrl } from '../../shared/utils/assetUrl'

const assertNever = (value: never): never => {
  throw new Error(`Unhandled render model: ${JSON.stringify(value)}`)
}

const CARD_HOST_ICONS: Record<string, typeof File> = {
  binary: Binary,
  braces: Braces,
  code: Code2,
  database: Archive,
  file: File,
  globe: ExternalLink,
  hash: AtSign,
  key: ShieldAlert,
  palette: Palette,
  table: FileSpreadsheet,
  terminal: Archive,
  text: FileText,
}

const CARD_ICON_TINTS: Record<string, string> = {
  binary: 'bg-violet-500/15 text-violet-600 ring-violet-500/25 dark:text-violet-300',
  code: 'bg-violet-500/15 text-violet-600 ring-violet-500/25 dark:text-violet-300',
  hash: 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/25 dark:text-cyan-300',
  palette: 'bg-fuchsia-500/15 text-fuchsia-600 ring-fuchsia-500/25 dark:text-fuchsia-300',
  text: 'bg-slate-500/15 text-slate-600 ring-slate-400/25 dark:text-slate-300',
}

// ── Color utilities ────────────────────────────────────────────────────────
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const clean = hex.replace('#', '')
  const c =
    clean.length === 3
      ? clean
          .split('')
          .map(ch => ch + ch)
          .join('')
      : clean.slice(0, 6)
  if (c.length !== 6) return null
  const n = parseInt(c, 16)
  if (isNaN(n)) return null
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

// ── File-type icon dispatch ────────────────────────────────────────────────
type LucideIcon = typeof File
const FILE_ICONS: { exts: string[]; icon: LucideIcon; chip: string }[] = [
  {
    exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'],
    icon: Image,
    chip: 'bg-pink-500/15 text-pink-500',
  },
  {
    exts: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'],
    icon: Film,
    chip: 'bg-fuchsia-500/15 text-fuchsia-500',
  },
  {
    exts: ['mp3', 'aac', 'wav', 'flac', 'm4a', 'ogg'],
    icon: Music,
    chip: 'bg-amber-500/15 text-amber-500',
  },
  {
    exts: ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'],
    icon: Archive,
    chip: 'bg-orange-500/15 text-orange-500',
  },
  { exts: ['pdf'], icon: FileText, chip: 'bg-red-500/15 text-red-500' },
  {
    exts: [
      'js',
      'ts',
      'jsx',
      'tsx',
      'rs',
      'py',
      'go',
      'java',
      'c',
      'cpp',
      'cs',
      'rb',
      'php',
      'swift',
      'kt',
      'sh',
      'bash',
      'zsh',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'html',
      'css',
      'scss',
    ],
    icon: Code2,
    chip: 'bg-violet-500/15 text-violet-500',
  },
  {
    exts: ['txt', 'md', 'rtf', 'doc', 'docx', 'odt'],
    icon: FileText,
    chip: 'bg-sky-500/15 text-sky-500',
  },
]
const DEFAULT_FILE_CHIP = 'bg-slate-500/15 text-slate-500'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov', 'm4v'])
const SCROLL_AREA = 'custom-scrollbar h-full min-h-0 overflow-auto overscroll-contain'
const SECRET_KIND_KEYS = {
  aws_access_key: 'preview.secretKinds.awsAccessKey',
  github_token: 'preview.secretKinds.githubToken',
  stripe_key: 'preview.secretKinds.stripeKey',
  private_key: 'preview.secretKinds.privateKey',
  credential_assignment: 'preview.secretKinds.credentialAssignment',
  generic_token: 'preview.secretKinds.genericToken',
} as const

const iframeDocument = (html: string, theme: 'light' | 'dark', richText = false) => {
  const dark = theme === 'dark'
  const style = `<style data-clipsx-preview-theme>html{color-scheme:${theme}}html,body{${
    richText ? 'margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:13px;' : ''
  }background:transparent;color:${dark ? '#f1f5f9' : '#111827'}}a{color:#3b82f6}*{scrollbar-width:thin;scrollbar-color:${
    dark ? '#475569' : '#cbd5e1'
  } transparent}*::-webkit-scrollbar{width:8px;height:8px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:${
    dark ? '#475569' : '#cbd5e1'
  };border-radius:9999px}</style>`
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`
}

const getFileIcon = (name: string): { icon: LucideIcon; chip: string } => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  for (const { exts, icon, chip } of FILE_ICONS) {
    if (exts.includes(ext)) return { icon, chip }
  }
  return { icon: File, chip: DEFAULT_FILE_CHIP }
}

const TextBlock = ({ children }: { children: string }) => (
  <pre className={`${SCROLL_AREA} whitespace-pre-wrap p-4 text-sm leading-relaxed`}>{children}</pre>
)

const CopyableRow = ({
  label,
  value,
  clipId,
}: {
  label: string
  value: string
  clipId: string
}) => {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className="group flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-100/60 dark:hover:bg-white/5"
      onClick={() => {
        void copyLiteralText(value, clipId)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => undefined)
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-xs text-gray-700 dark:text-gray-300">
        <span className="truncate">{value}</span>
        {copied ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" />
        )}
      </span>
    </div>
  )
}

const LANG_CHIP_COLOR: Record<string, string> = {
  javascript: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  typescript: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  python: 'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  rust: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  go: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  java: 'bg-red-500/20 text-red-700 dark:text-red-300',
  json: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  html: 'bg-orange-400/20 text-orange-700 dark:text-orange-300',
  css: 'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  shell: 'bg-slate-500/20 text-slate-700 dark:text-slate-300',
  bash: 'bg-slate-500/20 text-slate-700 dark:text-slate-300',
  sql: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
}

const CodeView = ({ language, text }: { language: string | null; text: string }) => {
  const lines = text.split('\n')
  const chipColor =
    LANG_CHIP_COLOR[language?.toLowerCase() ?? ''] ?? 'bg-violet-500/15 text-violet-400'
  const words = text.trim().split(/\s+/).length
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 bg-slate-900/80 px-4 py-2">
        {language && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chipColor}`}>
            {language}
          </span>
        )}
        <span className="text-[10px] text-slate-400">{lines.length} lines</span>
        <span className="text-[10px] text-slate-500">{words} words</span>
      </div>
      <div className="custom-scrollbar flex min-h-0 flex-1 overflow-auto overscroll-contain bg-slate-950/90 font-mono text-sm">
        <div className="select-none border-r border-white/5 px-3 py-4 text-right text-slate-600">
          {lines.slice(0, 500).map((_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <pre className="p-4 text-gray-300">
          <code>{text}</code>
        </pre>
      </div>
    </div>
  )
}

const TableView = ({ columns, rows }: Extract<RenderModel, { kind: 'table' }>) => (
  <div className="flex h-full flex-col overflow-hidden">
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-white/10">
      <div className="rounded-lg bg-emerald-500/20 p-1 text-emerald-400">
        <FileSpreadsheet className="h-3.5 w-3.5" />
      </div>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-800">
        {rows.length} rows
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-800">
        {columns.length} cols
      </span>
    </div>
    <div className="custom-scrollbar flex-1 overflow-auto overscroll-contain">
      <table className="min-w-full border-collapse text-left text-sm whitespace-nowrap">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((column, index) => (
              <th
                className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 backdrop-blur dark:border-white/10 dark:bg-slate-800/95 dark:text-gray-400"
                key={`${index}:${column}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
            >
              {columns.map((_, columnIndex) => (
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300" key={columnIndex}>
                  {row[columnIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No rows</p>}
    </div>
  </div>
)

const TreeNode = ({ value }: { value: unknown }): ReactNode => {
  if (value === null) return <span className="text-gray-500">null</span>
  if (Array.isArray(value)) {
    return (
      <ol className="ml-5 list-decimal space-y-1">
        {value.map((item, index) => (
          <li key={index}>{TreeNode({ value: item })}</li>
        ))}
      </ol>
    )
  }
  if (typeof value === 'object') {
    return (
      <dl className="ml-3 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-700">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt className="inline font-semibold text-blue-700 dark:text-blue-300">{key}: </dt>
            <dd className="inline">{TreeNode({ value: item })}</dd>
          </div>
        ))}
      </dl>
    )
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>
  }
  return <span>Unsupported value</span>
}

const KeyValueView = ({ entries }: { entries: [string, string][] }) => (
  <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 p-4 text-sm">
    {entries.map(([key, value], index) => (
      <div className="contents" key={`${key}:${index}`}>
        <dt className="font-semibold text-gray-500">{key}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    ))}
  </dl>
)

const ImageView = ({ model }: { model: Extract<RenderModel, { kind: 'image' }> }) => {
  const { t } = useTranslation()
  const sourceKey =
    model.source.kind === 'managed'
      ? model.source.assetId
      : `${model.source.resultId}:${model.source.outputIndex}`
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null)
  const failed = failedAssetId === sourceKey
  const sourceUrl =
    model.source.kind === 'managed'
      ? managedAssetUrl(model.source.assetId)
      : transformImageUrl(model.source.resultId, model.source.outputIndex)

  return (
    <div
      className={`${SCROLL_AREA} flex items-center justify-center bg-slate-100/40 p-6 dark:bg-black/20`}
    >
      {failed ? (
        <div className="flex flex-col items-center gap-2 text-sm text-gray-500">
          <ImageOff className="h-8 w-8" />
          {t('preview.noImageSource')}
        </div>
      ) : (
        <img
          className="max-h-full max-w-full rounded object-contain"
          src={sourceUrl}
          alt="Clipboard image"
          onError={() => setFailedAssetId(sourceKey)}
        />
      )}
    </div>
  )
}

const FilesView = ({
  entries,
  clipId,
}: Extract<RenderModel, { kind: 'files' }> & { clipId: string }) => (
  <ul className="space-y-2 p-4">
    {entries.map((entry, index) => {
      const { icon: Icon, chip } = getFileIcon(entry.name)
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
      const isImage = IMAGE_EXTS.has(ext)
      const openFile = () => void invoke('open_clip_file', { clipId, path: entry.path })
      return (
        <li
          className="group flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-slate-50/40 p-3 transition-colors hover:border-blue-300/70 hover:bg-blue-50/40 dark:border-slate-700/60 dark:bg-slate-100/5 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/10"
          key={`${index}:${entry.path}`}
        >
          <div
            className="flex cursor-pointer items-center gap-3"
            onClick={openFile}
            role="button"
            tabIndex={0}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') openFile()
            }}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105 ${chip}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{entry.name}</div>
              <div className="break-all text-xs text-gray-500">{entry.path}</div>
            </div>
            <button
              aria-label={`Open ${entry.name}`}
              title="Open file"
              className="shrink-0 rounded p-2 text-gray-400 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-white/10"
              onClick={event => {
                event.stopPropagation()
                openFile()
              }}
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
          {isImage && <LocalFilePreview clipId={clipId} path={entry.path} name={entry.name} />}
        </li>
      )
    })}
  </ul>
)

const LocalFilePreview = ({
  clipId,
  path,
  name,
}: {
  clipId: string
  path: string
  name: string
}) => {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void invoke<string>('get_clip_file_preview', { clipId, path })
      .then(value => {
        if (active) setSource(value)
      })
      .catch(() => {
        if (active) setSource(null)
      })
    return () => {
      active = false
    }
  }, [clipId, path])
  if (!source) return null
  return (
    <div className="flex items-center justify-center overflow-hidden rounded-lg border border-slate-200/60 bg-slate-100/60 p-2 dark:border-white/5 dark:bg-black/20">
      <img alt={name} className="max-h-48 w-auto rounded object-contain" src={source} />
    </div>
  )
}

const semanticScalar = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null
}

const parseSemanticDate = (raw: string, interpretation: string | null): Date | null => {
  const numeric = Number(raw)
  const value =
    interpretation === 'unix_seconds' && Number.isFinite(numeric)
      ? numeric * 1000
      : interpretation === 'unix_milliseconds' && Number.isFinite(numeric)
        ? numeric
        : raw
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const CopyButton = ({
  text,
  clipId,
  className = '',
}: {
  text: string
  clipId: string
  className?: string
}) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    void copyLiteralText(text, clipId)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }
  return (
    <button
      title="Copy"
      className={`rounded p-1 text-gray-400 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 ${copied ? 'text-emerald-500' : ''} ${className}`}
      onClick={handleCopy}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// Extracted so it can hold its own copy-result state
const MathView = ({
  model,
  clipId,
}: {
  model: Extract<RenderModel, { kind: 'semantic' }>
  clipId: string
}) => {
  const result = semanticScalar(model.payload, 'result') ?? semanticScalar(model.payload, 'value')
  return (
    <div className={`${SCROLL_AREA} flex flex-col gap-px p-3`}>
      {/* Expression row */}
      <div className="flex items-center gap-2 rounded-lg bg-slate-100/60 px-3 py-2.5 dark:bg-white/5">
        <div className="shrink-0 rounded bg-indigo-500/20 p-1 text-indigo-400 ring-1 ring-indigo-500/30">
          <Calculator className="h-3.5 w-3.5" />
        </div>
        <code className="min-w-0 flex-1 break-all text-sm text-gray-700 dark:text-gray-300">
          {model.text}
        </code>
        <CopyButton text={model.text} clipId={clipId} />
      </div>
      {/* Result row */}
      {result !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2.5">
          <span className="shrink-0 text-[11px] font-semibold text-indigo-400">=</span>
          <code className="min-w-0 flex-1 break-all text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            {result}
          </code>
          <CopyButton text={result} clipId={clipId} />
        </div>
      )}
    </div>
  )
}

const SemanticView = ({
  model,
  kind,
  clipId,
}: {
  model: Extract<RenderModel, { kind: 'semantic' }>
  kind: string
  clipId: string
}) => {
  const [revealedSecretId, setRevealedSecretId] = useState<string | null>(null)
  const { t, i18n } = useTranslation()
  const secretId = `${clipId}:${model.facetId}:${model.text}`
  const revealed = revealedSecretId === secretId

  if (kind === 'url') {
    const href = semanticScalar(model.payload, 'href') ?? model.text
    let parsed: URL | null = null
    try {
      parsed = new URL(href)
    } catch {
      /* ignore malformed href */
    }
    const scheme =
      semanticScalar(model.payload, 'scheme') ?? parsed?.protocol.replace(':', '') ?? null
    const host = semanticScalar(model.payload, 'host') ?? parsed?.hostname ?? null
    const rawPath = semanticScalar(model.payload, 'path') ?? parsed?.pathname ?? null
    const path = rawPath && rawPath !== '/' ? rawPath : null
    const fragment = parsed?.hash ? parsed.hash.slice(1) : null
    const queryEntries: [string, string][] = parsed ? [...parsed.searchParams.entries()] : []
    const urlExt = (parsed?.pathname ?? href).split('.').pop()?.toLowerCase() ?? ''
    const isImageUrl = IMAGE_EXTS.has(urlExt)
    const isVideoUrl = VIDEO_EXTS.has(urlExt)
    return (
      <div className={`${SCROLL_AREA} flex flex-col gap-4 p-4`}>
        <button
          className="group rounded-xl border border-blue-500/20 bg-linear-to-br from-blue-500/10 to-cyan-500/10 p-4 text-left transition-all hover:border-blue-400/40 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
          onClick={() => void invoke('open_external_url', { url: href })}
        >
          <div className="flex items-start gap-3">
            <ExternalLink className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <div className="break-all text-sm font-medium text-gray-800 dark:text-gray-100">
                {href}
              </div>
              {host && <div className="mt-0.5 text-xs text-gray-500">{host}</div>}
            </div>
          </div>
        </button>
        {isImageUrl && (
          <div className="border-b border-slate-200/60 p-3 dark:border-white/5">
            <img
              alt="URL image preview"
              className="max-h-48 w-auto rounded-lg object-contain"
              src={href}
              onError={e => {
                const el = e.currentTarget.parentElement
                if (el) el.style.display = 'none'
              }}
            />
          </div>
        )}
        {isVideoUrl && (
          <div className="overflow-hidden rounded-lg bg-slate-100/60 dark:bg-black/20">
            <video className="max-h-64 w-full object-contain" controls src={href} />
          </div>
        )}
        <div className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            URL Structure
          </div>
          {scheme && <CopyableRow label="Protocol" value={scheme} clipId={clipId} />}
          {host && <CopyableRow label="Domain" value={host} clipId={clipId} />}
          {path && <CopyableRow label="Path" value={path} clipId={clipId} />}
          {fragment && <CopyableRow label="Fragment" value={`#${fragment}`} clipId={clipId} />}
          {queryEntries.map(([k, v]) => (
            <CopyableRow key={k} label={`?${k}`} value={v} clipId={clipId} />
          ))}
          {host && (
            <button
              className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs transition-colors hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
              onClick={() =>
                void invoke('open_external_url', {
                  url: `https://www.google.com/search?q=${encodeURIComponent(host)}`,
                })
              }
            >
              {t('preview.searchDomain', { domain: host })}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (kind === 'email') {
    const address = semanticScalar(model.payload, 'address') ?? model.text
    const atIdx = address.indexOf('@')
    const user = atIdx >= 0 ? address.slice(0, atIdx) : address
    const domain = atIdx >= 0 ? address.slice(atIdx + 1) : null
    const gravatarUrl = `https://www.gravatar.com/avatar/${address.toLowerCase().trim()}?d=mp&s=80`
    return (
      <div className={`${SCROLL_AREA} flex flex-col`}>
        <div
          className="group flex cursor-pointer items-center gap-3 border-b border-slate-200/60 p-5 transition-colors hover:bg-amber-500/5 dark:border-white/5"
          onClick={() => void invoke('compose_email', { address })}
        >
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-amber-500/20 ring-1 ring-amber-500/30">
            <img
              alt={user}
              className="h-full w-full object-cover"
              src={gravatarUrl}
              onError={e => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-1">
              <span className="text-base font-semibold text-gray-800 dark:text-gray-100">
                {user}
              </span>
              {domain && (
                <>
                  <AtSign className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="text-sm text-amber-600 dark:text-amber-300">{domain}</span>
                </>
              )}
            </div>
            <span className="text-xs text-gray-500">Click to compose email</span>
          </div>
          <Send className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-amber-500" />
        </div>
        <div className="p-3">
          {domain && <CopyableRow label="Domain" value={domain} clipId={clipId} />}
          <CopyableRow label="Full" value={address} clipId={clipId} />
        </div>
      </div>
    )
  }

  if (kind === 'color') {
    const hex = semanticScalar(model.payload, 'hex')
    const safeHex = hex && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? hex : null
    const rgb = safeHex ? hexToRgb(safeHex) : null
    const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null
    const rgbStr = rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : null
    const hslStr = hsl ? `hsl(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)` : null
    const hasAlpha = safeHex?.length === 9
    const colorValue = safeHex ?? model.text
    return (
      <div className={`${SCROLL_AREA} flex flex-col`}>
        {/* Full-width swatch */}
        <div className="relative border-b border-slate-200/60 dark:border-white/5">
          {hasAlpha && (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)',
                backgroundSize: '20px 20px',
              }}
            />
          )}
          <div className="relative h-24 w-full" style={{ backgroundColor: colorValue }} />
        </div>
        {/* Hex label */}
        <div className="flex items-center gap-3 border-b border-slate-200/60 px-5 py-3 dark:border-white/5">
          {safeHex && (
            <div
              aria-label={`Color ${safeHex}`}
              className="h-8 w-8 shrink-0 rounded-lg border border-black/10 shadow-inner dark:border-white/10"
              style={{ backgroundColor: safeHex }}
            />
          )}
          <code className="text-lg font-semibold">{safeHex ?? model.text}</code>
        </div>
        {(safeHex || rgbStr || hslStr) && (
          <div className="p-2">
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Formats
            </div>
            {safeHex && <CopyableRow label="HEX" value={safeHex.toUpperCase()} clipId={clipId} />}
            {rgbStr && <CopyableRow label="RGB" value={rgbStr} clipId={clipId} />}
            {hslStr && <CopyableRow label="HSL" value={hslStr} clipId={clipId} />}
          </div>
        )}
      </div>
    )
  }

  if (kind === 'phone') {
    const number = semanticScalar(model.payload, 'display') ?? model.text
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-6">
          <Phone className="h-8 w-8 text-emerald-500" />
          <span className="font-mono text-2xl font-semibold">{number}</span>
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() => void invoke('start_phone_action', { number, message: false })}
          >
            <Phone className="h-4 w-4" /> Call
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() => void invoke('start_phone_action', { number, message: true })}
          >
            <MessageSquare className="h-4 w-4" /> SMS
          </button>
        </div>
      </div>
    )
  }

  if (kind === 'path') {
    const path = semanticScalar(model.payload, 'path') ?? model.text
    const separator = path.includes('/') ? '/' : '\\'
    const parts = path.split(separator)
    const filename = parts[parts.length - 1] ?? ''
    const dir = parts.length > 1 ? parts.slice(0, -1).join(separator) + separator : separator
    return (
      <div className={`${SCROLL_AREA} flex flex-col`}>
        <div className="flex items-center gap-3 border-b border-slate-200/60 px-4 py-3 dark:border-white/5">
          <div className="rounded-lg bg-amber-500/20 p-2 text-amber-500 ring-1 ring-amber-500/30 shrink-0">
            <FolderOpen className="h-4 w-4" />
          </div>
          <code className="min-w-0 break-all text-sm flex-1">{path}</code>
          <button
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            onClick={() => void invoke('open_detected_path', { clipId, path })}
          >
            Open
          </button>
        </div>
        <div className="p-2">
          <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Components
          </div>
          <CopyableRow label="Full path" value={path} clipId={clipId} />
          <CopyableRow label="Directory" value={dir} clipId={clipId} />
          {filename && <CopyableRow label="File name" value={filename} clipId={clipId} />}
        </div>
      </div>
    )
  }

  if (kind === 'secret') {
    const secretKind =
      semanticScalar(model.payload, 'kind') ?? semanticScalar(model.payload, 'format') ?? 'secret'
    const secretKindKey = SECRET_KIND_KEYS[secretKind as keyof typeof SECRET_KIND_KEYS]
    const secretKindLabel = secretKindKey ? t(secretKindKey) : secretKind.replaceAll('_', ' ')
    return (
      <div className={`${SCROLL_AREA} p-4`}>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/20 bg-linear-to-br from-red-500/10 to-rose-500/10 p-5">
          <div className="rounded-full bg-red-500/20 p-3 text-red-400 ring-1 ring-red-500/30">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">
            {t('preview.sensitiveDetected')}
          </span>
          <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
            {secretKindLabel}
          </span>
          <p className="max-w-xs text-center text-xs text-gray-500 dark:text-gray-400">
            {t('preview.sensitiveDescription')}
          </p>
        </div>
        <div className="mt-4 rounded-lg bg-slate-100/70 p-3 dark:bg-black/20">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {t('preview.value')}
          </span>
          <code className="block max-w-full select-none break-all font-mono text-sm text-gray-700 dark:text-gray-300">
            {revealed
              ? model.text
              : model.text.length > 12
                ? `${model.text.slice(0, 4)}${'•'.repeat(Math.min(model.text.length - 8, 32))}${model.text.slice(-4)}`
                : '•'.repeat(model.text.length)}
          </code>
          <button
            aria-label={revealed ? t('preview.hideSecret') : t('preview.revealSecret')}
            className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors hover:bg-white/70 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() => setRevealedSecretId(value => (value === secretId ? null : secretId))}
          >
            {revealed ? t('preview.hideSecret') : t('preview.revealSecret')}
          </button>
        </div>
      </div>
    )
  }

  if (kind === 'code') {
    return <CodeView language={semanticScalar(model.payload, 'language')} text={model.text} />
  }

  if (kind === 'math') {
    return <MathView model={model} clipId={clipId} />
  }

  if (kind === 'date' || kind === 'timestamp') {
    const raw = semanticScalar(model.payload, 'value') ?? model.text
    const interpretation = semanticScalar(model.payload, 'interpretation')
    const parsed = parseSemanticDate(raw, interpretation)
    const DateIcon = kind === 'date' ? CalendarDays : Clock
    const locale = i18n.resolvedLanguage
    const month = parsed?.toLocaleDateString(locale, { month: 'short' }).toUpperCase()
    const day = parsed?.toLocaleDateString(locale, { day: '2-digit' })
    const year = parsed?.toLocaleDateString(locale, { year: 'numeric' })
    return (
      <div className={`${SCROLL_AREA} p-3`}>
        <div className="overflow-hidden rounded-2xl border border-sky-500/20 bg-linear-to-br from-sky-500/[0.09] via-white/70 to-indigo-500/[0.08] shadow-[0_16px_40px_-28px_rgba(14,165,233,0.8)] dark:via-white/[0.035]">
          <div className="flex items-center gap-2 border-b border-sky-500/15 px-3 py-2">
            <div className="shrink-0 rounded-lg bg-sky-500/15 p-1.5 text-sky-600 ring-1 ring-sky-500/25 dark:text-sky-300">
              <DateIcon className="h-3.5 w-3.5" />
            </div>
            <code className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
              {raw}
            </code>
            <CopyButton text={raw} clipId={clipId} />
          </div>
          {parsed ? (
            <>
              <div className="grid grid-cols-[5.5rem_1fr] items-stretch">
                <div className="flex flex-col items-center justify-center border-r border-sky-500/15 bg-sky-500/[0.07] px-3 py-4 tabular-nums">
                  <span className="text-[10px] font-bold tracking-[0.2em] text-sky-600 dark:text-sky-300">
                    {month}
                  </span>
                  <span className="text-3xl font-semibold leading-none tracking-tight text-slate-800 dark:text-white">
                    {day}
                  </span>
                  <span className="mt-1 text-[10px] text-slate-500">{year}</span>
                </div>
                <div className="flex min-w-0 flex-col justify-center px-4 py-3">
                  <span className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                    {parsed.toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500">
                    {parsed.toLocaleDateString(locale, { weekday: 'long' })}
                  </span>
                </div>
              </div>
              <div className="border-t border-sky-500/15 p-2">
                <CopyableRow label="Local" value={parsed.toLocaleString(locale)} clipId={clipId} />
                <CopyableRow label="ISO 8601" value={parsed.toISOString()} clipId={clipId} />
                <CopyableRow
                  label="Unix seconds"
                  value={String(Math.floor(parsed.getTime() / 1000))}
                  clipId={clipId}
                />
                <CopyableRow label="UTC" value={parsed.toUTCString()} clipId={clipId} />
              </div>
            </>
          ) : (
            <div className="px-4 py-5 text-center text-sm text-slate-500">
              This date could not be interpreted.
            </div>
          )}
        </div>
      </div>
    )
  }

  const entries = Object.entries(model.payload).flatMap(([key, value]) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      return [[key, String(value)] as [string, string]]
    return []
  })
  return (
    <div className={SCROLL_AREA}>
      <div className="border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10">
        {kind}
      </div>
      {entries.length > 0 ? (
        <KeyValueView entries={entries} />
      ) : (
        <TextBlock>{model.text}</TextBlock>
      )}
    </div>
  )
}

const markdownChildrenToText = (children: ReactNode): string =>
  Array.isArray(children)
    ? children.map(markdownChildrenToText).join('')
    : typeof children === 'string'
      ? children
      : ''

const MarkdownView = ({ markdown }: { markdown: string }) => {
  const components = useMemo(
    () => ({
      pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
      h1: ({ children }: ComponentPropsWithoutRef<'h1'>) => (
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-50">
          {children}
        </h1>
      ),
      h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
        <h2 className="mt-5 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-50">
          {children}
        </h2>
      ),
      h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
        <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-gray-100">
          {children}
        </h3>
      ),
      p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
        <p className="text-sm leading-7 text-gray-800 dark:text-gray-200">{children}</p>
      ),
      ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800 dark:text-gray-200">
          {children}
        </ul>
      ),
      ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-800 dark:text-gray-200">
          {children}
        </ol>
      ),
      li: ({ children }: ComponentPropsWithoutRef<'li'>) => <li className="pl-0.5">{children}</li>,
      blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote className="border-l-4 border-sky-300/80 bg-sky-50/60 px-4 py-2 italic text-gray-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-gray-200">
          {children}
        </blockquote>
      ),
      a: ({ children, href }: ComponentPropsWithoutRef<'a'>) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-sky-700 underline decoration-sky-400/60 underline-offset-4 dark:text-sky-300"
        >
          {children}
        </a>
      ),
      table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
          <table className="min-w-full border-collapse bg-white/70 text-sm dark:bg-black/20">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: ComponentPropsWithoutRef<'thead'>) => (
        <thead className="bg-slate-100/80 dark:bg-white/5">{children}</thead>
      ),
      th: ({ children }: ComponentPropsWithoutRef<'th'>) => (
        <th className="border-b border-slate-200/80 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-white/10 dark:text-gray-400">
          {children}
        </th>
      ),
      td: ({ children }: ComponentPropsWithoutRef<'td'>) => (
        <td className="border-t border-slate-100 px-3 py-2 text-gray-700 dark:border-white/5 dark:text-gray-200">
          {children}
        </td>
      ),
      code: ({
        className,
        children,
        inline,
        ...rest
      }: ComponentPropsWithoutRef<'code'> & { inline?: boolean }) => {
        const language = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase()
        const code = markdownChildrenToText(children).replace(/\n$/, '')
        if (inline || !language) {
          return (
            <code
              {...rest}
              className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[0.92em] text-fuchsia-700 dark:bg-white/10 dark:text-fuchsia-200"
            >
              {children}
            </code>
          )
        }
        return (
          <pre className="overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-sm dark:border-white/10">
            <code {...rest} className={className}>
              {code}
            </code>
          </pre>
        )
      },
    }),
    []
  )

  return (
    <div className={`${SCROLL_AREA} px-4 py-4`}>
      <div className="space-y-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  )
}

const JsonView = ({ value }: { value: unknown }) => {
  const jsonText = JSON.stringify(value, null, 2)
  const keyCount = Array.isArray(value)
    ? (value as unknown[]).length
    : value !== null && typeof value === 'object'
      ? Object.keys(value as Record<string, unknown>).length
      : null
  const label = Array.isArray(value) ? 'items' : 'keys'
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-white/10">
        <div className="rounded-lg bg-emerald-500/20 p-1 text-emerald-500">
          <Braces className="h-3.5 w-3.5" />
        </div>
        {keyCount !== null && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-800">
            {keyCount} {label}
          </span>
        )}
      </div>
      <div className="custom-scrollbar flex-1 overflow-auto overscroll-contain">
        <pre className="p-4 font-mono text-sm text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap break-words">
          {jsonText}
        </pre>
      </div>
    </div>
  )
}

export const RenderModelView = ({ presentation }: { presentation: ClipPresentation }) => {
  const model = presentation.model
  const appliedTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  switch (model.kind) {
    case 'text':
      return <TextBlock>{model.text}</TextBlock>
    case 'code':
      return <CodeView language={model.language} text={model.text} />
    case 'markdown':
      return <MarkdownView markdown={model.markdown} />
    case 'table':
      return <TableView {...model} />
    case 'tree':
      if (presentation.activeView.presentationKind === 'json') {
        return <JsonView value={model.value} />
      }
      return (
        <div className={`${SCROLL_AREA} p-4 font-mono text-sm`}>
          {TreeNode({ value: model.value })}
        </div>
      )
    case 'key_value':
      return (
        <div className={SCROLL_AREA}>
          <KeyValueView entries={model.entries} />
        </div>
      )
    case 'card': {
      const leading = model.leading
      const swatch =
        leading.kind === 'swatch'
          ? `rgba(${leading.red}, ${leading.green}, ${leading.blue}, ${leading.alpha / 255})`
          : null
      const iconName = leading.kind === 'host_icon' ? leading.name : 'file'
      const CardIcon = CARD_HOST_ICONS[iconName] ?? File
      const iconTint = CARD_ICON_TINTS[iconName] ?? CARD_ICON_TINTS['text']
      return (
        <div className={`${SCROLL_AREA} p-3`}>
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/90 via-white/70 to-violet-50/55 shadow-[0_10px_35px_-22px_rgba(79,70,229,0.55)] backdrop-blur-sm dark:border-white/10 dark:from-white/[0.07] dark:via-white/[0.035] dark:to-violet-500/[0.055]">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/70 to-transparent" />
            <div className="flex items-center gap-2 border-b border-slate-200/60 px-3 py-2 dark:border-white/10">
              {swatch && (
                <div
                  aria-label={model.title}
                  className="h-7 w-7 shrink-0 rounded-full border border-black/15 shadow-inner dark:border-white/25"
                  style={{ backgroundColor: swatch }}
                />
              )}
              {leading.kind === 'monogram' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold dark:bg-slate-700">
                  {leading.text}
                </div>
              )}
              {leading.kind === 'host_icon' && (
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 shadow-sm ${iconTint}`}
                >
                  <CardIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0">
                <h3 className="truncate text-xs font-semibold tracking-tight">{model.title}</h3>
                {model.subtitle && (
                  <p className="truncate text-[10px] text-gray-500">{model.subtitle}</p>
                )}
              </div>
            </div>
            {model.fields.length > 0 && (
              <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
                {model.fields.map(([label, value], index) => {
                  const spansFinalRow =
                    model.fields.length > 1 &&
                    model.fields.length % 2 === 1 &&
                    index === model.fields.length - 1
                  return (
                    <div
                      className={`group relative min-w-0 overflow-hidden rounded-xl border border-slate-200/70 bg-gradient-to-br from-white/80 to-slate-50/60 px-3 py-2 shadow-sm transition-colors hover:border-violet-300/60 dark:border-white/10 dark:from-white/[0.055] dark:to-white/[0.025] dark:hover:border-violet-400/25 ${spansFinalRow ? 'sm:col-span-2' : ''}`}
                      key={`${label}:${index}`}
                    >
                      <div className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/35 to-transparent" />
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          {label}
                        </div>
                        <CopyButton
                          className="-mr-1 -mt-0.5 opacity-60 group-hover:opacity-100"
                          clipId={presentation.id}
                          text={value}
                        />
                      </div>
                      <div className="custom-scrollbar mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
                        {value}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )
    }
    case 'image':
      return <ImageView model={model} />
    case 'html':
      return model.sanitizedHtml ? (
        <iframe
          allowTransparency={true}
          className="h-full min-h-56 w-full"
          sandbox="allow-same-origin"
          srcDoc={iframeDocument(model.sanitizedHtml, appliedTheme)}
          title="HTML preview"
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
          No renderable HTML content.
        </div>
      )
    case 'rich_text':
      return model.sanitizedHtml ? (
        <iframe
          allowTransparency={true}
          className="h-full min-h-56 w-full"
          sandbox="allow-same-origin"
          srcDoc={iframeDocument(model.sanitizedHtml, appliedTheme, true)}
          title="Rich text preview"
        />
      ) : (
        <TextBlock>{model.plainText}</TextBlock>
      )
    case 'files':
      return (
        <div className={SCROLL_AREA}>
          <FilesView {...model} clipId={presentation.id} />
        </div>
      )
    case 'document':
      return (
        <object
          className="h-full w-full bg-white"
          data={managedAssetUrl(model.assetId)}
          type={model.mimeType}
        >
          <p className="p-4 text-sm">Document preview unavailable.</p>
        </object>
      )
    case 'semantic':
      return (
        <SemanticView
          model={model}
          kind={presentation.activeView.presentationKind}
          clipId={presentation.id}
        />
      )
    case 'unsupported':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <FileQuestion className="h-9 w-9 text-gray-400" />
          <strong className="text-sm">Unsupported preview</strong>
          <span className="text-xs text-gray-500">
            {model.mimeType ?? model.nativeType ?? model.formatKey} ·{' '}
            {model.byteLength.toLocaleString()} bytes
          </span>
          <span className="text-xs text-gray-400">
            The original representation remains available for copy and paste.
          </span>
        </div>
      )
    case 'error':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-red-600">
          <ImageOff className="h-8 w-8" />
          {model.message}
        </div>
      )
    default:
      return assertNever(model)
  }
}
