import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronRight } from 'lucide-react'

export type SelectOption<T extends string = string> = {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
}

export type SelectProps<T extends string = string> = {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly options: readonly SelectOption<T>[]
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly className?: string
}

export const Select = <T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className = '',
}: SelectProps<T>) => {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={`inline-flex items-center justify-between gap-2 rounded-lg border border-gray-300/70 dark:border-gray-700 bg-slate-100/70 dark:bg-slate-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-slate-200/60 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-gray-500" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="overflow-hidden rounded-lg border border-gray-200/80 dark:border-gray-800 bg-slate-100/90 dark:bg-slate-900/95 backdrop-blur-xl shadow-lg"
          position="popper"
          sideOffset={4}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map(option => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none items-center rounded px-8 py-1.5 text-sm text-gray-900 dark:text-gray-100 outline-none data-highlighted:bg-slate-100 dark:data-highlighted:bg-slate-800 data-disabled:opacity-50 data-disabled:cursor-not-allowed"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <svg
                    className="h-4 w-4 text-blue-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
