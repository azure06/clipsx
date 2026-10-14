import { useId, useRef, useEffect, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'

export function ModelSettingsPanel({
  title,
  description,
  children,
  icon,
}: {
  title: string
  description: string
  children: ReactNode
  icon?: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const previousFocus = useRef(document.activeElement)
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest' })
    const trigger = previousFocus.current
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true })
    }
  }, [])
  return (
    <section ref={panel} aria-labelledby={titleId} className="space-y-5 px-1 py-3">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
          {icon ?? <Sparkles className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}
