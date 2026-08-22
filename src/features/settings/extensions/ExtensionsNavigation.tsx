import { Box, Code2, Compass, Download } from 'lucide-react'

export type ExtensionsDestination = 'installed' | 'discover' | 'builtins' | 'developer'

const items: Array<{ id: ExtensionsDestination; label: string; icon: typeof Download }> = [
  { id: 'installed', label: 'Installed', icon: Download },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'builtins', label: 'Built-ins', icon: Box },
  { id: 'developer', label: 'Developer', icon: Code2 },
]

export const ExtensionsNavigation = ({
  value,
  onChange,
}: {
  value: ExtensionsDestination
  onChange: (value: ExtensionsDestination) => void
}) => (
  <nav
    aria-label="Extensions destinations"
    className="flex shrink-0 gap-1 rounded-xl border border-slate-200/75 bg-white/45 p-1 shadow-[0_10px_28px_-24px_rgba(71,85,105,.45)] dark:border-white/10 dark:bg-slate-950/25"
  >
    {items.map(item => {
      const Icon = item.icon
      const selected = item.id === value
      return (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${
            selected
              ? 'bg-gradient-to-r from-violet-500/14 to-fuchsia-500/10 text-violet-800 shadow-sm dark:text-violet-200'
              : 'text-slate-500 hover:bg-slate-900/[.035] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[.055] dark:hover:text-slate-200'
          }`}
        >
          <Icon className={`h-3.5 w-3.5 ${selected ? 'text-violet-500' : ''}`} />
          {item.label}
        </button>
      )
    })}
  </nav>
)
