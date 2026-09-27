import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { cn } from '../../../utils/cn'
import { dropdownItemClass, dropdownSurfaceClass } from '../dropdownStyles'

export type SelectOption<T extends string = string> = {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
}
export type SelectGroup<T extends string = string> = {
  readonly label: string
  readonly options: readonly SelectOption<T>[]
}
export type SelectProps<T extends string = string> = {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly options?: readonly SelectOption<T>[]
  readonly groups?: readonly SelectGroup<T>[]
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly className?: string
  readonly id?: string
  readonly label?: string
  readonly helpText?: string
  readonly error?: string
  readonly ariaLabel?: string
  readonly ariaDescribedBy?: string
  readonly ariaInvalid?: boolean
}

export const Select = <T extends string = string>({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = 'Select...',
  disabled = false,
  className = '',
  id,
  label,
  helpText,
  error,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
}: SelectProps<T>) => {
  const generatedId = useId()
  const triggerId = id ?? generatedId
  const describedBy =
    [ariaDescribedBy, helpText ? `${triggerId}-help` : '', error ? `${triggerId}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined
  const item = (option: SelectOption<T>) => (
    <SelectPrimitive.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className={cn(dropdownItemClass, 'px-8 py-1.5')}
    >
      <SelectPrimitive.ItemText className="truncate">{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
        <Check className="h-4 w-4 text-violet-500" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
  return (
    <div className="inline-grid min-w-0 gap-1.5">
      {label && (
        <label
          htmlFor={triggerId}
          className="text-xs font-semibold text-slate-700 dark:text-slate-200"
        >
          {label}
        </label>
      )}
      <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          id={triggerId}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid ?? !!error}
          className={cn(
            'inline-flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-sm text-gray-900 transition-colors hover:bg-slate-100/80 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-100/5 dark:text-gray-100 dark:hover:bg-white/10 [&>span:first-child]:truncate',
            className
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className={cn(
              dropdownSurfaceClass,
              'z-[80] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)]'
            )}
            position="popper"
            sideOffset={4}
            collisionPadding={8}
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map(item)}
              {groups
                .filter(group => group.options.length)
                .map(group => (
                  <SelectPrimitive.Group key={group.label}>
                    <SelectPrimitive.Label className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {group.label}
                    </SelectPrimitive.Label>
                    {group.options.map(item)}
                  </SelectPrimitive.Group>
                ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {helpText && (
        <p id={`${triggerId}-help`} className="text-[11px] leading-4 text-slate-500">
          {helpText}
        </p>
      )}
      {error && (
        <p
          id={`${triggerId}-error`}
          role="alert"
          className="text-[11px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  )
}
