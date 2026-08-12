import { invoke } from '@tauri-apps/api/core'
import {
  AtSign,
  ExternalLink,
  FileQuestion,
  FileText,
  FolderOpen,
  ImageOff,
  KeyRound,
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

const TextBlock = ({ children }: { children: string }) => (
  <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-sm leading-relaxed">
    {children}
  </pre>
)

const CodeView = ({ language, text }: { language: string | null; text: string }) => {
  const lines = text.split('\n')
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-2 text-xs text-gray-500 dark:border-white/10">
        {language ?? 'text'} · {lines.length} lines
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto bg-white/60 font-mono text-sm dark:bg-black/30">
        <div className="select-none border-r border-slate-200 px-2 py-4 text-right text-gray-400 dark:border-white/10">
          {lines.slice(0, 500).map((_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <pre className="p-4">
          <code>{text}</code>
        </pre>
      </div>
    </div>
  )
}

const TableView = ({ columns, rows }: Extract<RenderModel, { kind: 'table' }>) => (
  <div className="h-full overflow-auto p-4">
    <table className="min-w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              className="border border-slate-300 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
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
    {entries.map((entry, index) => (
      <li
        className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        key={`${index}:${entry.path}`}
      >
        <FileText className="h-5 w-5 shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{entry.name}</div>
          <div className="break-all text-xs text-gray-500">{entry.path}</div>
        </div>
        <button
          aria-label={`Open ${entry.name}`}
          className="rounded p-2 hover:bg-slate-100 dark:hover:bg-white/10"
          onClick={() => void invoke('open_clip_file', { path: entry.path })}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </li>
    ))}
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
    const host = semanticScalar(model.payload, 'host')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <ExternalLink className="h-10 w-10 text-blue-500" />
        <a
          className="max-w-full break-all text-lg text-blue-600 underline"
          href={href}
          onClick={event => {
            event.preventDefault()
            void invoke('open_external_url', { url: href })
          }}
        >
          {href}
        </a>
        {host && <span className="text-sm text-gray-500">{host}</span>}
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <Palette className="h-8 w-8 text-gray-400" />
        {safeHex && (
          <div
            aria-label={`Color ${safeHex}`}
            className="h-32 w-32 rounded-2xl border shadow-inner"
            style={{ backgroundColor: safeHex }}
          />
        )}
        <code className="text-lg">{safeHex ?? model.text}</code>
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <FolderOpen className="h-10 w-10 text-amber-500" />
        <code className="max-w-full break-all">{path}</code>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={() => void invoke('open_detected_path', { clipId, path })}
        >
          Open
        </button>
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
          className="h-full min-h-56 w-full bg-white"
          sandbox=""
          srcDoc={model.sanitizedHtml}
          title="HTML preview"
        />
      )
    case 'rich_text':
      return model.sanitizedHtml ? (
        <iframe
          className="h-full min-h-56 w-full bg-white"
          sandbox=""
          srcDoc={model.sanitizedHtml}
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
