import type { ReactNode } from 'react'

export type SettingsNavigationItem<T extends string> = {
  readonly id: T
  readonly label: string
  readonly icon: ReactNode
  readonly group: 'preferences' | 'system'
}

type SettingsNavigationProps<T extends string> = {
  readonly activeTab: T
  readonly items: readonly SettingsNavigationItem<T>[]
  readonly onSelect: (tab: T) => void
  readonly title: string
}

export const SettingsNavigation = <T extends string>({
  activeTab,
  items,
  onSelect,
  title,
}: SettingsNavigationProps<T>) => {
  const groups: Array<{ id: SettingsNavigationItem<T>['group']; label: string }> = [
    { id: 'preferences', label: 'Preferences' },
    { id: 'system', label: 'System' },
  ]

  return (
    <aside className="w-52 shrink-0 border-r border-slate-200/70 bg-slate-50/35 px-3 py-5 dark:border-white/10 dark:bg-slate-950/20">
      <h2 className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {title}
      </h2>
      <nav className="mt-4 space-y-5" aria-label={title}>
        {groups.map(group => {
          const groupItems = items.filter(item => item.group === group.id)
          if (groupItems.length === 0) return null
          return (
            <div key={group.id}>
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400/90">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {groupItems.map(item => {
                  const selected = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${selected ? 'border-violet-400/20 bg-linear-to-r from-violet-500/12 to-fuchsia-500/8 text-violet-700 dark:text-violet-200' : 'border-transparent text-slate-500 hover:bg-slate-200/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100'}`}
                    >
                      <span
                        className={
                          selected ? 'text-violet-600 dark:text-violet-300' : 'text-slate-400'
                        }
                      >
                        {item.icon}
                      </span>
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
