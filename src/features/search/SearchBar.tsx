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
  FileCode2,
  Briefcase,
  Star,
  Pin,
  SlidersHorizontal,
  Check,
} from 'lucide-react'
import { forwardRef, useRef, useEffect, useState, useImperativeHandle } from 'react'
import { getPlatform } from '../../shared/keyboard/shortcuts'
import type {
  SearchSourceDescriptor,
  SearchSourceOutcome,
  TextEmbeddingStatus,
} from '../../shared/types/v2'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuTrigger,
  dropdownSurfaceClass,
  suggestionItemClass,
} from '../../shared/components/ui'
import { cn } from '../../shared/utils/cn'

const FILTER_OPTIONS = [
  {
    prefix: '/image',
    labelKey: 'search.images',
    descriptionKey: 'search.imagesDescription',
    icon: Image,
  },
  { prefix: '/url', labelKey: 'search.urls', descriptionKey: 'search.urlsDescription', icon: Link },
  {
    prefix: '/text',
    labelKey: 'search.text',
    descriptionKey: 'search.textDescription',
    icon: Type,
  },
  {
    prefix: '/markdown',
    labelKey: 'search.markdown',
    descriptionKey: 'search.markdownDescription',
    icon: FileCode2,
  },
  {
    prefix: '/code',
    labelKey: 'search.code',
    descriptionKey: 'search.codeDescription',
    icon: Code,
  },
  {
    prefix: '/file',
    labelKey: 'search.files',
    descriptionKey: 'search.filesDescription',
    icon: FileText,
  },
  {
    prefix: '/office',
    labelKey: 'search.office',
    descriptionKey: 'search.officeDescription',
    icon: Briefcase,
  },
] as const

const SCOPE_OPTIONS = [
  {
    prefix: '/favorites',
    labelKey: 'search.favorites',
    descriptionKey: 'search.favoritesDescription',
    scope: 'favorites' as const,
    icon: Star,
  },
  {
    prefix: '/pinned',
    labelKey: 'search.pinned',
    descriptionKey: 'search.pinnedDescription',
    scope: 'pinned' as const,
    icon: Pin,
  },
] as const

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
  semanticStatus?: TextEmbeddingStatus | null
  isSemanticActive?: boolean
  onToggleSemantic?: () => void
  searchSources?: SearchSourceDescriptor[]
  onToggleSource?: (sourceId: string) => void
  sourceOutcomes?: SearchSourceOutcome[]
  canRecall?: boolean
  isRecalling?: boolean
  recallElapsedSeconds?: number
  onRecall?: () => void
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
    placeholder,
    autoFocus = true,
    semanticStatus = null,
    isSemanticActive = false,
    onToggleSemantic,
    searchSources = [],
    onToggleSource,
    sourceOutcomes = [],
    canRecall = false,
    isRecalling = false,
    recallElapsedSeconds = 0,
    onRecall,
  },
  ref
) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [selectedFilterIndex, setSelectedFilterIndex] = useState(0)
  const lastAppliedScopeValueRef = useRef<string | null>(null)
  const isSemanticIndexing = Boolean(
    semanticStatus?.pendingSpaceId || (semanticStatus?.pendingJobs ?? 0) > 0
  )
  const isSemanticAvailable = Boolean(
    semanticStatus?.enabled && (semanticStatus.activeSpaceId || semanticStatus.pendingSpaceId)
  )
  const queryFallback = sourceOutcomes.some(
    outcome => outcome.sourceId !== 'builtin.search.fts' && outcome.status !== 'used'
  )
  const semanticHint = queryFallback
    ? t('search.semanticFallback')
    : isSemanticIndexing
      ? t('search.semanticIndexing')
      : semanticStatus && (!isSemanticAvailable || semanticStatus.diagnostic)
        ? t('search.semanticFallback')
        : null

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
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
  const activeFilterIndex = Math.min(selectedFilterIndex, Math.max(filteredOptions.length - 1, 0))

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
        if (filteredOptions[activeFilterIndex]) {
          e.preventDefault()
          e.stopPropagation()
          const selected = filteredOptions[activeFilterIndex]
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
            <span className="text-sm font-medium">{t(scopePillConfig.labelKey)}</span>
            <button
              onClick={() => onScopeChange?.('all')}
              className="ml-0.5 rounded hover:bg-blue-200/60 dark:hover:bg-blue-400/20 p-0.5 transition-colors"
              aria-label={t('search.clearScope')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Active Filter Pill (from typed /command) */}
        {activeCommand && (
          <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-md border border-blue-200 dark:border-blue-500/30 whitespace-nowrap shadow-sm">
            <activeCommand.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t(activeCommand.labelKey)}</span>
          </div>
        )}

        {/* The Input */}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showFilterMenu}
          aria-controls={showFilterMenu ? 'search-command-listbox' : undefined}
          aria-activedescendant={showFilterMenu ? `search-command-${activeFilterIndex}` : undefined}
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
              ? t('search.searchIn', { name: t(activeCommand.labelKey) })
              : scopePillConfig
                ? t('search.searchIn', { name: t(scopePillConfig.labelKey) })
                : (placeholder ?? t('search.placeholder'))
          }
          className={`flex-1 bg-transparent border-none outline-none py-4 text-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-0 ${activeCommand || scopePillConfig ? 'px-3' : 'px-4'}`}
        />

        {/* Right Actions */}
        <div className="pr-4 flex items-center gap-2">
          {canRecall && (
            <button
              type="button"
              onClick={onRecall}
              disabled={isRecalling}
              className="flex items-center gap-1 rounded-md bg-violet-100 px-2 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-200 disabled:opacity-50 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30"
              title="Ask the configured local model to answer from the first 10 results"
            >
              <Sparkles className={`h-3.5 w-3.5 ${isRecalling ? 'animate-pulse' : ''}`} />
              {isRecalling ? `Reading… ${recallElapsedSeconds}s` : 'Recall'}
            </button>
          )}
          {/* Search sources */}
          {searchSources.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-all ${isSemanticActive ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {t('search.sources')}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 p-2" align="end">
                {searchSources.map(source => (
                  <DropdownMenuCheckboxItem
                    key={source.id}
                    checked={source.enabled}
                    disabled={source.mandatory}
                    onCheckedChange={() => onToggleSource?.(source.id)}
                    onSelect={event => event.preventDefault()}
                    className="items-start gap-2 pl-2"
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${source.enabled ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}
                    >
                      <DropdownMenuItemIndicator>
                        <Check className="h-3 w-3" />
                      </DropdownMenuItemIndicator>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">{source.label}</span>
                      <span className="block text-[10px] text-gray-500">
                        {source.mandatory
                          ? t('search.alwaysOn')
                          : t(`search.sourceState.${source.state}`)}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : isSemanticAvailable ? (
            <button
              onClick={onToggleSemantic}
              className="p-1.5 rounded-md text-indigo-500"
              title={isSemanticActive ? t('search.semanticOn') : t('search.semanticOff')}
            >
              <Sparkles className="w-4 h-4" />
            </button>
          ) : null}

          {!isSemanticAvailable && semanticStatus && searchSources.length === 0 && (
            <div
              className="hidden sm:flex items-center gap-1 rounded-md border border-amber-200/70 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300"
              title={t('search.semanticFallback')}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('search.aiUnavailable')}</span>
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
        <div
          id="search-command-listbox"
          role="listbox"
          className={cn(
            dropdownSurfaceClass,
            'animate-fade-in absolute top-full right-0 left-0 mt-2'
          )}
        >
          <div className="p-1.5">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {t('search.commands')}
            </div>
            {filteredOptions.map((option, index) => {
              const Icon = option.icon
              return (
                <button
                  key={option.prefix}
                  id={`search-command-${index}`}
                  role="option"
                  aria-selected={index === activeFilterIndex}
                  onClick={() => handleFilterClick(option)}
                  className={cn(
                    suggestionItemClass,
                    'w-full gap-3',
                    index === activeFilterIndex
                      ? 'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium font-mono">{option.prefix}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t(option.descriptionKey)}
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
