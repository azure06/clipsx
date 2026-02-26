import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

import { SearchBar } from '../search/SearchBar'
import { ClipPreview } from '../clipboard/ClipPreview'
import { Sidebar } from '../../shared/components/Sidebar'
import { TitleBar } from '../../shared/components/TitleBar'
import { BottomBar } from '../../shared/components/BottomBar'
import { ClipboardHistory } from '../clipboard/ClipboardHistory'
import { Settings } from '../settings/Settings'
import { Plugins } from '../settings/Plugins'
import { useUIStore, useSettingsStore } from '../../stores'

export const AppLayout = () => {
  const {
    activeView,
    setActiveView,
    searchQuery,
    setSearchQuery,
    previewClip,
    setPreviewClip,
    resetSearch,
    isSemanticActive,
    toggleSemantic,
  } = useUIStore()
  const { loadSettings } = useSettingsStore()
  const [isModelReady, setIsModelReady] = useState(false)

  // Load settings on app start
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // Check if an AI model is loaded (poll periodically)
  useEffect(() => {
    const check = async () => {
      try {
        const ready = await invoke<boolean>('get_semantic_search_status')
        setIsModelReady(ready)
      } catch {
        setIsModelReady(false)
      }
    }
    void check()
    const interval = setInterval(() => void check(), 5000)
    return () => clearInterval(interval)
  }, [])

  // Event Listener for Tray "Settings" click
  useEffect(() => {
    const unlisten = listen('open-settings', () => {
      setActiveView('settings')
      resetSearch()
    })
    return () => {
      void unlisten.then(f => f())
    }
  }, [setActiveView, resetSearch])

  const handleClear = () => {
    resetSearch()
  }

  return (
    // Main Container - Single Background Color/Gradient Source
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950/60 text-gray-100 font-sans selection:bg-blue-500/30 rounded-lg border border-gray-300/20">
      {/* 1. TitleBar (Top, Full Width) */}
      <TitleBar />

      {/* Middle Section: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* 2. Sidebar (Left) */}
        <Sidebar onLoginClick={() => console.log('Login clicked')} />

        {/* 3. Main Content (Center - Card Style) */}
        <div className="flex-1 relative flex flex-col min-w-0 bg-white/5 rounded-xl border border-white/10 shadow-2xl overflow-hidden backdrop-blur-md mr-2">
          <div className="flex-1 flex flex-col mx-auto w-full relative overflow-hidden max-w-lvw">
            {/* Content varies by View */}
            {activeView === 'clips' && (
              <div className="flex flex-col h-full p-6 overflow-hidden">
                {/* Search Bar - Always Top */}
                <div className="w-full max-w-4xl mx-auto shrink-0 mb-6">
                  <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    onClear={handleClear}
                    isSemanticAvailable={isModelReady}
                    isSemanticActive={isSemanticActive}
                    onToggleSemantic={toggleSemantic}
                  />
                </div>

                {/* Split View Container */}
                <div className="flex-1 flex gap-6 min-h-0 overflow-auto">
                  {/* LEFT PANEL: History List (Always Visible) */}
                  <div className="flex-1 min-w-0 flex flex-col overflow-hidden border border-white/5 rounded-2xl bg-white/5 animate-slide-in-left">
                    <ClipboardHistory
                      searchQuery={searchQuery}
                      className="flex-1"
                      onPreviewItem={setPreviewClip}
                    />
                  </div>
                  {/* RIGHT PANEL: Preview & Actions */}
                  <div className="w-1/2 shrink-0 flex flex-col gap-6 overflow-hidden">
                    {(() => {
                      const displayedClip = previewClip
                      if (displayedClip) {
                        return <ClipPreview clip={displayedClip} />
                      }
                      return (
                        <div className="w-full flex-1 flex flex-col items-center justify-center text-gray-400 animate-fade-in border border-dashed border-white/10 rounded-2xl bg-white/5">
                          <p className="text-sm font-medium">Capture Something First</p>
                          <p className="text-xs text-gray-500 mt-2 text-center max-w-60">
                            Your clipboard history is currently empty. Start copying items, and
                            they'll appear here for preview.
                          </p>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}

            {activeView === 'settings' && <Settings />}

            {activeView === 'plugins' && <Plugins />}
          </div>
        </div>
      </div>

      {/* 4. BottomBar (Bottom, Full Width) */}
      <BottomBar />
    </div>
  )
}
