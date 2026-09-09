import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, ScanText, Sparkles } from 'lucide-react'
import type { ClipPresentation, ClipSummary } from '../../shared/types/v2'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { presentationTextStats } from './presentationModel'
import { TagChips } from './components/TagChips'
import { NoteField } from './components/NoteField'
import { V2ViewPanel, type ViewTabControls } from './V2ViewPanel'
import type { ContextAction, TransformControls } from './useTransformState'
import { ContributionParametersPanel } from './ContributionParametersDialog'
import { OperationVisual, TransformActionsPanel } from './TransformActionsDialog'
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

const ClipToolsButton = ({
  controls,
  container,
}: {
  controls: TransformControls | null
  container: HTMLElement | null
}) => {
  const open = controls ? controls.pickerOpen || controls.parameterRequest !== null : false

  // Extension custom views render as a native webview positioned above this
  // window's content, not a DOM node — CSS z-index can't cover it. Toggling
  // this event tells it to hide itself while the modal is open, and the
  // opaque backdrop covers the gap until it does.
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [open])

  if (!controls) return null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (next) {
          controls.openPicker()
          return
        }
        if (controls.parameterRequest) controls.cancelParameterRequest()
        controls.closePicker()
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Clip tools"
          title="Clip tools"
          className={`shrink-0 rounded-md p-1.5 transition-all duration-150 ${
            open
              ? 'scale-110 bg-violet-500/10 text-violet-600 dark:text-violet-400'
              : 'text-gray-500 hover:bg-slate-200/60 dark:hover:bg-white/10'
          }`}
        >
          {controls.busy !== null ? (
            <span className="block h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="absolute inset-0 z-40 rounded-2xl bg-slate-950/40 backdrop-blur-sm dark:bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          className="absolute inset-0 z-40 flex items-center justify-center p-6 outline-none"
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <Dialog.Title className="sr-only">Clip tools</Dialog.Title>
          <div className="flex h-96 max-h-full w-96 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_28px_80px_-36px_rgba(15,23,42,.55)] dark:border-white/10 dark:bg-slate-900/95">
            {controls.parameterRequest ? (
              <ContributionParametersPanel
                request={controls.parameterRequest}
                onCancel={controls.cancelParameterRequest}
                onSubmit={controls.submitParameters}
              />
            ) : (
              <TransformActionsPanel
                items={controls.items}
                actions={controls.actions}
                busy={controls.busy}
                run={id => void controls.run(id)}
                runAction={id => void controls.runAction(id)}
                pinAction={(id, pinned) => void controls.pinAction(id, pinned)}
                onClose={controls.closePicker}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const PinnedActionButton = ({
  action,
  busy,
  onRun,
}: {
  action: ContextAction
  busy: boolean
  onRun: () => void
}) => (
  <button
    type="button"
    aria-label={action.label}
    title={action.unavailableReason ?? action.label}
    disabled={!action.available || busy}
    className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10"
    onClick={onRun}
  >
    {busy ? (
      <span className="block h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />
    ) : (
      <OperationVisual
        label={action.label}
        icon={action.icon}
        iconSvg={action.iconSvg}
        iconSvgDark={action.iconSvgDark}
        iconScale={action.iconScale}
      />
    )}
  </button>
)

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
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null)
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null)
  const [toolbarScroll, setToolbarScroll] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  })
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
  const pinnedActions = useMemo(
    () => transformControls?.actions.filter(action => action.pinned) ?? [],
    [transformControls]
  )
  const updateToolbarScroll = useCallback(() => {
    if (!toolbarEl) return
    setToolbarScroll({
      canScrollLeft: toolbarEl.scrollLeft > 1,
      canScrollRight: toolbarEl.scrollLeft + toolbarEl.clientWidth < toolbarEl.scrollWidth - 1,
    })
  }, [toolbarEl])
  useEffect(() => {
    if (!toolbarEl) return
    const observer = new ResizeObserver(updateToolbarScroll)
    observer.observe(toolbarEl)
    const raf = window.requestAnimationFrame(updateToolbarScroll)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(raf)
    }
  }, [toolbarEl, updateToolbarScroll, pinnedActions, currentPresentation])
  const scrollToolbarBy = (direction: 1 | -1) =>
    toolbarEl?.scrollBy({ left: direction * 96, behavior: 'smooth' })
  const typeLabel = currentPresentation?.activeView.presentationKind ?? clip.primaryPresentationKind
  const typeDotColor = KIND_COLOR[typeLabel] ?? 'bg-blue-500'
  const sourceLabel = currentPresentation?.sourceAppName ?? clip.sourceAppName
  const stats = currentPresentation ? presentationTextStats(currentPresentation) : null
  const ocr = currentPresentation?.model.kind === 'image' ? currentPresentation.model.ocr : null
  const visibleTabs = tabControls && tabControls.views.length > 1 ? tabControls : null

  return (
    <div
      ref={setPreviewEl}
      className="relative my-0.5 mr-2 flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-100/25 backdrop-blur-xl dark:border-white/5 dark:bg-slate-100/5"
    >
      {/* Header: row 1 — type badge + actions */}
      <div className="flex shrink-0 flex-col border-b border-slate-100/10 bg-slate-100/40 dark:border-slate-100/5 dark:bg-slate-100/5">
        <div className="flex items-center gap-2 py-2.5 pl-3 pr-20">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-slate-100/50 px-2 py-1 dark:bg-slate-100/10">
              <span className={`h-1.5 w-1.5 rounded-full ${typeDotColor}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-400">
                {typeLabel.replaceAll('_', ' ')}
              </span>
            </div>
          </div>
          <div className="relative flex min-w-0 max-w-[70%] shrink items-center">
            {toolbarScroll.canScrollLeft && (
              <button
                type="button"
                aria-label="Scroll actions left"
                onClick={() => scrollToolbarBy(-1)}
                className="absolute left-0 z-10 flex h-5 w-4 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-slate-200/60 hover:text-gray-600 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-300"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
            )}
            <div
              className={`flex min-w-0 overflow-hidden ${toolbarScroll.canScrollLeft ? 'pl-5' : ''} ${
                toolbarScroll.canScrollRight ? 'pr-5' : ''
              }`}
            >
              <div
                ref={setToolbarEl}
                onScroll={updateToolbarScroll}
                className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar"
              >
                {pinnedActions.map(action => (
                  <PinnedActionButton
                    key={action.id}
                    action={action}
                    busy={transformControls?.busy === action.id}
                    onRun={() => void transformControls?.runAction(action.id)}
                  />
                ))}
                <ClipToolsButton controls={transformControls} container={previewEl} />
                {transformControls && (
                  <div className="mx-0.5 h-3.5 w-px shrink-0 bg-slate-300/60 dark:bg-white/10" />
                )}
                {currentPresentation && (
                  <div className="shrink-0">
                    <ClipActionsToolbar
                      presentation={currentPresentation}
                      context={actionContext}
                    />
                  </div>
                )}
              </div>
            </div>
            {toolbarScroll.canScrollRight && (
              <button
                type="button"
                aria-label="Scroll actions right"
                onClick={() => scrollToolbarBy(1)}
                className="absolute right-0 z-10 flex h-5 w-4 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-slate-200/60 hover:text-gray-600 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-300"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
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
