import { useEffect } from 'react'
import { Pin } from 'lucide-react'
import { ExtensionIcon } from './ClipActionsToolbar'
import { suggestionItemClass } from '../../shared/components/ui'
import type { ContextAction, Transformer } from './useTransformState'

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
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-[2px] dark:bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transform & Actions"
        className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
        onClick={event => event.stopPropagation()}
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Transform & Actions
          </h2>
          <p className="mt-1 text-xs text-gray-500">Choose what to do with this clip.</p>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-auto">
          {hasTransforms && (
            <div>
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-gray-400">
                Transform
              </div>
              <div className="space-y-0.5">
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full ${suggestionItemClass}`}
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
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-gray-400">
                Actions
              </div>
              <div className="space-y-0.5">
                {actions.map(action => (
                  <div key={action.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!action.available}
                      title={action.unavailableReason ?? undefined}
                      className={`min-w-0 flex-1 justify-between gap-2 disabled:pointer-events-none disabled:opacity-40 ${suggestionItemClass}`}
                      onClick={() => {
                        onClose()
                        runAction(action.id)
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ExtensionIcon
                          light={action.iconSvg}
                          dark={action.iconSvgDark}
                          scale={action.iconScale}
                        />
                        <span className="min-w-0 flex-1 truncate">{action.label}</span>
                      </span>
                      {action.shortcut && (
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {action.shortcut}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`${action.pinned ? 'Unpin' : 'Pin'} ${action.label}`}
                      title={action.pinned ? 'Remove from toolbar' : 'Pin to toolbar'}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-violet-500/10 hover:text-amber-500"
                      onClick={() => pinAction(action.id, !action.pinned)}
                    >
                      <Pin className={`h-3.5 w-3.5 ${action.pinned ? 'fill-current' : ''}`} />
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
