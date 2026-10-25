import type { ReactNode } from 'react'
import type { V2Tag } from '../../../shared/types/v2'

export function TagBadge({ tag, children }: { tag: V2Tag; children?: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-slate-200/80 bg-white/65 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400"
        style={tag.color ? { backgroundColor: tag.color } : undefined}
      />
      <span className="max-w-32 truncate" title={tag.name}>
        {tag.name}
      </span>
      {children}
    </span>
  )
}
