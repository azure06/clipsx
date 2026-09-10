import { diagnostic } from '../../shared/diagnostics'
import {
  commandShortcut,
  loadCommandBindings,
  matchCommandShortcut,
} from '../../shared/keyboard/commands'
import { formatShortcut } from '../../shared/keyboard/shortcuts'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Eye, Sparkles } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

import { SearchBar, type SearchBarHandle } from '../search/SearchBar'
import { UpdateBanner } from './UpdateBanner'
import { ClipPreview } from '../clipboard/ClipPreview'
import { Sidebar } from '../../shared/components/Sidebar'
import { TitleBar } from '../../shared/components/TitleBar'
import { BottomBar } from '../../shared/components/BottomBar'
import { ClipboardHistory } from '../clipboard/ClipboardHistory'
import { Settings, type SettingsTab } from '../settings/Settings'
import { Plugins } from '../settings/Plugins'
import { IntelligencePage } from '../intelligence/IntelligencePage'
import { RecallWorkspace } from '../recall/RecallWorkspace'
import { useRecall } from '../recall/useRecall'
import { parseSearch } from '../search/searchQuery'
import { useAuthStore, useClipboardStore, useUIStore, useSettingsStore } from '../../stores'
import { useTheme } from '../../shared/hooks/useTheme'
import type {
  GenerationProviderStatus,
  SearchSourceDescriptor,
  TextEmbeddingStatus,
} from '../../shared/types/v2'
import { useTranslation } from 'react-i18next'
import {
  PROFILE_MUTATED_EVENT,
  SYNC_APPLIED_EVENT,
  configurationSyncScheduler,
} from '../../shared/sync/configSync'
import { clampHistoryRatio, SPLITTER_WIDTH_PX } from './splitLayout'

export const AppLayout = () => {
  const { t } = useTranslation()
  const {
    activeView,
    setActiveView,
    searchQuery,
    setSearchQuery,
    previewClipId,
    setPreviewClipId,
    resetSearch,
    isSemanticActive,
    setSemanticActive,
  } = useUIStore()
  const settings = useSettingsStore(state => state.settings)
  const clips = useClipboardStore(state => state.clips)
  const activeTab = useClipboardStore(state => state.activeTab)
  const setClipboardTab = useClipboardStore(state => state.setActiveTab)
  const refreshSearch = useClipboardStore(state => state.refreshSearch)
  const addNewClip = useClipboardStore(state => state.addNewClip)
  const searchSourceOutcomes = useClipboardStore(state => state.searchSourceOutcomes)
  const { setThemeMode } = useTheme()
  const initializeAuth = useAuthStore(state => state.initialize)
  const completeAuthCallback = useAuthStore(state => state.completeCallback)
  const authStatus = useAuthStore(state => state.status)
  const authUserId = useAuthStore(state => state.userId)
  const [textSearchStatus, setTextSearchStatus] = useState<TextEmbeddingStatus | null>(null)
  const [searchSources, setSearchSources] = useState<SearchSourceDescriptor[]>([])
  const [generationStatus, setGenerationStatus] = useState<GenerationProviderStatus | null>(null)
  const recall = useRecall()
  const [rightTab, setRightTab] = useState<'preview' | 'recall'>('preview')
  const effectiveRightTab = recall.turns.length > 0 ? rightTab : 'preview'
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general')
  const searchBarRef = useRef<SearchBarHandle>(null)
  const splitViewRef = useRef<HTMLDivElement>(null)
  const splitCleanupRef = useRef<(() => void) | null>(null)
  const historyRatioRef = useRef(0.5)
  const handledAuthUrlsRef = useRef(new Set<string>())
  const [historyRatio, setHistoryRatio] = useState(0.5)
  const [splitContainerWidth, setSplitContainerWidth] = useState(0)
  const [splitSaveError, setSplitSaveError] = useState(false)
  const effectiveHistoryRatio = clampHistoryRatio(historyRatio, splitContainerWidth)
  const previewClip = clips.find(clip => clip.id === previewClipId) ?? null
  const tabSwitcher = (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200/70 bg-slate-100/50 p-0.5 dark:border-white/5 dark:bg-white/5">
      {(['preview', 'recall'] as const).map(tab => {
        const disabled = tab === 'recall' && recall.turns.length === 0
        const active = effectiveRightTab === tab
        const Icon = tab === 'preview' ? Eye : Sparkles
        return (
          <button
            key={tab}
            disabled={disabled}
            title={disabled ? 'Ask a question to start a Recall session' : tab}
            aria-label={tab}
            onClick={() => setRightTab(tab)}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              active
                ? 'bg-white text-violet-700 shadow-sm dark:bg-white/10 dark:text-violet-200'
                : disabled
                  ? 'cursor-not-allowed text-gray-300 dark:text-gray-700'
                  : 'text-gray-500 hover:bg-white/70 dark:hover:bg-white/10'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
  const parsedRecallQuery = parseSearch(searchQuery)
  const recallScope = useMemo(
    () => ({
      scope: activeTab,
      tagId: null,
      representationFamilies: parsedRecallQuery.representationFamilies,
      facetIds: parsedRecallQuery.facetIds,
      enabledSourceIds: searchSources.filter(source => source.enabled).map(source => source.id),
      label:
        activeTab === 'all' ? 'All history' : activeTab === 'favorites' ? 'Favorites' : 'Pinned',
    }),
    [activeTab, parsedRecallQuery.facetIds, parsedRecallQuery.representationFamilies, searchSources]
  )
  const runRecall = useCallback(() => {
    if (!parsedRecallQuery.query || recall.isRunning) return
    if (!generationStatus?.enabled || !generationStatus.available) {
      setActiveView('intelligence')
      return
    }
    setRightTab('recall')
    void recall.startRoot(parsedRecallQuery.query, recallScope)
  }, [generationStatus, parsedRecallQuery.query, recall, recallScope, setActiveView])
  const handlePreviewItem = useCallback(
    (clipId: string | null) => {
      setPreviewClipId(clipId)
      setRightTab('preview')
    },
    [setPreviewClipId]
  )

  const openSettings = useCallback(
    (tab: SettingsTab) => {
      setSettingsInitialTab(tab)
      setActiveView('settings')
      resetSearch()
    },
    [resetSearch, setActiveView]
  )

  const focusSearchBar = () => {
    if (activeView !== 'clips') return
    requestAnimationFrame(() => searchBarRef.current?.focus())
  }

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    let unlistenLocalAuthCallback: (() => void) | undefined

    const handleUrls = (urls: string[]) => {
      if (import.meta.env.DEV) {
        diagnostic('auth_deep_link_callback_received')
      }

      for (const url of urls) {
        if (handledAuthUrlsRef.current.has(url)) continue
        handledAuthUrlsRef.current.add(url)

        void completeAuthCallback(url).then(completed => {
          if (completed) {
            void invoke('show_main_window_command')
          }
        })
      }
    }

    const setupAuth = async () => {
      await initializeAuth()

      unlistenLocalAuthCallback = await listen<string>('auth-callback-url', event => {
        if (!cancelled) handleUrls([event.payload])
      })

      unlisten = await onOpenUrl(urls => {
        if (!cancelled) handleUrls(urls)
      })

      if (import.meta.env.DEV) diagnostic('auth_deep_link_listener_registered')

      const initialUrls = await getCurrent()
      if (import.meta.env.DEV) {
        diagnostic('auth_initial_deep_link_state')
      }
      if (!cancelled && initialUrls) {
        handleUrls(initialUrls)
      }
    }

    void setupAuth().catch(() => {
      // Auth stays unavailable until Settings is opened if platform setup failed.
    })

    return () => {
      cancelled = true
      unlisten?.()
      unlistenLocalAuthCallback?.()
    }
  }, [completeAuthCallback, initializeAuth])

  useEffect(() => {
    const reload = () => {
      void loadCommandBindings().catch(() => undefined)
    }
    reload()
    window.addEventListener(SYNC_APPLIED_EVENT, reload)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, reload)
  }, [])

  useEffect(() => {
    historyRatioRef.current = historyRatio
  }, [historyRatio])

  useEffect(() => {
    let cancelled = false
    void invoke<number>('get_history_split_ratio')
      .then(ratio => {
        if (!cancelled) setHistoryRatio(ratio)
      })
      .catch(() => {
        if (!cancelled) setSplitSaveError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const container = splitViewRef.current
    if (!container) return
    const update = () => setSplitContainerWidth(container.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeView])

  useEffect(
    () => () => {
      splitCleanupRef.current?.()
    },
    []
  )

  useEffect(() => {
    if (authStatus !== 'signed_in' || !authUserId) return
    let cancelled = false
    let unlistenFocus: (() => void) | undefined
    const onOnline = () => {
      void configurationSyncScheduler.request('reconnect').catch(() => undefined)
    }
    const onProfileMutation = () => {
      void configurationSyncScheduler.request('mutation')
    }
    const setup = async () => {
      let focused = true
      try {
        const currentWindow = getCurrentWindow()
        focused = await currentWindow.isFocused()
        const dispose = await currentWindow.onFocusChanged(event => {
          configurationSyncScheduler.setWindowActive(event.payload)
        })
        if (cancelled) {
          dispose()
          return
        }
        unlistenFocus = dispose
      } catch {
        // The web fallback stays active when native focus inspection is unavailable.
      }
      if (cancelled) return
      void configurationSyncScheduler
        .start({
          userId: authUserId,
          active: focused,
          onSynchronized: () => useSettingsStore.getState().loadSettings(),
        })
        .catch(() => undefined)
    }

    window.addEventListener('online', onOnline)
    window.addEventListener(PROFILE_MUTATED_EVENT, onProfileMutation)
    void setup()
    return () => {
      cancelled = true
      unlistenFocus?.()
      configurationSyncScheduler.stop()
      window.removeEventListener('online', onOnline)
      window.removeEventListener(PROFILE_MUTATED_EVENT, onProfileMutation)
    }
  }, [authStatus, authUserId])

  // Apply theme as soon as settings load
  useEffect(() => {
    if (settings?.theme) {
      setThemeMode(settings.theme)
    }
  }, [settings?.theme, setThemeMode])

  useEffect(() => {
    const loadTextSearchStatus = async () => {
      try {
        const [status, sources, generation] = await Promise.all([
          invoke<TextEmbeddingStatus>('get_text_embedding_status'),
          invoke<SearchSourceDescriptor[]>('list_search_sources'),
          invoke<GenerationProviderStatus>('get_text_generation_status'),
        ])
        setTextSearchStatus(status)
        setSearchSources(Array.isArray(sources) ? sources : [])
        setGenerationStatus(generation)
        setSemanticActive(
          sources.some(source => source.id === 'builtin.search.semantic_text' && source.enabled)
        )
      } catch {
        setTextSearchStatus(null)
      }
    }

    void loadTextSearchStatus()

    const unlistenCapabilities = listen('embedding-provider-status-changed', () => {
      void loadTextSearchStatus()
    })
    const unlistenGeneration = listen('generation-provider-status-changed', () => {
      void loadTextSearchStatus()
    })
    const unlistenThreshold = listen('meaning-search-threshold-changed', () => {
      void refreshSearch()
    })

    const unlistenTextSearchStatus = listen('embedding-space-changed', () => {
      void loadTextSearchStatus()
    })
    const unlistenSourceStatus = listen('search-source-status-changed', () => {
      void loadTextSearchStatus()
    })
    const unlistenIndexProgress = listen('search-index-progress', () => {
      void loadTextSearchStatus()
    })

    return () => {
      void unlistenCapabilities.then(fn => fn())
      void unlistenGeneration.then(fn => fn())
      void unlistenThreshold.then(fn => fn())
      void unlistenTextSearchStatus.then(fn => fn())
      void unlistenSourceStatus.then(fn => fn())
      void unlistenIndexProgress.then(fn => fn())
    }
  }, [refreshSearch, setSemanticActive])

  const handleToggleSource = useCallback(
    async (sourceId: string) => {
      if (sourceId === 'builtin.search.fts') return
      const current = await invoke<{
        syntaxMode: 'simple' | 'advanced'
        enabledSourceIds: string[]
      }>('get_search_settings')
      const enabledSourceIds = current.enabledSourceIds.includes(sourceId)
        ? current.enabledSourceIds.filter(id => id !== sourceId)
        : [...current.enabledSourceIds, sourceId]
      await invoke('update_search_settings', { settings: { ...current, enabledSourceIds } })
      setSemanticActive(enabledSourceIds.includes('builtin.search.semantic_text'))
      setSearchSources(await invoke<SearchSourceDescriptor[]>('list_search_sources'))
      await refreshSearch()
    },
    [refreshSearch, setSemanticActive]
  )

  // Event Listener for Tray "Settings" click
  useEffect(() => {
    const unlisten = listen('open-settings', () => {
      openSettings('general')
    })
    return () => {
      void unlisten.then(f => f())
    }
  }, [openSettings])

  useEffect(() => {
    focusSearchBar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchCommandShortcut(e, 'core.recall', { modifiers: ['primary'], key: 'Enter' })) {
        // Recall owns modified Enter in Clips. Consuming it prevents history activation/paste.
        if (activeView !== 'clips' || e.repeat || e.isComposing) return
        const target = e.target as HTMLElement | null
        const editable = target?.matches('input, textarea, [contenteditable="true"]') ?? false
        const isMainSearch = target?.closest('[data-recall-input="main"]') != null
        const isFollowUp = target?.closest('[data-recall-input="follow-up"]') != null
        if (isFollowUp) return
        if (editable && !isMainSearch && !isFollowUp) return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!searchQuery.trim()) searchBarRef.current?.focus()
        else runRecall()
        return
      }
      if (matchCommandShortcut(e, 'core.focus_search', { modifiers: ['primary'], key: 'K' })) {
        if (e.repeat || e.isComposing) return
        e.preventDefault()
        searchBarRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeView, runRecall, searchQuery])

  useEffect(() => {
    const unlisten = listen('main-window-activated', focusSearchBar)
    return () => {
      void unlisten.then(dispose => dispose())
    }
    // Re-register so the handler observes the current page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  const handleClear = () => {
    resetSearch()
  }

  const persistHistoryRatio = useCallback(async (ratio: number) => {
    try {
      const saved = await invoke<number>('set_history_split_ratio', { ratio })
      setHistoryRatio(saved)
      setSplitSaveError(false)
    } catch {
      setSplitSaveError(true)
    }
  }, [])

  const beginSplitResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const container = splitViewRef.current
      if (!container) return
      event.preventDefault()
      const separator = event.currentTarget
      const initialRatio = historyRatioRef.current
      separator.setPointerCapture(event.pointerId)
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))

      const resize = (pointerEvent: PointerEvent) => {
        const bounds = container.getBoundingClientRect()
        if (bounds.width <= 0) return
        const available = Math.max(1, bounds.width - SPLITTER_WIDTH_PX)
        const next = (pointerEvent.clientX - bounds.left) / available
        const clamped = clampHistoryRatio(next, bounds.width)
        historyRatioRef.current = clamped
        setHistoryRatio(clamped)
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', resize)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', cancel)
        separator.removeEventListener('lostpointercapture', cancel)
        window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
        splitCleanupRef.current = null
      }
      const finish = () => {
        cleanup()
        void persistHistoryRatio(historyRatioRef.current)
      }
      const cancel = () => {
        cleanup()
        historyRatioRef.current = initialRatio
        setHistoryRatio(initialRatio)
      }
      splitCleanupRef.current?.()
      splitCleanupRef.current = cancel
      window.addEventListener('pointermove', resize)
      window.addEventListener('pointerup', finish, { once: true })
      window.addEventListener('pointercancel', cancel, { once: true })
      separator.addEventListener('lostpointercapture', cancel, { once: true })
    },
    [persistHistoryRatio]
  )

  const handleSplitKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 0.1 : 0.02
      let next: number | null = null
      if (event.key === 'ArrowLeft') next = historyRatioRef.current - step
      if (event.key === 'ArrowRight') next = historyRatioRef.current + step
      if (event.key === 'Home') next = 0.2
      if (event.key === 'End') next = 0.8
      if (event.key === '0') next = 0.5
      if (next == null) return
      event.preventDefault()
      const clamped = clampHistoryRatio(next, splitContainerWidth)
      historyRatioRef.current = clamped
      setHistoryRatio(clamped)
      void persistHistoryRatio(clamped)
    },
    [persistHistoryRatio, splitContainerWidth]
  )

  return (
    // Main Container - Single Background Color/Gradient Source
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100/30 dark:bg-slate-950/60 text-gray-900 dark:text-gray-100 font-sans selection:bg-blue-500/30 rounded-xl border border-white/40 dark:border-white/10">
      {/* 1. TitleBar (Top, Full Width) */}
      <TitleBar />

      {/* Middle Section: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* 2. Sidebar (Left) */}
        <Sidebar
          onAccountClick={() => openSettings('account')}
          onSettingsClick={() => openSettings('general')}
        />

        {/* 3. Main Content — glass L1 wrapper */}
        <div className="flex-1 relative my-1 flex flex-col min-w-0 rounded-xl overflow-hidden mr-2 bg-slate-100/40 dark:bg-slate-100/5 backdrop-blur-xl border border-white/10 dark:border-white/10">
          <div className="flex-1 flex flex-col mx-auto w-full relative overflow-hidden max-w-lvw">
            {/* Content varies by View */}
            {activeView === 'clips' && (
              <div className="flex flex-col h-full p-6 overflow-hidden">
                {/* Search Bar - Always Top */}
                <div className="w-full max-w-4xl mx-auto shrink-0 mb-6">
                  <SearchBar
                    ref={searchBarRef}
                    value={searchQuery}
                    onChange={setSearchQuery}
                    onClear={handleClear}
                    onScopeChange={scope => {
                      void setClipboardTab(scope)
                    }}
                    activeScope={activeTab}
                    autoFocus={false}
                    semanticStatus={textSearchStatus}
                    isSemanticActive={isSemanticActive}
                    searchSources={searchSources}
                    onToggleSource={sourceId => void handleToggleSource(sourceId)}
                    sourceOutcomes={searchSourceOutcomes}
                    placeholder="Search clips or ask a question…"
                    canRecall={parsedRecallQuery.query.length > 0}
                    isRecalling={recall.isRunning}
                    recallShortcut={formatShortcut(
                      commandShortcut('core.recall', { modifiers: ['primary'], key: 'Enter' })
                    )}
                    recallAvailable={Boolean(
                      generationStatus?.enabled && generationStatus.available
                    )}
                    onRecall={() => void runRecall()}
                  />
                </div>

                {/* Split View Container */}
                <div ref={splitViewRef} className="flex min-h-0 flex-1 overflow-hidden">
                  {/* LEFT PANEL — glass L1, peers with Preview */}
                  <div
                    className="min-w-0 shrink-0 flex flex-col overflow-hidden rounded-2xl bg-slate-100/10 dark:bg-slate-100/5 backdrop-blur-xl animate-slide-in-left"
                    id="history-panel"
                    style={{
                      width: `calc((100% - ${SPLITTER_WIDTH_PX}px) * ${effectiveHistoryRatio})`,
                    }}
                  >
                    <ClipboardHistory
                      searchQuery={searchQuery}
                      className="flex-1"
                      onPreviewItem={handlePreviewItem}
                    />
                  </div>
                  <button
                    type="button"
                    role="separator"
                    aria-label={t('layout.resizeHistoryPreview')}
                    aria-orientation="vertical"
                    aria-controls="history-panel preview-panel"
                    aria-valuemin={20}
                    aria-valuemax={80}
                    aria-valuenow={Math.round(effectiveHistoryRatio * 100)}
                    aria-valuetext={t('layout.historyWidthPercent', {
                      value: Math.round(effectiveHistoryRatio * 100),
                    })}
                    className="group relative w-6 shrink-0 cursor-col-resize touch-none outline-none"
                    onPointerDown={beginSplitResize}
                    onKeyDown={handleSplitKeyDown}
                  >
                    <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 rounded-full bg-slate-300/55 transition-colors group-hover:bg-violet-400/70 group-focus-visible:bg-violet-500 dark:bg-white/10" />
                  </button>
                  {/* RIGHT PANEL: Preview & Actions */}
                  <div
                    id="preview-panel"
                    className="relative min-w-0 flex-1 flex flex-col overflow-hidden"
                  >
                    <div className="pointer-events-none absolute right-4.5 top-3 z-10">
                      <div className="pointer-events-auto">{tabSwitcher}</div>
                    </div>
                    {(() => {
                      if (effectiveRightTab === 'recall' && recall.turns.length > 0) {
                        return (
                          <RecallWorkspace
                            turns={recall.turns}
                            scopeLabel={recall.scope?.label ?? recallScope.label}
                            isRunning={recall.isRunning}
                            expired={recall.expired}
                            onCancel={() => void recall.cancel()}
                            onClear={() => {
                              recall.clear()
                              setRightTab('preview')
                              searchBarRef.current?.focus()
                            }}
                            onFollowUp={question => void recall.followUp(question)}
                            onRetry={turn =>
                              void recall.startRoot(turn.question, recall.scope ?? recallScope)
                            }
                            onApplySources={(turn, clipIds) =>
                              void recall.rerunWithSources(turn.question, clipIds)
                            }
                            onSearchAll={turn => void recall.searchAll(turn.question)}
                            onOpenClip={clipId => {
                              const open = async () => {
                                if (
                                  !useClipboardStore
                                    .getState()
                                    .clips.some(clip => clip.id === clipId)
                                ) {
                                  const detail = await invoke<{ clip: (typeof clips)[number] }>(
                                    'get_clip_detail',
                                    { clipId }
                                  )
                                  addNewClip(detail.clip)
                                }
                                setPreviewClipId(clipId)
                                setRightTab('preview')
                              }
                              void open()
                            }}
                          />
                        )
                      }
                      const displayedClip = previewClip
                      if (displayedClip) {
                        return <ClipPreview clip={displayedClip} />
                      }
                      return (
                        <div className="w-full flex-1 flex flex-col items-center justify-center animate-fade-in rounded-2xl border border-dashed border-slate-200/70 bg-slate-100/10 dark:border-white/5 dark:bg-slate-100/5">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('app.emptyTitle')}
                          </p>
                          <p className="text-xs text-gray-500 mt-2 text-center max-w-60">
                            {t('app.emptyDescription')}
                          </p>
                        </div>
                      )
                    })()}
                  </div>
                  {splitSaveError && (
                    <p role="alert" className="sr-only">
                      {t('layout.saveFailed')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeView === 'settings' && <Settings initialTab={settingsInitialTab} />}

            {activeView === 'extensions' && <Plugins />}

            {activeView === 'intelligence' && <IntelligencePage />}

            <UpdateBanner />
          </div>
        </div>
      </div>

      {/* 4. BottomBar (Bottom, Full Width) */}
      <BottomBar />
    </div>
  )
}
