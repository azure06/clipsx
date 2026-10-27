import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

export type TabItem = {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
  readonly content: ReactNode
  readonly disabled?: boolean
}

type TabsOrientation = 'horizontal' | 'vertical'

export type TabsProps = {
  readonly headerActions?: ReactNode
  readonly headerClassName?: string
  readonly appearance?: 'underline' | 'workspace'
  readonly tabs: readonly TabItem[]
  readonly defaultTab?: string
  readonly onTabChange?: (tabId: string) => void
  readonly orientation?: TabsOrientation
  readonly className?: string
  readonly activeTab?: string
  readonly keepMounted?: boolean
  readonly listClassName?: string
  readonly panelsClassName?: string
  readonly panelClassName?: string
}

export const Tabs = ({
  tabs,
  headerActions,
  headerClassName = '',
  appearance = 'underline',
  defaultTab,
  onTabChange,
  orientation = 'horizontal',
  className = '',
  activeTab,
  keepMounted = false,
  listClassName = '',
  panelsClassName = '',
  panelClassName = '',
}: TabsProps) => {
  const isVertical = orientation === 'vertical'

  const tabList = (
    <TabsPrimitive.List
      className={`flex ${appearance === 'workspace' ? 'gap-1 rounded-xl border border-slate-200/70 bg-slate-100/70 p-1 dark:border-white/8 dark:bg-black/15' : ''} ${listClassName} ${isVertical ? 'flex-col' : 'flex-row gap-0.5'} ${
        appearance !== 'workspace' &&
        !isVertical &&
        'border-b border-gray-200 dark:border-gray-800 bg-slate-100/60 dark:bg-slate-900/30 px-3'
      }`}
    >
      {tabs.map(tab => (
        <TabsPrimitive.Trigger
          key={tab.id}
          value={tab.id}
          disabled={tab.disabled}
          className={
            appearance === 'workspace'
              ? 'relative flex min-w-0 items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-xs font-medium text-slate-500 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5 dark:text-slate-400 dark:data-[state=active]:bg-slate-700/70 dark:data-[state=active]:text-violet-200 dark:data-[state=active]:ring-white/10 motion-safe:transition-[color,background-color,box-shadow] motion-safe:duration-200 disabled:opacity-50'
              : `group outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 border-b-2 relative overflow-hidden cursor-pointer data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 hover:scale-105 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed`
          }
        >
          {tab.icon && (
            <span className="transition-transform duration-200 group-hover:scale-110">
              {tab.icon}
            </span>
          )}
          {tab.label}
          {appearance !== 'workspace' && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-linear-to-r from-blue-500 to-violet-500 opacity-0 group-data-[state=active]:opacity-100"
            />
          )}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  )

  return (
    <TabsPrimitive.Root
      defaultValue={defaultTab || tabs[0]?.id}
      value={activeTab}
      onValueChange={onTabChange}
      orientation={orientation}
      className={`flex ${isVertical ? 'flex-row gap-4' : 'flex-col'} ${className}`}
    >
      {headerActions !== undefined ? (
        <div
          className={`flex min-w-0 shrink-0 items-center justify-between gap-2 ${headerClassName}`}
        >
          {tabList}
          <div className="flex min-w-0 flex-1 justify-end">{headerActions}</div>
        </div>
      ) : (
        tabList
      )}

      <div className={`flex-1 ${panelsClassName}`}>
        {tabs.map(tab => (
          <TabsPrimitive.Content
            key={tab.id}
            value={tab.id}
            forceMount={keepMounted ? true : undefined}
            className={`focus:outline-none ${keepMounted ? 'data-[state=inactive]:hidden' : ''} ${panelClassName}`}
          >
            {tab.content}
          </TabsPrimitive.Content>
        ))}
      </div>
    </TabsPrimitive.Root>
  )
}
