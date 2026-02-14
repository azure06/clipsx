import { useState } from 'react'
import { ClipboardHistory } from './features/clipboard'
import { Settings } from './features/settings'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { ThemeProvider } from './shared/hooks/useTheme'
import { Sidebar } from './shared/components/Sidebar'
import { TitleBar } from './shared/components/TitleBar'
import { useClipboardStore } from './stores'

const App = () => {
  const [activeView, setActiveView] = useState<'clips' | 'plugins' | 'settings'>('clips')
  const clips = useClipboardStore(state => state.clips)

  const handleLoginClick = () => {
    alert('Login/Account coming soon!')
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <div
          id="app-container"
          className="flex h-screen flex-col overflow-hidden rounded-md bg-gray-900 shadow-2xl"
        >
          {/* Draggable Title Bar */}
          <TitleBar activeView={activeView} clipCount={clips.length} />

          {/* Main Content Area */}
          <div className="flex flex-1 overflow-hidden">
            <Sidebar
              activeView={activeView}
              onViewChange={setActiveView}
              onLoginClick={handleLoginClick}
            />
            <div className="flex flex-1 flex-col overflow-hidden">
              {activeView === 'clips' && <ClipboardHistory />}
              {activeView === 'plugins' && (
                <div className="flex h-full items-center justify-center p-12">
                  <div className="text-center">
                    <p className="mb-2 text-lg font-medium text-gray-100">Plugins</p>
                    <p className="text-sm text-gray-400">
                      Coming soon - Extend Clips with custom actions
                    </p>
                  </div>
                </div>
              )}
              {activeView === 'settings' && <Settings />}
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
