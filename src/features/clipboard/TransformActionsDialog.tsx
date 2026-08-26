import { useEffect } from 'react'
import { Pin } from 'lucide-react'
import { ExtensionIcon } from './ClipActionsToolbar'
import type { ContextAction, Transformer } from './useTransformState'

// Deliberately not the shared suggestionItemClass: this picker needs to be
// noticeably more compact than tag suggestions elsewhere, without shrinking
// that shared token for every other consumer.
const pickerItemClass =
  'flex min-w-0 cursor-pointer items-center rounded-md px-2 py-1 text-left text-xs outline-none transition-colors hover:bg-violet-500/10 hover:text-violet-700 focus-visible:bg-violet-500/10 focus-visible:text-violet-700 dark:hover:bg-violet-500/15 dark:hover:text-violet-200 dark:focus-visible:bg-violet-500/15 dark:focus-visible:text-violet-200'

export const TransformActionsDialog = ({
  items,
  actions,
  run,
  runAction,
  pinAction,
  onClose,
}: {
  items: Transformer[]
  actions: ContextAction[]
  run: (id: string) => void
  runAction: (id: string) => void
  pinAction: (id: string, pinned: boolean) => void
  onClose: () => void
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const hasTransforms = items.length > 0
  const hasActions = actions.length > 0

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/20 p-3 backdrop-blur-[2px] dark:bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transform & Actions"
        className="flex max-h-full w-full max-w-xs flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/95 p-3 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
        onClick={event => event.stopPropagation()}
      >
        <div className="shrink-0">
          <h2 className="text-xs font-semibold text-gray-900 dark:text-gray-100">
            Transform & Actions
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-500">Choose what to do with this clip.</p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {hasTransforms && (
            <div>
              <div className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-[.12em] text-gray-400">
                Transform
              </div>
              <div className="space-y-0.5">
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full ${pickerItemClass}`}
                    onClick={() => {
                      onClose()
                      run(item.id)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hasActions && (
            <div>
              <div className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-[.12em] text-gray-400">
                Actions
              </div>
              <div className="space-y-0.5">
                {actions.map(action => (
                  <div key={action.id} className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={!action.available}
                      title={action.unavailableReason ?? undefined}
                      className={`min-w-0 flex-1 justify-between gap-2 disabled:pointer-events-none disabled:opacity-40 ${pickerItemClass}`}
                      onClick={() => {
                        onClose()
                        runAction(action.id)
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ExtensionIcon
                          light={action.iconSvg}
                          dark={action.iconSvgDark}
                          scale={action.iconScale}
                        />
                        <span className="min-w-0 flex-1 truncate">{action.label}</span>
                      </span>
                      {action.shortcut && (
                        <span className="shrink-0 text-[9px] text-gray-400">{action.shortcut}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`${action.pinned ? 'Unpin' : 'Pin'} ${action.label}`}
                      title={action.pinned ? 'Remove from toolbar' : 'Pin to toolbar'}
                      className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-violet-500/10 hover:text-amber-500"
                      onClick={() => pinAction(action.id, !action.pinned)}
                    >
                      <Pin className={`h-3 w-3 ${action.pinned ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
