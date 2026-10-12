import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Fragment, useId, useRef, useState, type ReactNode } from 'react'
import type { SelectOption } from './Select'
import { dropdownSurfaceClass } from './dropdownStyles'

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  searchLabel,
  emptyLabel,
  disabled = false,
  compact = false,
  leading,
}: {
  label: string
  value: string
  options: readonly (SelectOption & { group?: string; icon?: ReactNode })[]
  onChange: (value: string) => void
  placeholder: string
  searchLabel: string
  emptyLabel: string
  disabled?: boolean
  compact?: boolean
  leading?: ReactNode
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeValue, setActiveValue] = useState('')
  const filtered = options.filter(option =>
    [option.label, option.group ?? ''].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  )
  const enabled = filtered.filter(option => !option.disabled)
  const active = enabled.find(option => option.value === activeValue) ?? enabled[0]
  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <div className={compact ? 'grid min-w-0 max-w-48' : 'grid w-full min-w-0 gap-1.5'}>
      <label
        htmlFor={id}
        className={compact ? 'sr-only' : 'text-xs font-semibold text-slate-700 dark:text-slate-200'}
      >
        {label}
      </label>
      <Popover.Root
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (next) {
            setQuery('')
            setActiveValue('')
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-haspopup="listbox"
            disabled={disabled}
            className={`flex w-full min-w-0 items-center justify-between gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 disabled:opacity-50 ${compact ? 'px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-200/50 dark:text-slate-300 dark:hover:bg-white/5' : 'border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-100'}`}
          >
            {leading}
            <span className="min-w-0 flex-1 truncate">
              {options.find(option => option.value === value)?.label ?? placeholder}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={label}
            sideOffset={4}
            collisionPadding={8}
            align="start"
            className={`${dropdownSurfaceClass} z-[80] flex max-h-[min(320px,var(--radix-popover-content-available-height))] ${compact ? 'w-80' : 'w-[var(--radix-popover-trigger-width)]'} max-w-[calc(100vw-1rem)] flex-col`}
            onOpenAutoFocus={event => {
              event.preventDefault()
              input.current?.focus()
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 px-3 dark:border-white/10">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <input
                ref={input}
                type="search"
                role="searchbox"
                aria-label={searchLabel}
                aria-controls={`${id}-list`}
                aria-activedescendant={
                  active ? `${id}-option-${filtered.indexOf(active)}` : undefined
                }
                value={query}
                placeholder={searchLabel}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-xs outline-none"
                onChange={event => {
                  setQuery(event.target.value)
                  setActiveValue('')
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return
                  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault()
                    if (!enabled.length) return
                    const index = active ? enabled.indexOf(active) : -1
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? enabled.length - 1
                          : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) %
                            enabled.length
                    const option = enabled[next]!
                    setActiveValue(option.value)
                    document
                      .getElementById(`${id}-option-${filtered.indexOf(option)}`)
                      ?.scrollIntoView({ block: 'nearest' })
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    if (active) choose(active.value)
                  }
                }}
              />
            </div>
            <div
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              className="min-h-0 overflow-y-auto p-1"
            >
              {filtered.map((option, index) => (
                <Fragment key={option.value}>
                  {option.group && option.group !== filtered[index - 1]?.group && (
                    <div
                      role="presentation"
                      className="px-3 pb-1 pt-2 text-[10px] font-semibold text-slate-500"
                    >
                      {option.group}
                    </div>
                  )}
                  <button
                    key={option.value}
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={value === option.value}
                    aria-disabled={option.disabled || undefined}
                    disabled={option.disabled}
                    tabIndex={-1}
                    title={option.label}
                    aria-label={option.group ? `${option.group}: ${option.label}` : undefined}
                    onMouseDown={event => event.preventDefault()}
                    onPointerMove={() => setActiveValue(option.value)}
                    onClick={() => choose(option.value)}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-xs outline-none disabled:opacity-50 ${active?.value === option.value ? 'bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'text-slate-700 dark:text-slate-200'}`}
                  >
                    <Check
                      aria-hidden
                      className={`h-3.5 w-3.5 shrink-0 text-violet-500 ${value === option.value ? '' : 'opacity-0'}`}
                    />
                    {option.icon}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </button>
                </Fragment>
              ))}
              {!filtered.length && (
                <p role="status" className="px-3 py-5 text-center text-xs text-slate-500">
                  {emptyLabel}
                </p>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
