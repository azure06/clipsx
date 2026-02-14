type TitleBarProps = {
  readonly activeView: 'clips' | 'plugins' | 'settings'
  readonly clipCount: number
}

const getViewTitle = (view: 'clips' | 'plugins' | 'settings'): string => {
  switch (view) {
    case 'clips':
      return 'Clips'
    case 'plugins':
      return 'Plugins'
    case 'settings':
      return 'Settings'
    default:
      return 'Clips'
  }
}

export const TitleBar = ({ activeView, clipCount }: TitleBarProps) => (
  <div
    data-tauri-drag-region
    className="relative flex h-8 shrink-0 select-none items-center px-3 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800/50"
  >
    {/* Left: Window dots + Title with accent bar */}
    <div className="flex items-center gap-3 text-[10px] text-gray-500 pointer-events-none">
      <div className="flex items-center gap-1.5">
        <span>●</span>
        <span>●</span>
        <span>●</span>
      </div>

      {/* Title with top accent bar */}
      <div className="absolute top-0 left-20 flex flex-col items-center gap-1">
        {/* Accent bar */}
        <div
          className="h-1 bg-gradient-to-r from-blue-400 to-violet-400 shadow-lg shadow-blue-400/60 rounded-b-full"
          style={{ width: '64px' }}
        />
        {/* Title text */}
        <span className="text-[10px] font-bold text-gray-300 tracking-wider">
          {getViewTitle(activeView)}
        </span>
      </div>
    </div>

    {/* Right: Clip count */}
    <div className="ml-auto text-[11px] font-semibold text-gray-400 pointer-events-none">
      {clipCount} {clipCount === 1 ? 'clip' : 'clips'}
    </div>
  </div>
)
