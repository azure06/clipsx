import { LayoutList, LayoutGrid } from 'lucide-react'
import type { ViewMode } from '../utils'

type ClipboardViewModeSelectorProps = {
  readonly mode: ViewMode
  readonly onChange: (mode: ViewMode) => void
}

export const ClipboardViewModeSelector = ({ mode, onChange }: ClipboardViewModeSelectorProps) => {
  const modes: Array<{ mode: ViewMode; icon: typeof LayoutList; label: string }> = [
    { mode: 'list', icon: LayoutList, label: 'List' },
    { mode: 'grid', icon: LayoutGrid, label: 'Grid' },
  ]

  return (
    <div className="flex items-center gap-0.5 rounded border border-gray-700 bg-gray-900 p-0.5">
      {modes.map(({ mode: m, icon: Icon, label }) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded p-1 transition-colors ${
            mode === m
              ? 'bg-linear-to-r from-violet-500 via-violet-400 to-violet-500 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={label}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      ))}
    </div>
  )
}
