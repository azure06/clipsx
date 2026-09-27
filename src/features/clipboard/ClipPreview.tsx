import * as Dialog from '@radix-ui/react-dialog'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ChevronLeft, ChevronRight, ScanText, Sparkles, X } from 'lucide-react'
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
import { ExtensionResultTab, ExtensionTools } from './ExtensionWorkspace'
import { ExtensionOperationIcon, type PinnedOperation } from './ExtensionOperationIcon'
import { retainInstalledPins } from './extensionPins'
import { useClipExtensionJobs } from './useClipExtensionJobs'
import { ExtensionJobStatusIcon, jobStatusLabel } from './ExtensionJobStatus'

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

export const ClipPreview = memo(function ClipPreview({ clip }: { clip: ClipSummary }) {
  const { t, i18n } = useTranslation()
  const [previewContainer, setPreviewContainer] = useState<HTMLDivElement | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsTriggerRef = useRef<HTMLButtonElement>(null)
  const [requestedOperationId, setRequestedOperationId] = useState<string | null>(null)
  const [pinnedOperations, setPinnedOperations] = useState<PinnedOperation[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem('clipsx.extensionOperationPins.v1') ?? '[]'
      )
      return Array.isArray(value)
        ? (value as unknown[])
            .filter(
              (item): item is PinnedOperation =>
                typeof item === 'object' &&
                item !== null &&
                'id' in item &&
                typeof item.id === 'string' &&
                item.id.length <= 160 &&
                'label' in item &&
                typeof item.label === 'string' &&
                item.label.length <= 120 &&
                'kind' in item &&
                (item.kind === 'action' || item.kind === 'transformer') &&
                'iconScale' in item &&
                typeof item.iconScale === 'number' &&
                Number.isFinite(item.iconScale)
            )
            .map(item => ({
              ...item,
              packageId:
                typeof item.packageId === 'string'
                  ? item.packageId
                  : (item.id.match(/^(?:action|setup|custom):([^/:]+)\//)?.[1] ?? ''),
            }))
            .filter(item => item.packageId.length > 0)
            .slice(0, 24)
        : []
    } catch {
      return []
    }
  })
  const [enabledPackages, setEnabledPackages] = useState<Set<string>>(() => new Set())
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null)
  const { jobs, refresh: refreshJobs } = useClipExtensionJobs(clip.id)
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null)
  const [toolbarScroll, setToolbarScroll] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  })
  const [presentation, setPresentation] = useState<ClipPresentation | null>(null)
  const [tabControls, setTabControls] = useState<ViewTabControls | null>(null)
  const [transformControls, setTransformControls] = useState<TransformControls | null>(null)
  const deleteClip = useClipboardStore(state => state.deleteClip)
  const togglePin = useClipboardStore(state => state.togglePin)
  const toggleFavorite = useClipboardStore(state => state.toggleFavorite)
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
  const selectedResult = jobs.find(job => job.jobId === selectedResultId) ?? null
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: toolsOpen } }))
    return () => {
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [toolsOpen])
  useEffect(() => {
    localStorage.setItem('clipsx.extensionOperationPins.v1', JSON.stringify(pinnedOperations))
  }, [pinnedOperations])
  useEffect(() => {
    let alive = true
    let request = 0
    const refresh = () => {
      const current = ++request
      setEnabledPackages(new Set())
      void Promise.all([
        invoke<Array<{ packageId: string; enabled: boolean }>>('list_extensions'),
        invoke<Array<{ id: string }>>('list_extension_transform_setups'),
      ])
        .then(([packages, setups]) => {
          if (!alive || current !== request) return
          const installed = new Set(packages.map(item => item.packageId))
          setEnabledPackages(
            new Set(packages.filter(item => item.enabled).map(item => item.packageId))
          )
          setPinnedOperations(current =>
            retainInstalledPins(current, installed, new Set(setups.map(setup => setup.id)))
          )
        })
        .catch(() => {
          /* Keep saved pins when the local package query fails. */
        })
    }
    refresh()
    window.addEventListener('clipsx-extension-permissions-changed', refresh)
    const listeners: Array<() => void> = []
    for (const eventName of ['extension-catalog-updated', 'extensions-changed']) {
      void listen(eventName, refresh).then(stop => {
        if (alive) listeners.push(stop)
        else stop()
      })
    }
    return () => {
      alive = false
      window.removeEventListener('clipsx-extension-permissions-changed', refresh)
      listeners.forEach(stop => stop())
    }
  }, [])
  const toggleOperationPin = useCallback((operation: PinnedOperation) => {
    setPinnedOperations(current => {
      return current.some(item => item.id === operation.id)
        ? current.filter(item => item.id !== operation.id)
        : [...current, operation].slice(-24)
    })
  }, [])
  useEffect(() => {
    setSelectedResultId(null)
    setToolsOpen(false)
  }, [clip.id])
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
  }, [toolbarEl, updateToolbarScroll, currentPresentation])
  const scrollToolbarBy = (direction: 1 | -1) =>
    toolbarEl?.scrollBy({ left: direction * 96, behavior: 'smooth' })
  const typeLabel = currentPresentation?.activeView.presentationKind ?? clip.primaryPresentationKind
  const typeDotColor = KIND_COLOR[typeLabel] ?? 'bg-blue-500'
  const sourceLabel = currentPresentation?.sourceAppName ?? clip.sourceAppName
  const stats = useMemo(
    () => (presentation ? presentationTextStats(presentation) : null),
    [presentation]
  )
  const ocr = currentPresentation?.model.kind === 'image' ? currentPresentation.model.ocr : null
  const visibleTabs = tabControls && tabControls.views.length + jobs.length > 1 ? tabControls : null

  return (
    <div
      ref={setPreviewContainer}
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
                {pinnedOperations
                  .filter(operation => enabledPackages.has(operation.packageId))
                  .map(operation => {
                    const action =
                      operation.kind === 'action'
                        ? transformControls?.actions.find(
                            item => `action:${item.id}` === operation.id
                          )
                        : null
                    const transformer = transformControls?.items.find(
                      item =>
                        operation.id.startsWith(`setup:${item.id}:`) ||
                        operation.id === `custom:${item.id}` ||
                        operation.id in item.setupAvailability
                    )
                    const decision = transformer
                      ? operation.id.startsWith('custom:')
                        ? transformer.customAvailability
                        : transformer.setupAvailability[
                            operation.id.startsWith('setup:')
                              ? operation.id.slice(`setup:${transformer.id}:`.length)
                              : operation.id
                          ]
                      : null
                    if (
                      operation.kind === 'transformer' &&
                      (!decision || decision.state === 'hidden')
                    )
                      return null
                    const available =
                      operation.kind === 'action'
                        ? Boolean(action?.available)
                        : Boolean(transformer?.providerAvailable && decision?.state === 'ready')
                    const reason =
                      action?.unavailableReason ??
                      decision?.reason ??
                      (transformer?.providerAvailable === false
                        ? 'Configure Local Text Generation'
                        : 'Unavailable for this clip')
                    return (
                      <button
                        type="button"
                        key={operation.id}
                        aria-label={operation.label}
                        title={available ? operation.label : reason}
                        disabled={!available}
                        onClick={() => {
                          if (action) void transformControls?.runAction(action.id)
                          else {
                            setRequestedOperationId(operation.id)
                            setToolsOpen(true)
                          }
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-violet-600 hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:cursor-not-allowed disabled:opacity-35 dark:text-violet-300"
                      >
                        <ExtensionOperationIcon
                          operation={{
                            ...operation,
                            ...(action || transformer
                              ? {
                                  icon: (action ?? transformer)?.icon ?? null,
                                  iconSvg: (action ?? transformer)?.iconSvg ?? null,
                                  iconSvgDark: (action ?? transformer)?.iconSvgDark ?? null,
                                  iconScale: (action ?? transformer)?.iconScale ?? 1,
                                }
                              : {}),
                          }}
                        />
                      </button>
                    )
                  })}
                <button
                  ref={toolsTriggerRef}
                  type="button"
                  aria-label="Open clip tools"
                  title="Tools"
                  aria-haspopup="dialog"
                  aria-expanded={toolsOpen}
                  onClick={() => {
                    setRequestedOperationId(null)
                    setToolsOpen(true)
                  }}
                  className={`shrink-0 rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${toolsOpen ? 'bg-violet-500/15 text-violet-600' : 'text-gray-500 hover:bg-slate-200/60 dark:hover:bg-white/10'}`}
                >
                  <Sparkles className="h-4 w-4" />
                </button>
                <div className="mx-0.5 h-3.5 w-px shrink-0 bg-slate-300/60 dark:bg-white/10" />
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
                      : null
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedResultId(null)
                    setToolsOpen(false)
                    visibleTabs.onTabChange(item.id)
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                    !selectedResultId && visibleTabs.activeId === item.id
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
            {jobs.map(job => (
              <div
                key={job.jobId}
                className={`flex shrink-0 items-center rounded-md text-xs ${selectedResultId === job.jobId ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'text-gray-500 hover:bg-slate-100 dark:hover:bg-white/10'}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedResultId(job.jobId)
                    setToolsOpen(false)
                  }}
                  className="flex max-w-56 items-center gap-1.5 px-2.5 py-1"
                  title={`${job.displayLabel} · ${jobStatusLabel(job)}`}
                >
                  <ExtensionJobStatusIcon job={job} />
                  <span className="truncate">
                    {job.displayLabel}
                    {job.status !== 'completed' ? ` · ${jobStatusLabel(job)}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${['completed', 'failed', 'cancelled'].includes(job.status) ? 'Delete' : 'Cancel'} ${job.displayLabel} result`}
                  title={
                    ['completed', 'failed', 'cancelled'].includes(job.status)
                      ? 'Delete result'
                      : 'Cancel job'
                  }
                  className="rounded-r-md p-1 hover:bg-red-500/10 hover:text-red-600"
                  onClick={() => {
                    const terminal = ['completed', 'failed', 'cancelled'].includes(job.status)
                    if (terminal && !window.confirm(`Delete ${job.displayLabel} result?`)) return
                    void invoke(terminal ? 'delete_extension_result' : 'cancel_extension_job', {
                      jobId: job.jobId,
                    })
                      .then(() => {
                        if (selectedResultId === job.jobId && terminal) setSelectedResultId(null)
                        void refreshJobs()
                      })
                      .catch(error =>
                        window.dispatchEvent(
                          new CustomEvent('clipsx-extension-action-notification', {
                            detail: { level: 'error', message: String(error) },
                          })
                        )
                      )
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {visibleTabs.preferenceScopes.length > 0 &&
              !selectedResultId &&
              !visibleTabs.activeId.startsWith('__') && (
                <DropdownMenu
                  onOpenChange={open =>
                    window.dispatchEvent(
                      new CustomEvent('clipsx-host-overlay', { detail: { open } })
                    )
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
        <div className={`h-full ${selectedResultId ? 'hidden' : ''}`}>
          <V2ViewPanel
            key={clip.id}
            clipId={clip.id}
            onPresentation={handlePresentation}
            onTabControls={handleTabControls}
            onTransformControls={handleTransformControls}
          />
        </div>
        {selectedResult && (
          <ExtensionResultTab
            key={selectedResult.jobId}
            job={selectedResult}
            presentation={currentPresentation}
            canRegenerate={Boolean(
              transformControls?.items.some(item => item.id === selectedResult.transformerId)
            )}
            onChanged={() => void refreshJobs()}
            onQueued={jobId => {
              setSelectedResultId(jobId)
              void refreshJobs()
            }}
          />
        )}
        {selectedResultId && !selectedResult && (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            Loading result…
          </div>
        )}
      </div>

      <Dialog.Root open={toolsOpen} onOpenChange={setToolsOpen}>
        <Dialog.Portal container={previewContainer}>
          <Dialog.Overlay className="absolute inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px] dark:bg-black/55" />
          <Dialog.Content
            onCloseAutoFocus={event => {
              event.preventDefault()
              toolsTriggerRef.current?.focus()
            }}
            className="absolute left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_55px_-20px_rgba(15,23,42,.55)] outline-none dark:border-white/10 dark:bg-slate-900"
            style={{
              width: 'min(calc(100% - 1rem), 680px)',
              height: 'min(calc(100% - 1rem), 580px)',
            }}
            aria-describedby="clip-tools-description"
          >
            <ExtensionTools
              clipId={clip.id}
              sourceId={currentPresentation?.activeView.sourceId ?? ''}
              transformers={transformControls?.items ?? []}
              actions={transformControls?.actions ?? []}
              pinnedIds={pinnedOperations.map(item => item.id)}
              onTogglePin={toggleOperationPin}
              initialOperationId={requestedOperationId}
              runAction={id => {
                void transformControls?.runAction(id)
                setToolsOpen(false)
              }}
              onClose={() => setToolsOpen(false)}
              onQueued={jobId => {
                setSelectedResultId(jobId)
                setToolsOpen(false)
                void refreshJobs()
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
})
