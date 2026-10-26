import type { ClipSummary } from '../../shared/types/v2'

type HistoryScope = {
  mode: 'browse' | 'search'
  activeTab: 'all' | 'favorites' | 'pinned'
  tagFilter: string | null
}
export const showsPinnedSection = (state: HistoryScope) =>
  state.mode === 'browse' && state.activeTab === 'all' && state.tagFilter === null

// The list and keyboard commands must share the same visible order.
export const historyDisplayClips = (
  state: HistoryScope & { clips: ClipSummary[]; pinnedPreview: ClipSummary[] },
  collapsed: boolean
): ClipSummary[] => {
  if (!showsPinnedSection(state)) return state.clips
  const pins = collapsed ? [] : state.pinnedPreview.slice(0, 3)
  return [...pins, ...state.clips.filter(clip => !clip.isPinned)]
}
