import { Layers, Blocks, Settings, User } from 'lucide-react'
import { useUIStore } from '../../stores'

type SidebarProps = {
  // activeView and onViewChange handled by store now
  onLoginClick: () => void
}

export const Sidebar = ({ onLoginClick }: SidebarProps) => {
  const { activeView, setActiveView } = useUIStore()

  return (
    <div className="flex w-12 shrink-0 flex-col items-center py-3">
      {/* Top Icons */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={() => setActiveView('clips')}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            activeView === 'clips' ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'
          }`}
          title="Clipboard History"
        >
          <Layers className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'clips' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-gray-400" />
          )}
        </button>

        <button
          onClick={() => setActiveView('plugins')}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            activeView === 'plugins' ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'
          }`}
          title="Plugins"
        >
          <Blocks className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'plugins' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-gray-400" />
          )}
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Icons */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={onLoginClick}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors cursor-pointer hover:bg-gray-800/50 hover:text-gray-300"
          title="Account"
        >
          <User className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        <button
          onClick={() => setActiveView('settings')}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            activeView === 'settings' ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'
          }`}
          title="Settings"
        >
          <Settings className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'settings' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-gray-400" />
          )}
        </button>
      </div>
    </div>
  )
}
