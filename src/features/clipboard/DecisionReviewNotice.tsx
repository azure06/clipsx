import { ShieldQuestion, ListChecks, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DecisionReview } from '../../shared/types/v2'

export function DecisionReviewNotice({
  reviews,
  compact = false,
}: {
  reviews?: DecisionReview[]
  compact?: boolean
}) {
  const { t } = useTranslation()
  const failures =
    reviews?.filter(
      review => review.status === 'not_checked' && review.reason !== 'privacy_not_checked'
    ) ?? []
  if (!failures.length) return null
  return (
    <div
      className={
        compact
          ? 'flex shrink-0 gap-1'
          : 'shrink-0 space-y-1 border-t border-amber-200/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/15 dark:bg-amber-500/10 dark:text-amber-200'
      }
    >
      {failures.map(review => {
        const Icon = review.stage === 'privacy' ? ShieldQuestion : ListChecks
        const label = t(
          review.stage === 'privacy' ? 'decisionReview.privacy' : 'decisionReview.organization'
        )
        const reason = t(`decisionReview.reason.${review.reason ?? 'other'}`)
        const detail = `${label} ${reason} ${t(review.stage === 'privacy' ? 'decisionReview.privacyHelp' : 'decisionReview.organizationHelp')}`
        if (compact)
          return (
            <span
              key={review.stage}
              title={detail}
              aria-label={detail}
              className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>{t('decisionReview.notChecked')}</span>
            </span>
          )
        return (
          <details key={review.stage} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 [&::-webkit-details-marker]:hidden">
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{label}</span>
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 motion-safe:transition-transform group-open:rotate-90"
              />
            </summary>
            <p className="mt-2 max-h-28 overflow-y-auto pl-5 leading-relaxed">
              {reason}{' '}
              {t(
                review.stage === 'privacy'
                  ? 'decisionReview.privacyHelp'
                  : 'decisionReview.organizationHelp'
              )}
            </p>
          </details>
        )
      })}
    </div>
  )
}
