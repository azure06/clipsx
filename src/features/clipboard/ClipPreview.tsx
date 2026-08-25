import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScanText } from 'lucide-react'
import type { ClipPresentation, ClipSummary } from '../../shared/types/v2'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { presentationTextStats } from './presentationModel'
import { TagChips } from './components/TagChips'
import { NoteField } from './components/NoteField'
import { V2ViewPanel, type ViewTabControls } from './V2ViewPanel'
import type { TransformControls } from './useTransformState'
import { useClipboardStore } from '../../stores/clipboardStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../shared/components/ui'

const KIND_COLOR: Record<string, string> = {
  url: 'bg-green-500',
  code: 'bg-violet-500',
  path: 'bg-amber-500',
  email: 'bg-pink-500',
  phone: 'bg-emerald-500',
  color: 'bg-orange-400',
  json: 'bg-teal-500',
  table: 'bg-cyan-500',
  markdown: 'bg-sky-500',
  image: 'bg-rose-500',
  jwt: 'bg-purple-500',
  secret: 'bg-red-500',
  math: 'bg-indigo-500',
  date: 'bg-yellow-500',
  timestamp: 'bg-yellow-500',
  html: 'bg-orange-500',
  rich_text: 'bg-orange-400',
  files: 'bg-slate-500',
  office: 'bg-blue-600',
  document: 'bg-blue-500',
  text: 'bg-gray-400',
}

export const ViewTabIcon = ({
  light,
  dark,
  scale,
}: {
  light: string | null
  dark: string | null
  scale: number
}) => {
  if (!light) return null
  const style = scale === 1 ? undefined : { transform: `scale(${scale})` }
  if (!dark) return <img alt="" className="h-3 w-3 shrink-0" src={light} style={style} />
  return (
    <>
      <img alt="" className="h-3 w-3 shrink-0 dark:hidden" src={light} style={style} />
      <img alt="" className="hidden h-3 w-3 shrink-0 dark:block" src={dark} style={style} />
    </>
  )
}

export const ClipPreview = ({ clip }: { clip: ClipSummary }) => {
  const { t, i18n } = useTranslation()
  const [presentation, setPresentation] = useState<ClipPresentation | null>(null)
  const [tabControls, setTabControls] = useState<ViewTabControls | null>(null)
  const [transformControls, setTransformControls] = useState<TransformControls | null>(null)
  const { deleteClip, togglePin, toggleFavorite } = useClipboardStore()
  const currentPresentation = useMemo(
    () =>
      presentation
        ? { ...presentation, isFavorite: clip.isFavorite, isPinned: clip.isPinned }
        : null,
    [clip.isFavorite, clip.isPinned, presentation]
  )
  const actionContext = useMemo(
    () => ({
      onDelete: (id: string) => deleteClip(id),
      onTogglePin: (id: string) => togglePin(id),
      onToggleFavorite: (id: string) => toggleFavorite(id),
      onShowInspector: tabControls ? () => tabControls.onShowInspector() : undefined,
    }),
    [deleteClip, toggleFavorite, togglePin, tabControls]
  )
  const handlePresentation = useCallback(
    (value: ClipPresentation | null) => setPresentation(value),
    []
  )
  const handleTabControls = useCallback(
    (controls: ViewTabControls | null) => setTabControls(controls),
    []
  )
  const handleTransformControls = useCallback(
    (controls: TransformControls | null) => setTransformControls(controls),
    []
  )
  const typeLabel = currentPresentation?.activeView.presentationKind ?? clip.primaryPresentationKind
  const typeDotColor = KIND_COLOR[typeLabel] ?? 'bg-blue-500'
  const sourceLabel = currentPresentation?.sourceAppName ?? clip.sourceAppName
  const stats = currentPresentation ? presentationTextStats(currentPresentation) : null
  const ocr = currentPresentation?.model.kind === 'image' ? currentPresentation.model.ocr : null
  const visibleTabs = tabControls && tabControls.views.length > 1 ? tabControls : null

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden my-0.5 mr-2 bg-slate-100/25 dark:bg-slate-100/5 backdrop-blur-xl border border-slate-200/70 dark:border-white/5">
      {/* Header: row 1 — type badge + actions */}
      <div className="flex shrink-0 flex-col border-b border-slate-100/10 bg-slate-100/40 dark:border-slate-100/5 dark:bg-slate-100/5">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-slate-100/50 px-2 py-1 dark:bg-slate-100/10">
              <span className={`h-1.5 w-1.5 rounded-full ${typeDotColor}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-400">
                {typeLabel.replaceAll('_', ' ')}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {currentPresentation && (
              <ClipActionsToolbar
                presentation={currentPresentation}
                context={actionContext}
                transformControls={transformControls}
              />
            )}
          </div>
        </div>

        {/* Row 2: view tabs (only when multiple views exist) */}
        {visibleTabs && (
          <div className="flex gap-1 overflow-x-auto px-3 pb-1.5 no-scrollbar">
            {visibleTabs.views.map(item => {
              const isOcr = item.id === '__ocr__'
              const isTransform = item.id === '__transform__'
              const ocrState =
                isOcr && currentPresentation?.model.kind === 'image'
                  ? currentPresentation.model.ocr.state
                  : null
              const dot =
                ocrState === 'pending' || ocrState === 'running'
                  ? 'bg-sky-400 animate-pulse'
                  : ocrState === 'ready'
                    ? 'bg-emerald-400'
                    : ocrState === 'failed'
                      ? 'bg-red-400'
                      : isTransform
                        ? 'bg-violet-400 animate-pulse'
                        : null
              return (
                <button
                  key={item.id}
                  onClick={() => visibleTabs.onTabChange(item.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                    visibleTabs.activeId === item.id
                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
                  <ViewTabIcon
                    light={item.iconSvg}
                    dark={item.iconSvgDark}
                    scale={item.iconScale}
                  />
                  {item.label}
                </button>
              )
            })}
            {visibleTabs.preferenceScopes.length > 0 && !visibleTabs.activeId.startsWith('__') && (
              <DropdownMenu
                onOpenChange={open =>
                  window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open } }))
                }
              >
                <DropdownMenuTrigger asChild>
                  <button className="ml-auto shrink-0 rounded-md px-2 py-1 text-[10px] text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10">
                    Use by default…
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={4} className="min-w-44 text-xs">
                  {visibleTabs.preferenceScopes.map(scope => (
                    <DropdownMenuItem
                      key={scope}
                      className="px-2 py-1.5 text-xs"
                      onSelect={() => void visibleTabs.onPreferActive(scope)}
                    >
                      Always for this {scope}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden p-0 relative">
        <V2ViewPanel
          key={clip.id}
          clipId={clip.id}
          onPresentation={handlePresentation}
          onTabControls={handleTabControls}
          onTransformControls={handleTransformControls}
        />
      </div>

      <div className="shrink-0 flex flex-col gap-1.5 px-3 py-2 bg-slate-100/45 dark:bg-black/10 border-t border-slate-200/70 dark:border-slate-100/5">
        <TagChips clipId={clip.id} tags={clip.tags ?? []} />
        <NoteField clipId={clip.id} />
      </div>

      <div className="shrink-0 flex items-center justify-between px-3 py-1 bg-slate-100/60 dark:bg-black/20 border-t border-slate-200/70 dark:border-slate-100/5 text-[10px] text-gray-600 dark:text-gray-500 font-mono">
        <div className="flex items-center gap-4">
          <span className="tabular-nums">
            {new Date(clip.capturedAt).toLocaleString(i18n.resolvedLanguage)}
          </span>
          {stats && <span>{t('clipboard.characters', { count: stats.characters })}</span>}
          {stats && <span>{t('clipboard.lines', { count: stats.lines })}</span>}
          {stats?.language && <span>{stats.language}</span>}
          {(ocr?.state === 'pending' || ocr?.state === 'running') && (
            <span className="flex items-center gap-1 text-sky-500">
              <ScanText className="h-3 w-3 animate-pulse" />
              OCR {ocr.state}…
            </span>
          )}
          {ocr?.state === 'failed' && <span className="text-red-500">OCR failed</span>}
          {ocr?.state === 'ready' && ocr.text.trim() && (
            <span className="text-emerald-600 dark:text-emerald-400">OCR</span>
          )}
        </div>
        {sourceLabel && (
          <span>
            <span className="opacity-60 mr-1">{t('clipboard.source')}</span>
            {sourceLabel}
          </span>
        )}
      </div>
    </div>
  )
}
