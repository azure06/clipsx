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

  return (
    <TabsPrimitive.Root
      defaultValue={defaultTab || tabs[0]?.id}
      value={activeTab}
      onValueChange={onTabChange}
      orientation={orientation}
      className={`flex ${isVertical ? 'flex-row gap-4' : 'flex-col'} ${className}`}
    >
      <TabsPrimitive.List
        className={`flex ${listClassName} ${isVertical ? 'flex-col' : 'flex-row gap-0.5'} ${
          !isVertical &&
          'border-b border-gray-200 dark:border-gray-800 bg-slate-100/60 dark:bg-slate-900/30 px-3'
        }`}
      >
        {tabs.map(tab => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            disabled={tab.disabled}
            className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 border-b-2 relative overflow-hidden cursor-pointer data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 hover:scale-105 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {tab.icon && (
              <span className="transition-transform duration-200 group-hover:scale-110">
                {tab.icon}
              </span>
            )}
            {tab.label}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-linear-to-r from-blue-500 to-violet-500 opacity-0 group-data-[state=active]:opacity-100"
            />
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

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
