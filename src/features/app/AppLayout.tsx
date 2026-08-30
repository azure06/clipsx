import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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
import { useAuthStore, useClipboardStore, useUIStore, useSettingsStore } from '../../stores'
import { useTheme } from '../../shared/hooks/useTheme'
import type { SearchSourceDescriptor, TextEmbeddingStatus } from '../../shared/types/v2'
import { useTranslation } from 'react-i18next'
import { PROFILE_MUTATED_EVENT, synchronizeIfEnabled } from '../../shared/sync/configSync'

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
  const searchSourceOutcomes = useClipboardStore(state => state.searchSourceOutcomes)
  const { setThemeMode } = useTheme()
  const initializeAuth = useAuthStore(state => state.initialize)
  const completeAuthCallback = useAuthStore(state => state.completeCallback)
  const authStatus = useAuthStore(state => state.status)
  const authUserId = useAuthStore(state => state.userId)
  const [textSearchStatus, setTextSearchStatus] = useState<TextEmbeddingStatus | null>(null)
  const [searchSources, setSearchSources] = useState<SearchSourceDescriptor[]>([])
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general')
  const searchBarRef = useRef<SearchBarHandle>(null)
  const splitViewRef = useRef<HTMLDivElement>(null)
  const handledAuthUrlsRef = useRef(new Set<string>())
  const [historyWidth, setHistoryWidth] = useState(50)
  const previewClip = clips.find(clip => clip.id === previewClipId) ?? null

  const openSettings = useCallback(
    (tab: SettingsTab) => {
      setSettingsInitialTab(tab)
      setActiveView('settings')
      resetSearch()
    },
    [resetSearch, setActiveView]
  )

  const shouldPreserveFocusedEditor = () => {
    const active = document.activeElement
    if (!active || active === document.body) return false
    if (active instanceof HTMLTextAreaElement) return true
    if (active instanceof HTMLInputElement) return active.type !== 'search'
    return (active as HTMLElement).isContentEditable
  }

  const focusSearchBar = () => {
    if (activeView !== 'clips') return
    if (shouldPreserveFocusedEditor()) return

    requestAnimationFrame(() => {
      if (activeView !== 'clips') return
      if (shouldPreserveFocusedEditor()) return
      searchBarRef.current?.focus()
    })
  }

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    let unlistenLocalAuthCallback: (() => void) | undefined

    const handleUrls = (urls: string[]) => {
      if (import.meta.env.DEV) {
        console.info(
          '[AUTH] Deep-link callback received',
          urls.map(url => {
            try {
              const parsed = new URL(url)
              return {
                protocol: parsed.protocol,
                host: parsed.host,
                path: parsed.pathname,
                hasCode: parsed.searchParams.has('code'),
                hasError: parsed.searchParams.has('error'),
              }
            } catch {
              return { invalidUrl: true }
            }
          })
        )
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

      if (import.meta.env.DEV) console.info('[AUTH] Deep-link listener registered')

      const initialUrls = await getCurrent()
      if (import.meta.env.DEV) {
        console.info('[AUTH] Initial deep-link state', { urlCount: initialUrls?.length ?? 0 })
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
    if (authStatus !== 'signed_in' || !authUserId) return
    let cancelled = false
    const synchronize = () => {
      void synchronizeIfEnabled(authUserId)
        .then(status => {
          if (!cancelled && status) return useSettingsStore.getState().loadSettings()
        })
        .catch(() => undefined)
    }
    const onOnline = () => synchronize()
    const onProfileMutation = () => synchronize()
    synchronize()
    window.addEventListener('online', onOnline)
    window.addEventListener(PROFILE_MUTATED_EVENT, onProfileMutation)
    const timer = window.setInterval(synchronize, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
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
        const [status, sources] = await Promise.all([
          invoke<TextEmbeddingStatus>('get_text_embedding_status'),
          invoke<SearchSourceDescriptor[]>('list_search_sources'),
        ])
        setTextSearchStatus(status)
        setSearchSources(sources)
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
      void unlistenTextSearchStatus.then(fn => fn())
      void unlistenSourceStatus.then(fn => fn())
      void unlistenIndexProgress.then(fn => fn())
    }
  }, [setSemanticActive])

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchBarRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    let cancelled = false

    const setupFocusListener = async () => {
      const win = getCurrentWindow()
      const unlisten = await win.onFocusChanged(({ payload: focused }) => {
        if (focused && !cancelled) {
          focusSearchBar()
        }
      })

      return unlisten
    }

    const unlistenPromise = setupFocusListener()

    return () => {
      cancelled = true
      void unlistenPromise.then(unlisten => unlisten())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  const handleClear = () => {
    resetSearch()
  }

  const beginSplitResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const container = splitViewRef.current
    if (!container) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))

    const resize = (pointerEvent: PointerEvent) => {
      const bounds = container.getBoundingClientRect()
      if (bounds.width <= 0) return
      const minimum = Math.min(34, (280 / bounds.width) * 100)
      const maximum = Math.max(60, 100 - (420 / bounds.width) * 100)
      const next = ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
      setHistoryWidth(Math.min(maximum, Math.max(minimum, next)))
    }
    const finish = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finish)
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finish, { once: true })
  }, [])

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
                  />
                </div>

                {/* Split View Container */}
                <div ref={splitViewRef} className="flex min-h-0 flex-1 overflow-hidden">
                  {/* LEFT PANEL — glass L1, peers with Preview */}
                  <div
                    className="min-w-0 shrink-0 flex flex-col overflow-hidden rounded-2xl bg-slate-100/10 dark:bg-slate-100/5 backdrop-blur-xl animate-slide-in-left"
                    style={{ width: `${historyWidth}%` }}
                  >
                    <ClipboardHistory
                      searchQuery={searchQuery}
                      className="flex-1"
                      onPreviewItem={setPreviewClipId}
                    />
                  </div>
                  <button
                    type="button"
                    role="separator"
                    aria-label="Resize history and preview"
                    aria-orientation="vertical"
                    aria-valuenow={Math.round(historyWidth)}
                    className="group relative w-6 shrink-0 cursor-col-resize touch-none outline-none"
                    onPointerDown={beginSplitResize}
                  >
                    <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 rounded-full bg-slate-300/55 transition-colors group-hover:bg-violet-400/70 group-focus-visible:bg-violet-500 dark:bg-white/10" />
                  </button>
                  {/* RIGHT PANEL: Preview & Actions */}
                  <div className="min-w-0 flex-1 flex flex-col gap-6 overflow-hidden">
                    {(() => {
                      const displayedClip = previewClip
                      if (displayedClip) {
                        return <ClipPreview clip={displayedClip} />
                      }
                      return (
                        <div className="w-full flex-1 flex flex-col items-center justify-center animate-fade-in rounded-2xl bg-slate-100/10 dark:bg-slate-100/5 border-dashed">
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
