import {
  Search,
  Command,
  X,
  Sparkles,
  Image,
  Link,
  Type,
  Code,
  FileText,
  Briefcase,
  Star,
  Pin,
} from 'lucide-react'
import { forwardRef, useRef, useEffect, useState, useImperativeHandle } from 'react'
import { getPlatform } from '../../shared/keyboard/shortcuts'
import type { TextSearchStatus } from '../../shared/types'

const FILTER_OPTIONS = [
  { prefix: '/image', label: 'Images', description: 'Screenshots, photos', icon: Image },
  { prefix: '/url', label: 'URLs', description: 'Links and web addresses', icon: Link },
  { prefix: '/text', label: 'Text', description: 'Plain text clips', icon: Type },
  { prefix: '/code', label: 'Code', description: 'Code snippets', icon: Code },
  { prefix: '/file', label: 'Files', description: 'File paths', icon: FileText },
  { prefix: '/office', label: 'Office', description: 'Word, Excel, PPT', icon: Briefcase },
] as const

const SCOPE_OPTIONS = [
  {
    prefix: '/favorites',
    label: 'Favorites',
    description: 'Browse favorited clips. Backspace on empty clears it.',
    scope: 'favorites' as const,
    icon: Star,
  },
  {
    prefix: '/pinned',
    label: 'Pinned',
    description: 'Browse pinned clips. Backspace on empty clears it.',
    scope: 'pinned' as const,
    icon: Pin,
  },
]

const COMMAND_OPTIONS = [
  ...SCOPE_OPTIONS.map(option => ({ ...option, kind: 'scope' as const })),
  ...FILTER_OPTIONS.map(option => ({ ...option, kind: 'filter' as const })),
]

type ScopeCommand = 'all' | 'favorites' | 'pinned'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onScopeChange?: (scope: ScopeCommand) => void
  /** The active tab scope from the sidebar — renders as a removable pill */
  activeScope?: ScopeCommand
  placeholder?: string
  autoFocus?: boolean
  semanticStatus?: TextSearchStatus | null
  isSemanticActive?: boolean
  onToggleSemantic?: () => void
}

export interface SearchBarHandle {
  focus: () => void
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar(
  {
    value,
    onChange,
    onClear,
    onScopeChange,
    activeScope,
    placeholder = 'Type to search or paste...',
    autoFocus = true,
    semanticStatus = null,
    isSemanticActive = false,
    onToggleSemantic,
  },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [selectedFilterIndex, setSelectedFilterIndex] = useState(0)
  const lastAppliedScopeValueRef = useRef<string | null>(null)
  const isSemanticAvailable =
    semanticStatus?.state === 'ready' || semanticStatus?.state === 'indexing'
  const semanticHint =
    semanticStatus?.state === 'indexing'
      ? 'Semantic search is available while existing clips finish indexing in the background.'
      : semanticStatus && semanticStatus.state !== 'ready'
        ? `${semanticStatus.message}${isSemanticActive ? ' Using text search for now.' : ''}`
        : null

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        inputRef.current?.focus()
      },
    }),
    []
  )

  // Derive filter menu visibility from value (no useEffect needed)
  // Only show menu if the ENTIRE value is a slash command (no trailing string/space yet)
  const slashMatch = value.match(/^(\/\S*)$/)
  const currentSlash = slashMatch ? slashMatch[1] : null

  const filteredOptions = currentSlash
    ? COMMAND_OPTIONS.filter(opt => opt.prefix.toLowerCase().startsWith(currentSlash.toLowerCase()))
    : COMMAND_OPTIONS

  const showFilterMenu = isInputFocused && currentSlash !== null && filteredOptions.length > 0

  // Calculate Active Pill Information from typed value (filter commands only)
  const trimmedValue = value.trimStart()
  const firstWordMatch = trimmedValue.match(/^(\/\S+)/)
  const firstWord = firstWordMatch?.[1] ? firstWordMatch[1].toLowerCase() : null

  const activeCommand = firstWord
    ? COMMAND_OPTIONS.find(opt => opt.prefix === firstWord)
    : undefined

  const displayValue = activeCommand
    ? value.slice(value.indexOf(activeCommand.prefix) + activeCommand.prefix.length).trimStart()
    : value

  // Scope commands from typed input: strip and call onScopeChange
  useEffect(() => {
    if (!activeCommand || activeCommand.kind !== 'scope') {
      lastAppliedScopeValueRef.current = null
      return
    }

    if (lastAppliedScopeValueRef.current === value) {
      return
    }

    lastAppliedScopeValueRef.current = value
    onScopeChange?.(activeCommand.scope)
    onChange(displayValue)
  }, [activeCommand, displayValue, onChange, onScopeChange, value])

  // Scope pill derived from activeScope prop (the current tab state)
  const hasScopePill = activeScope && activeScope !== 'all'
  const scopePillConfig = hasScopePill ? SCOPE_OPTIONS.find(opt => opt.scope === activeScope) : null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showFilterMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedFilterIndex(prev => Math.min(prev + 1, filteredOptions.length - 1))
        return
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedFilterIndex(prev => Math.max(prev - 1, 0))
        return
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredOptions[selectedFilterIndex]) {
          e.preventDefault()
          e.stopPropagation()
          const selected = filteredOptions[selectedFilterIndex]
          const rest = value.replace(/^\/\S*/, '').trim()
          if (selected.kind === 'scope') {
            onScopeChange?.(selected.scope)
            onChange(rest)
          } else {
            onChange(selected.prefix + ' ' + rest)
          }
        }
        return
      }
    }

    if (e.key === 'Backspace' && displayValue === '' && activeCommand) {
      e.preventDefault()
      onChange('')
    } else if (e.key === 'Backspace' && value === '' && hasScopePill) {
      // Clear active scope pill when input is empty
      e.preventDefault()
      onScopeChange?.('all')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      inputRef.current?.blur()
    }
  }

  const handleFilterClick = (option: (typeof COMMAND_OPTIONS)[number]) => {
    const rest = value.replace(/^\/\S*/, '').trim()
    if (option.kind === 'scope') {
      onScopeChange?.(option.scope)
      onChange(rest)
    } else {
      onChange(option.prefix + ' ' + rest)
    }
    inputRef.current?.focus()
  }

  return (
    <div className="relative w-full group">
      <div className="relative flex items-center backdrop-blur-2xl border-none bg-slate-100/10 dark:bg-transparent rounded-xl shadow-sm shadow-black/4 dark:shadow-2xl">
        {/* Search Icon */}
        <div className="pl-4 text-gray-500 dark:text-gray-400">
          <Search className="w-5 h-5" />
        </div>

        {/* Scope Pill (from active tab) */}
        {scopePillConfig && (
          <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-md border border-blue-200 dark:border-blue-500/30 whitespace-nowrap shadow-sm">
            <scopePillConfig.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{scopePillConfig.label}</span>
            <button
              onClick={() => onScopeChange?.('all')}
              className="ml-0.5 rounded hover:bg-blue-200/60 dark:hover:bg-blue-400/20 p-0.5 transition-colors"
              aria-label="Clear scope filter"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Active Filter Pill (from typed /command) */}
        {activeCommand && (
          <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-md border border-blue-200 dark:border-blue-500/30 whitespace-nowrap shadow-sm">
            <activeCommand.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{activeCommand.label}</span>
          </div>
        )}

        {/* The Input */}
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={e => {
            if (activeCommand) {
              if (activeCommand.kind === 'scope') {
                onChange(e.target.value)
              } else {
                onChange(`${activeCommand.prefix} ${e.target.value}`)
              }
            } else {
              onChange(e.target.value)
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          placeholder={
            activeCommand
              ? `Search in ${activeCommand.label}...`
              : scopePillConfig
                ? `Search in ${scopePillConfig.label}...`
                : placeholder
          }
          className={`flex-1 bg-transparent border-none outline-none py-4 text-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-0 ${activeCommand || scopePillConfig ? 'px-3' : 'px-4'}`}
        />

        {/* Right Actions */}
        <div className="pr-4 flex items-center gap-2">
          {/* Semantic Toggle */}
          {isSemanticAvailable && (
            <button
              onClick={onToggleSemantic}
              className={`p-1.5 rounded-md transition-all duration-200 ${
                isSemanticActive
                  ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shadow-sm shadow-indigo-500/10'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-black/5 dark:hover:bg-slate-100/5'
              }`}
              title={
                isSemanticActive
                  ? 'Semantic search: On — click to switch to text search'
                  : 'Text search — click to switch to AI semantic search'
              }
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}

          {!isSemanticAvailable && semanticStatus && (
            <div
              className="hidden sm:flex items-center gap-1 rounded-md border border-amber-200/70 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300"
              title={semanticStatus.message}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI unavailable</span>
            </div>
          )}

          {value ? (
            <button
              onClick={onClear}
              className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-slate-100/10 text-gray-400 dark:text-gray-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100/50 dark:bg-slate-100/5 border border-gray-200/60 dark:border-gray-100/5">
              {getPlatform() === 'macos' ? (
                <Command className="w-3 h-3 text-gray-500" />
              ) : (
                <span className="text-xs text-gray-500 font-medium">Ctrl</span>
              )}
              <span className="text-xs text-gray-500 font-medium">K</span>
            </div>
          )}
        </div>
      </div>

      {semanticHint && (
        <div className="mt-2 px-1 text-xs text-gray-600 dark:text-gray-400">{semanticHint}</div>
      )}

      {/* Slash-Command Filter Menu */}
      {showFilterMenu && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-gray-200/60 dark:border-white/10 bg-slate-100/80 dark:bg-slate-900/95 backdrop-blur-2xl shadow-xl shadow-black/5 dark:shadow-2xl overflow-hidden z-50 animate-fade-in">
          <div className="p-1.5">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Commands
            </div>
            {filteredOptions.map((option, index) => {
              const Icon = option.icon
              return (
                <button
                  key={option.prefix}
                  onClick={() => handleFilterClick(option)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    index === selectedFilterIndex
                      ? 'bg-slate-100/80 dark:bg-slate-100/10 text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-slate-100/60 dark:hover:bg-slate-100/5 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium font-mono">{option.prefix}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {option.description}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})
