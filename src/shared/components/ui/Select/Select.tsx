import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../../utils/cn'
import { dropdownItemClass, dropdownSurfaceClass } from '../dropdownStyles'

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
        className={cn(
          'inline-flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-slate-100/80 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-100/5 dark:text-gray-100 dark:hover:bg-white/10',
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-gray-500" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={cn(
            dropdownSurfaceClass,
            'max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)]'
          )}
          position="popper"
          sideOffset={4}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map(option => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(dropdownItemClass, 'px-8 py-1.5')}
              >
                <SelectPrimitive.ItemText className="truncate">
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <svg
                    className="h-4 w-4 text-violet-500"
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
