import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const clamp = (value: number) => Math.max(0.25, Math.min(0.65, value))

/** Inline context stays beside chat, or below it when the available width is narrow. */
export function RecallSplitView({ open, children }: { open: boolean; children: ReactNode[] }) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const dragCleanup = useRef<{ cancel: (() => void) | null }>({ cancel: null })
  const [stacked, setStacked] = useState(false)
  const [ratio, setRatio] = useState(0.4)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setStacked(element.getBoundingClientRect().width < 720)
    measure()
    const drag = dragCleanup.current
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      drag.cancel?.()
    }
  }, [])
  useEffect(() => {
    dragCleanup.current.cancel?.()
  }, [open, stacked])
  return (
    <div ref={root} className={`flex h-full min-h-0 min-w-0 ${stacked ? 'flex-col' : 'flex-row'}`}>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{children[0]}</div>
      {open && (
        <>
          <button
            type="button"
            role="separator"
            aria-label={t('recallContext.resize')}
            aria-orientation={stacked ? 'horizontal' : 'vertical'}
            aria-valuemin={25}
            aria-valuemax={65}
            aria-valuenow={Math.round(ratio * 100)}
            className={`group flex shrink-0 items-center justify-center bg-slate-200/30 outline-none hover:bg-violet-500/10 focus-visible:bg-violet-500/15 dark:bg-white/5 ${stacked ? 'h-2 w-full cursor-row-resize' : 'h-full w-2 cursor-col-resize'}`}
            onDoubleClick={() => setRatio(0.4)}
            onKeyDown={event => {
              let next = ratio
              const step = event.shiftKey ? 0.1 : 0.02
              if (event.key === (stacked ? 'ArrowUp' : 'ArrowLeft')) next += step
              else if (event.key === (stacked ? 'ArrowDown' : 'ArrowRight')) next -= step
              else if (event.key === 'Home') next = 0.25
              else if (event.key === 'End') next = 0.65
              else return
              event.preventDefault()
              setRatio(clamp(next))
            }}
            onPointerDown={event => {
              const container = root.current
              if (!container) return
              event.preventDefault()
              dragCleanup.current.cancel?.()
              const separator = event.currentTarget
              separator.setPointerCapture(event.pointerId)
              const initial = ratio
              window.dispatchEvent(
                new CustomEvent('clipsx-host-overlay', { detail: { open: true } })
              )
              const move = (pointer: PointerEvent) => {
                const bounds = container.getBoundingClientRect()
                const size = stacked ? bounds.height : bounds.width
                if (size <= 8) return
                const offset = stacked
                  ? pointer.clientY - bounds.top
                  : pointer.clientX - bounds.left
                setRatio(clamp(1 - offset / (size - 8)))
              }
              const cleanup = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', finish)
                window.removeEventListener('pointercancel', cancel)
                separator.removeEventListener('lostpointercapture', cancel)
                window.dispatchEvent(
                  new CustomEvent('clipsx-host-overlay', { detail: { open: false } })
                )
                dragCleanup.current.cancel = null
              }
              const finish = () => cleanup()
              const cancel = () => {
                cleanup()
                setRatio(initial)
              }
              dragCleanup.current.cancel = cancel
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', finish, { once: true })
              window.addEventListener('pointercancel', cancel, { once: true })
              separator.addEventListener('lostpointercapture', cancel, { once: true })
            }}
          >
            <span
              aria-hidden="true"
              className={`rounded-full bg-slate-300 group-hover:bg-violet-400 group-focus-visible:bg-violet-500 dark:bg-slate-600 ${stacked ? 'h-0.5 w-8' : 'h-8 w-0.5'}`}
            />
          </button>
          <div
            className="min-h-0 min-w-0 shrink-0 overflow-hidden"
            style={{ flexBasis: `calc((100% - 8px) * ${ratio})` }}
          >
            {children[1]}
          </div>
        </>
      )}
    </div>
  )
}
