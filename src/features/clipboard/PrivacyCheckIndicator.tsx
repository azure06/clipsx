import { ShieldCheck, ListChecks } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SHOW_DELAY_MS = 180
const MINIMUM_VISIBLE_MS = 500

export const PrivacyCheckIndicator = ({
  pending,
  phase = 'privacy',
}: {
  pending: number
  phase?: 'privacy' | 'organizing'
}) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (pending > 0) {
      if (visible) return
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, SHOW_DELAY_MS)
      return () => window.clearTimeout(timer)
    }

    if (!visible) return
    const remaining = Math.max(0, MINIMUM_VISIBLE_MS - (Date.now() - shownAt.current))
    const timer = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(timer)
  }, [pending, visible])

  if (!visible) return null
  const organizing = phase === 'organizing'
  const Icon = organizing ? ListChecks : ShieldCheck
  const label = t(organizing ? 'clipboard.organizing' : 'clipboard.privacyChecking')

  return (
    <div
      role="status"
      aria-live="polite"
      className={`ml-auto flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${organizing ? 'border-blue-200/70 bg-blue-50/70 text-blue-700 dark:border-blue-400/15 dark:bg-blue-500/10 dark:text-blue-300' : 'border-violet-200/70 bg-violet-50/70 text-violet-700 dark:border-violet-400/15 dark:bg-violet-500/10 dark:text-violet-300'}`}
      title={label}
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
        <Icon
          className={`h-3.5 w-3.5 ${organizing ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        />
        {!organizing && (
          <>
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-ping rounded-full bg-violet-500 motion-reduce:animate-none" />
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-violet-500" />
          </>
        )}
      </span>
      <span className="truncate">{label}</span>
      {pending > 1 && <span className="tabular-nums opacity-70">{pending}</span>}
    </div>
  )
}
