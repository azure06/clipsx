import { Pin, Sparkles, X } from 'lucide-react'
import { ExtensionIcon } from './ClipActionsToolbar'
import type { ContextAction, Transformer } from './useTransformState'

const panelItemClass =
  'flex min-w-0 items-center rounded-lg px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-violet-500/10 hover:text-violet-700 focus-visible:bg-violet-500/10 focus-visible:text-violet-700 dark:hover:bg-violet-500/15 dark:hover:text-violet-200 dark:focus-visible:bg-violet-500/15 dark:focus-visible:text-violet-200'

const formatTokens = ['BASE64', 'JSON', 'CSV', 'TSV', 'YAML', 'TOML', 'MARKDOWN', 'URL', 'JWT']

const operationMonogram = (label: string) => {
  const upper = label.toUpperCase()
  const format = formatTokens.find(token => new RegExp(`\\b${token}\\b`).test(upper))
  if (format) return format === 'MARKDOWN' ? 'MD' : format === 'BASE64' ? 'B64' : format
  if (/\bTYPESCRIPT\b/.test(upper)) return 'TS'
  const word = label
    .split(/[^a-z0-9]+/i)
    .find(
      value =>
        value &&
        !['convert', 'encode', 'decode', 'format', 'generate', 'normalize', 'to', 'from'].includes(
          value.toLowerCase()
        )
    )
  return (word ?? label).slice(0, 2).toUpperCase()
}

export const OperationVisual = ({
  label,
  icon,
  iconSvg,
  iconSvgDark,
  iconScale = 1,
}: {
  label: string
  icon?: string | null
  iconSvg?: string | null
  iconSvgDark?: string | null
  iconScale?: number
}) =>
  icon || iconSvg || iconSvgDark ? (
    <ExtensionIcon
      name={icon ?? null}
      light={iconSvg ?? null}
      dark={iconSvgDark ?? null}
      scale={iconScale}
    />
  ) : (
    <span
      aria-hidden="true"
      className="font-mono text-[8px] font-bold tracking-tight text-violet-600 dark:text-violet-300"
    >
      {operationMonogram(label)}
    </span>
  )

const ExtensionActionRows = ({
  actions,
  busy,
  runAction,
  pinAction,
}: {
  actions: ContextAction[]
  busy: string | null
  runAction: (id: string) => void
  pinAction: (id: string, pinned: boolean) => void
}) => (
  <div className="space-y-0.5">
    {actions.map(action => (
      <div key={action.id} className="group flex items-center gap-0.5">
        <button
          type="button"
          disabled={!action.available || busy !== null}
          aria-describedby={
            !action.available ? `unavailable-${action.id.replaceAll('/', '-')}` : undefined
          }
          className={`min-w-0 flex-1 gap-2 disabled:cursor-not-allowed disabled:opacity-40 ${panelItemClass}`}
          onClick={() => runAction(action.id)}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-500/8 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            {busy === action.id ? (
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <OperationVisual
                label={action.label}
                icon={action.icon}
                iconSvg={action.iconSvg}
                iconSvgDark={action.iconSvgDark}
                iconScale={action.iconScale}
              />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          {action.shortcut && (
            <span className="shrink-0 font-mono text-[8px] text-slate-400">{action.shortcut}</span>
          )}
        </button>
        <button
          type="button"
          aria-label={`${action.pinned ? 'Unpin' : 'Pin'} ${action.label}`}
          className="shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition-colors hover:bg-violet-500/10 hover:text-amber-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 group-hover:opacity-100 dark:text-slate-600"
          onClick={() => pinAction(action.id, !action.pinned)}
        >
          <Pin className={`h-3 w-3 ${action.pinned ? 'fill-current text-amber-500' : ''}`} />
        </button>
        {!action.available && action.unavailableReason && (
          <span id={`unavailable-${action.id.replaceAll('/', '-')}`} className="sr-only">
            {action.unavailableReason}
          </span>
        )}
      </div>
    ))}
  </div>
)

export const TransformActionsPanel = ({
  items,
  actions,
  busy,
  run,
  runAction,
  pinAction,
  onClose,
}: {
  items: Transformer[]
  actions: ContextAction[]
  busy: string | null
  run: (id: string) => void
  runAction: (id: string) => void
  pinAction: (id: string, pinned: boolean) => void
  onClose: () => void
}) => {
  const pinnedTools = actions.filter(action => action.pinned)
  const otherActions = actions.filter(action => !action.pinned && !action.transformPreset)
  const transformPresets = actions.filter(action => !action.pinned && action.transformPreset)
  const hasTransforms = items.length > 0 || transformPresets.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Transform and actions panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200/60 px-3 dark:border-white/7">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/15 dark:text-violet-300">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
            Tools
          </h2>
          <p className="truncate text-[9px] text-slate-400">For this clip</p>
        </div>
        <button
          type="button"
          aria-label="Collapse tools"
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-500/10 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 dark:hover:text-slate-200"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {pinnedTools.length > 0 && (
          <section aria-labelledby="pinned-tools-panel-heading">
            <h3
              id="pinned-tools-panel-heading"
              className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-400"
            >
              Pinned
            </h3>
            <ExtensionActionRows
              actions={pinnedTools}
              busy={busy}
              runAction={runAction}
              pinAction={pinAction}
            />
          </section>
        )}

        {otherActions.length > 0 && (
          <section aria-labelledby="actions-panel-heading">
            <h3
              id="actions-panel-heading"
              className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-400"
            >
              Extension actions
            </h3>
            <ExtensionActionRows
              actions={otherActions}
              busy={busy}
              runAction={runAction}
              pinAction={pinAction}
            />
          </section>
        )}

        {hasTransforms && (
          <section aria-labelledby="transform-panel-heading">
            <h3
              id="transform-panel-heading"
              className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-400"
            >
              Transform
            </h3>
            <div className="space-y-0.5">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy !== null}
                  className={`w-full gap-2 disabled:cursor-wait disabled:opacity-45 ${panelItemClass}`}
                  onClick={() => run(item.id)}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-500/8 text-violet-500 dark:bg-white/5 dark:text-violet-300">
                    {busy === item.id ? (
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : (
                      <OperationVisual label={item.label} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              ))}
            </div>
            {transformPresets.length > 0 && (
              <ExtensionActionRows
                actions={transformPresets}
                busy={busy}
                runAction={runAction}
                pinAction={pinAction}
              />
            )}
          </section>
        )}
      </div>
    </div>
  )
}
