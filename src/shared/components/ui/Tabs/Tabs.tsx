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
}

export const Tabs = ({
  tabs,
  defaultTab,
  onTabChange,
  orientation = 'horizontal',
  className = '',
}: TabsProps) => {
  const isVertical = orientation === 'vertical'

  return (
    <TabsPrimitive.Root
      defaultValue={defaultTab || tabs[0]?.id}
      onValueChange={onTabChange}
      orientation={orientation}
      className={`flex ${isVertical ? 'flex-row gap-4' : 'flex-col'} ${className}`}
    >
      <TabsPrimitive.List
        className={`flex ${isVertical ? 'flex-col' : 'flex-row gap-0.5'} ${
          !isVertical &&
          'border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/30 px-3'
        }`}
      >
        {tabs.map(tab => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            disabled={tab.disabled}
            className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 border-b-2 relative overflow-hidden cursor-pointer data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:scale-105 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {tab.icon && (
              <span className="transition-transform duration-200 group-hover:scale-110">
                {tab.icon}
              </span>
            )}
            {tab.label}
            <TabsPrimitive.Content value={tab.id} asChild>
              <span className="data-[state=active]:absolute data-[state=active]:inset-x-0 data-[state=active]:bottom-0 data-[state=active]:h-0.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-violet-500 data-[state=active]:animate-pulse" />
            </TabsPrimitive.Content>
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

      <div className="flex-1">
        {tabs.map(tab => (
          <TabsPrimitive.Content key={tab.id} value={tab.id} className="focus:outline-none">
            {tab.content}
          </TabsPrimitive.Content>
        ))}
      </div>
    </TabsPrimitive.Root>
  )
}
