import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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
          {/* Search sources */}
          {searchSources.length > 0 ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-all ${isSemanticActive ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {t('search.sources')}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 w-64 rounded-xl border border-slate-200/60 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/95"
                  sideOffset={6}
                  align="end"
                >
                  {searchSources.map(source => (
                    <DropdownMenu.Item
                      key={source.id}
                      disabled={source.mandatory}
                      onSelect={event => {
                        event.preventDefault()
                        onToggleSource?.(source.id)
                      }}
                      className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left outline-none data-highlighted:bg-slate-100 data-disabled:cursor-not-allowed data-disabled:opacity-60 dark:data-highlighted:bg-white/5"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border ${source.enabled ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}
                      >
                        {source.enabled && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-gray-800 dark:text-gray-200">
                          {source.label}
                        </span>
                        <span className="block text-[10px] text-gray-500">
                          {source.mandatory
                            ? t('search.alwaysOn')
                            : t(`search.sourceState.${source.state}`)}
                        </span>
                      </span>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
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
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-gray-200/60 dark:border-white/10 bg-slate-100/80 dark:bg-slate-900/95 backdrop-blur-2xl shadow-xl shadow-black/5 dark:shadow-2xl overflow-hidden z-50 animate-fade-in">
          <div className="p-1.5">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {t('search.commands')}
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
