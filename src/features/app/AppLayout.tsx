import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'

import { SearchBar } from '../search/SearchBar'
import { ClipPreview } from '../clipboard/ClipPreview'
import { Sidebar } from '../../shared/components/Sidebar'
import { TitleBar } from '../../shared/components/TitleBar'
import { BottomBar } from '../../shared/components/BottomBar'
import { ClipboardHistory } from '../clipboard/ClipboardHistory'
import { Settings } from '../settings/Settings'
import { useClipboardStore, useUIStore } from '../../stores'

export const AppLayout = () => {
  const {
    activeView,
    setActiveView,
    searchQuery,
    setSearchQuery,
    previewClip,
    setPreviewClip,
    resetSearch,
  } = useUIStore()
  const { clips } = useClipboardStore()

  // Derived state for active clip (first in list)
  const activeClip = clips[0]

  // Event Listener for Tray "Settings" click
  useEffect(() => {
    const unlisten = listen('open-settings', () => {
      setActiveView('settings')
      resetSearch()
      // Ensure window comes to front (handled by Rust, but good practice to be ready)
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
                  <SearchBar value={searchQuery} onChange={setSearchQuery} onClear={handleClear} />
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
                      const displayedClip = previewClip ?? activeClip
                      if (displayedClip) {
                        return <ClipPreview clip={displayedClip} />
                      }
                      return (
                        <div className="w-full flex-1 flex items-center justify-center text-gray-500 animate-fade-in">
                          <p>Select a clip to preview</p>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}

            {activeView === 'settings' && <Settings />}

            {activeView === 'plugins' && (
              <div className="w-full flex-1 flex items-center justify-center text-gray-500">
                <p>Plugins coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. BottomBar (Bottom, Full Width) */}
      <BottomBar />
    </div>
  )
}
