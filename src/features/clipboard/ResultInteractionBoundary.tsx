import type { ReactNode } from 'react'
import { useClipboardStore } from '../../stores/clipboardStore'

export const ResultInteractionBoundary = ({ children }: { children: ReactNode }) => {
  const stale = useClipboardStore(state => state.resultsStale)
  return (
    <div inert={stale} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}
