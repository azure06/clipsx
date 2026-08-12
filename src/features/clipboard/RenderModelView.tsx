import { invoke } from '@tauri-apps/api/core'
import {
  Archive,
  AtSign,
  Calculator,
  Check,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  File,
  FileQuestion,
  FileText,
  Film,
  FolderOpen,
  Image,
  ImageOff,
  KeyRound,
  Music,
  Palette,
  Phone,
  RotateCw,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useState, type ReactNode } from 'react'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'

const assetUrl = (id: string) => `clipsx-asset://localhost/${id}`

const assertNever = (value: never): never => {
  throw new Error(`Unhandled render model: ${JSON.stringify(value)}`)
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
const FILE_ICONS: { exts: string[]; icon: LucideIcon }[] = [
  { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'], icon: Image },
  { exts: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'], icon: Film },
  { exts: ['mp3', 'aac', 'wav', 'flac', 'm4a', 'ogg'], icon: Music },
  { exts: ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'], icon: Archive },
  { exts: ['pdf'], icon: FileText },
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
  },
  { exts: ['txt', 'md', 'rtf', 'doc', 'docx', 'odt'], icon: FileText },
]

const getFileIcon = (name: string): LucideIcon => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  for (const { exts, icon } of FILE_ICONS) {
    if (exts.includes(ext)) return icon
  }
  return File
}

const TextBlock = ({ children }: { children: string }) => (
  <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-sm leading-relaxed">
    {children}
  </pre>
)

const CopyableRow = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className="group flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-100/60 dark:hover:bg-white/5"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
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
      <div className="flex min-h-0 flex-1 overflow-auto bg-slate-950/90 font-mono text-sm">
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
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-800">
        {rows.length} rows
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-800">
        {columns.length} cols
      </span>
    </div>
    <div className="flex-1 overflow-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((column, index) => (
              <th
                className="border border-slate-300 bg-slate-100/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95"
                key={`${index}:${column}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((_, columnIndex) => (
                <td
                  className="border border-slate-200 px-3 py-2 align-top dark:border-slate-800"
                  key={columnIndex}
                >
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

const ImageView = ({
  model,
  retrying,
  onRetryOcr,
}: {
  model: Extract<RenderModel, { kind: 'image' }>
  retrying: boolean
  onRetryOcr: () => void
}) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100/40 p-6 dark:bg-black/20">
      <img
        className="max-h-full max-w-full rounded object-contain"
        src={assetUrl(model.assetId)}
        alt="Clipboard image"
      />
    </div>
    <div className="border-t border-slate-200 p-3 text-xs dark:border-white/10">
      {model.ocr.state === 'disabled' && <span>Text recognition is disabled.</span>}
      {model.ocr.state === 'pending' && <span>Text recognition is queued.</span>}
      {model.ocr.state === 'running' && <span>Text recognition is running…</span>}
      {model.ocr.state === 'unsupported' && (
        <span>Text recognition is unavailable on this platform.</span>
      )}
      {model.ocr.state === 'failed' && (
        <div className="flex items-center justify-between gap-3">
          <span>{model.ocr.message}</span>
          <button
            className="flex items-center gap-1 rounded border px-2 py-1"
            disabled={retrying}
            onClick={onRetryOcr}
          >
            <RotateCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}
      {model.ocr.state === 'ready' &&
        (model.ocr.text.trim() ? (
          <TextBlock>{model.ocr.text}</TextBlock>
        ) : (
          <span>No text found.</span>
        ))}
    </div>
  </div>
)

const FilesView = ({ entries }: Extract<RenderModel, { kind: 'files' }>) => (
  <ul className="space-y-2 p-4">
    {entries.map((entry, index) => {
      const Icon = getFileIcon(entry.name)
      return (
        <li
          className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-slate-50/40 p-3 dark:border-slate-700/60 dark:bg-slate-100/5"
          key={`${index}:${entry.path}`}
        >
          <Icon className="h-5 w-5 shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{entry.name}</div>
            <div className="break-all text-xs text-gray-500">{entry.path}</div>
          </div>
          <button
            aria-label={`Open ${entry.name}`}
            title="Open in Finder"
            className="rounded p-2 text-gray-400 hover:bg-slate-100 hover:text-gray-700 dark:hover:bg-white/10 transition-colors"
            onClick={() => void invoke('open_clip_file', { path: entry.path })}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </li>
      )
    })}
  </ul>
)

const semanticScalar = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null
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
  const [revealed, setRevealed] = useState(false)
  if (kind === 'url') {
    const href = semanticScalar(model.payload, 'href') ?? model.text
    // The Rust detector only stores href/host/path — parse client-side for scheme/query/fragment.
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
    return (
      <div className="flex h-full flex-col gap-0 overflow-auto">
        <div className="flex items-start gap-4 border-b border-slate-200/60 bg-linear-to-r from-blue-500/5 to-cyan-500/5 p-5 dark:border-white/5">
          <ExternalLink className="mt-0.5 h-6 w-6 shrink-0 text-blue-500" />
          <div className="min-w-0 flex-1">
            <a
              className="break-all text-sm font-medium text-blue-600 underline dark:text-blue-400"
              href={href}
              onClick={event => {
                event.preventDefault()
                void invoke('open_external_url', { url: href })
              }}
            >
              {href}
            </a>
            {host && <div className="mt-0.5 text-xs text-gray-500">{host}</div>}
          </div>
        </div>
        <div className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            URL Structure
          </div>
          {scheme && <CopyableRow label="Protocol" value={scheme} />}
          {host && <CopyableRow label="Domain" value={host} />}
          {path && <CopyableRow label="Path" value={path} />}
          {fragment && <CopyableRow label="Fragment" value={`#${fragment}`} />}
          {queryEntries.map(([k, v]) => (
            <CopyableRow key={k} label={`?${k}`} value={v} />
          ))}
        </div>
      </div>
    )
  }
  if (kind === 'email') {
    const address = semanticScalar(model.payload, 'address') ?? model.text
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <AtSign className="h-10 w-10 text-violet-500" />
        <button
          className="break-all text-lg text-blue-600 underline"
          onClick={() => void invoke('compose_email', { address })}
        >
          {address}
        </button>
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
    return (
      <div className="flex h-full flex-col overflow-auto">
        <div className="flex items-center gap-4 border-b border-slate-200/60 p-5 dark:border-white/5">
          {safeHex ? (
            <div
              aria-label={`Color ${safeHex}`}
              className="h-16 w-16 shrink-0 rounded-2xl border border-black/10 shadow-inner dark:border-white/10"
              style={{ backgroundColor: safeHex }}
            />
          ) : (
            <Palette className="h-10 w-10 text-gray-400" />
          )}
          <code className="text-lg font-semibold">{safeHex ?? model.text}</code>
        </div>
        {(safeHex || rgbStr || hslStr) && (
          <div className="p-2">
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Formats
            </div>
            {safeHex && <CopyableRow label="HEX" value={safeHex.toUpperCase()} />}
            {rgbStr && <CopyableRow label="RGB" value={rgbStr} />}
            {hslStr && <CopyableRow label="HSL" value={hslStr} />}
          </div>
        )}
      </div>
    )
  }
  if (kind === 'phone') {
    const number = semanticScalar(model.payload, 'display') ?? model.text
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <Phone className="h-10 w-10 text-emerald-500" />
        <span className="text-xl">{number}</span>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={() => void invoke('start_phone_action', { number, message: false })}
        >
          Call
        </button>
      </div>
    )
  }
  if (kind === 'path') {
    const path = semanticScalar(model.payload, 'path') ?? model.text
    const separator = path.includes('/') ? '/' : '\\'
    const parts = path.split(separator)
    const filename = parts.at(-1) ?? ''
    const dir = parts.length > 1 ? parts.slice(0, -1).join(separator) + separator : separator
    return (
      <div className="flex h-full flex-col overflow-auto">
        <div className="flex items-center gap-3 border-b border-slate-200/60 p-5 dark:border-white/5">
          <FolderOpen className="h-8 w-8 shrink-0 text-amber-500" />
          <code className="min-w-0 break-all text-sm">{path}</code>
        </div>
        <div className="p-2">
          <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Components
          </div>
          <CopyableRow label="Full path" value={path} />
          <CopyableRow label="Directory" value={dir} />
          {filename && <CopyableRow label="File name" value={filename} />}
        </div>
        <div className="px-3 pt-1">
          <button
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-slate-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5 transition-colors"
            onClick={() => void invoke('open_detected_path', { clipId, path })}
          >
            Open in Finder
          </button>
        </div>
      </div>
    )
  }
  if (kind === 'jwt') {
    return (
      <div className="h-full overflow-auto p-4">
        <h3 className="mb-2 font-semibold">Header</h3>
        {TreeNode({ value: model.payload['header'] })}
        <h3 className="mb-2 mt-4 font-semibold">Claims</h3>
        {TreeNode({ value: model.payload['claims'] })}
      </div>
    )
  }
  if (kind === 'secret') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <KeyRound className="h-10 w-10 text-red-400" />
        <code className="max-w-full break-all rounded bg-slate-100 p-3 dark:bg-slate-900">
          {revealed ? model.text : '•'.repeat(Math.min(model.text.length, 48))}
        </code>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={() => setRevealed(value => !value)}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      </div>
    )
  }
  if (kind === 'code') {
    return <CodeView language={semanticScalar(model.payload, 'language')} text={model.text} />
  }
  if (kind === 'math') {
    const result = semanticScalar(model.payload, 'result') ?? semanticScalar(model.payload, 'value')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <Calculator className="h-8 w-8 text-indigo-400" />
        <code className="rounded-xl bg-slate-100/60 px-4 py-2 text-lg dark:bg-slate-100/10">
          {model.text}
        </code>
        {result && result !== model.text && (
          <div className="text-sm text-gray-500">
            = <code className="text-xl font-bold text-gray-800 dark:text-gray-200">{result}</code>
          </div>
        )}
      </div>
    )
  }
  if (kind === 'date' || kind === 'timestamp') {
    const raw = model.text
    const parsed = new Date(raw)
    const valid = !isNaN(parsed.getTime())
    return (
      <div className="flex h-full flex-col overflow-auto">
        <div className="flex items-center gap-3 border-b border-slate-200/60 p-5 dark:border-white/5">
          <Clock className="h-7 w-7 shrink-0 text-yellow-500" />
          <code className="min-w-0 break-all text-sm">{raw}</code>
        </div>
        {valid && (
          <div className="p-2">
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Formats
            </div>
            <CopyableRow label="Local" value={parsed.toLocaleString()} />
            <CopyableRow label="ISO 8601" value={parsed.toISOString()} />
            <CopyableRow label="Unix epoch" value={String(Math.floor(parsed.getTime() / 1000))} />
          </div>
        )}
      </div>
    )
  }
  const entries = Object.entries(model.payload).flatMap(([key, value]) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      return [[key, String(value)] as [string, string]]
    return []
  })
  return (
    <div className="h-full overflow-auto">
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

export const RenderModelView = ({
  presentation,
  retryingOcr = false,
  onRetryOcr = () => undefined,
}: {
  presentation: ClipPresentation
  retryingOcr?: boolean
  onRetryOcr?: () => void
}) => {
  const model = presentation.model
  switch (model.kind) {
    case 'text':
      return <TextBlock>{model.text}</TextBlock>
    case 'code':
      return <CodeView language={model.language} text={model.text} />
    case 'markdown':
      return (
        <div className="prose prose-sm max-w-none p-4 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {model.markdown}
          </ReactMarkdown>
        </div>
      )
    case 'table':
      return <TableView {...model} />
    case 'tree':
      return <div className="p-4 font-mono text-sm">{TreeNode({ value: model.value })}</div>
    case 'key_value':
      return <KeyValueView entries={model.entries} />
    case 'image':
      return <ImageView model={model} retrying={retryingOcr} onRetryOcr={onRetryOcr} />
    case 'html':
      return (
        <iframe
          className="h-full min-h-56 w-full"
          sandbox=""
          srcDoc={`<style>html,body{margin:0;padding:12px;background:transparent;color:inherit;font-family:system-ui,sans-serif;font-size:13px}</style>${model.sanitizedHtml}`}
          title="HTML preview"
        />
      )
    case 'rich_text':
      return model.sanitizedHtml ? (
        <iframe
          className="h-full min-h-56 w-full"
          sandbox=""
          srcDoc={`<style>html,body{margin:0;padding:12px;background:transparent;color:inherit;font-family:system-ui,sans-serif;font-size:13px}</style>${model.sanitizedHtml}`}
          title="Rich text preview"
        />
      ) : (
        <TextBlock>{model.plainText}</TextBlock>
      )
    case 'files':
      return <FilesView {...model} />
    case 'document':
      return (
        <object
          className="h-full w-full bg-white"
          data={assetUrl(model.assetId)}
          type={model.mimeType}
        >
          <p className="p-4 text-sm">Document preview unavailable.</p>
        </object>
      )
    case 'office':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <FileText className="h-10 w-10 text-blue-400" />
          <strong>Office/native representation</strong>
          <span className="text-xs text-gray-500">
            {model.nativeType ?? model.formatKey} · {model.byteLength.toLocaleString()} bytes
          </span>
          <span className="text-xs text-gray-400">
            Choose a formatted alternate above when available. Original copy preserves this
            representation.
          </span>
        </div>
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
