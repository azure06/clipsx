import { useUIStore, useClipboardStore } from '../../stores'

const getViewTitle = (view: string): string => {
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

// Decorum injects 3 buttons × 40px = 120px of window controls on the right on Windows
const isWindows = navigator.platform.includes('Win')

export const TitleBar = () => {
  const { activeView } = useUIStore()
  const { clips } = useClipboardStore()
  const clipCount = clips.length

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-8 shrink-0 select-none items-center px-3"
    >
      {/* Left: Title with accent bar */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500 pointer-events-none">
        {/* Title with top accent bar */}
        <div className="absolute top-0 left-24 flex flex-col items-center gap-1">
          {/* Accent bar */}
          <div
            className="h-1 bg-linear-to-r from-blue-400 to-violet-400 shadow-lg shadow-blue-400/60 rounded-b-full"
            style={{ width: '64px' }}
          />
          {/* Title text */}
          <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 tracking-wider">
            {getViewTitle(activeView)}
          </span>
        </div>
      </div>

      {/* Right: Clip count — inset extra on Windows so it clears the decorum buttons */}
      <div
        className="ml-auto text-[11px] font-semibold text-gray-500 dark:text-gray-400 pointer-events-none"
        style={isWindows ? { marginRight: '146px' } : undefined}
      >
        {clipCount} {clipCount === 1 ? 'clip' : 'clips'}
      </div>
    </div>
  )
}
