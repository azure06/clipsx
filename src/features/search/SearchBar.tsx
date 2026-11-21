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
  Loader2,
  Tags,
} from 'lucide-react'
import { forwardRef, useRef, useEffect, useId, useState, useImperativeHandle } from 'react'
import { getPlatform } from '../../shared/keyboard/shortcuts'
import type {
  SearchSourceDescriptor,
  SearchSourceOutcome,
  TextEmbeddingStatus,
  V2Tag,
} from '../../shared/types/v2'
import { useTranslation } from 'react-i18next'
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuTrigger,
  dropdownSurfaceClass,
  suggestionItemClass,
} from '../../shared/components/ui'
import { cn } from '../../shared/utils/cn'
import { SearchLoadingBeam } from './SearchLoadingBeam'

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
  tags?: readonly V2Tag[]
  activeTag?: V2Tag
  onTagChange?: (id: string | null) => Promise<void>
  onLoadTags?: () => Promise<void>
  tagsLoading?: boolean
  tagsLoadError?: boolean
  placeholder?: string
  autoFocus?: boolean
  isUpdatingResults?: boolean
  semanticStatus?: TextEmbeddingStatus | null
  isSemanticActive?: boolean
  onToggleSemantic?: () => void
  searchSources?: SearchSourceDescriptor[]
  onToggleSource?: (sourceId: string) => void
  sourceOutcomes?: SearchSourceOutcome[]
  canRecall?: boolean
  isRecalling?: boolean
  recallElapsedSeconds?: number
  recallShortcut?: string
  recallAvailable?: boolean
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
    tags = [],
    activeTag,
    onTagChange,
    onLoadTags,
    tagsLoading,
    tagsLoadError,
    placeholder,
    autoFocus = true,
    isUpdatingResults = false,
    semanticStatus = null,
    isSemanticActive = false,
    onToggleSemantic,
    searchSources = [],
    onToggleSource,
    sourceOutcomes = [],
    canRecall = false,
    isRecalling = false,
    recallElapsedSeconds = 0,
    recallShortcut = 'Ctrl+Enter',
    recallAvailable = true,
    onRecall,
  },
  ref
) {
  const { t } = useTranslation()
  const suggestionsId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [selectedFilterIndex, setSelectedFilterIndex] = useState(0)
  const [dismissedTagQuery, setDismissedTagQuery] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
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
  const showUnavailableChip = !isSemanticAvailable && semanticStatus && searchSources.length === 0

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

  // Only recognize @ at a word boundary so pasted email addresses stay literal.
  const tagToken = displayValue.match(/(?:^|\s)@([^\s@]*)$/)
  const showTagMenu = Boolean(
    onTagChange && isInputFocused && !isComposing && tagToken && dismissedTagQuery !== value
  )
  const tagQuery = tagToken?.[1]?.toLowerCase() ?? ''
  const matchingTags = showTagMenu
    ? tags.filter(tag => tag.name.toLowerCase().includes(tagQuery))
    : []
  const activeTagIndex = Math.min(selectedFilterIndex, Math.max(matchingTags.length - 1, 0))
  const activeSuggestion = showTagMenu
    ? matchingTags.length
      ? activeTagIndex
      : null
    : showFilterMenu
      ? activeFilterIndex
      : null
  useEffect(() => {
    if (showTagMenu) void onLoadTags?.()
  }, [showTagMenu, onLoadTags])

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

  const selectTag = (tag: V2Tag) => {
    if (!tagToken) return
    const rest = displayValue.slice(0, tagToken.index).trimEnd()
    onChange(activeCommand ? `${activeCommand.prefix} ${rest}`.trimEnd() : rest)
    void onTagChange?.(tag.id)
    inputRef.current?.focus()
  }

  const clearTag = () => {
    void onTagChange?.(null)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || isComposing) return
    if (showTagMenu) {
      const tag = matchingTags[activeTagIndex]
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissedTagQuery(value)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        const next = Math.max(
          0,
          Math.min(activeTagIndex + (e.key === 'ArrowDown' ? 1 : -1), matchingTags.length - 1)
        )
        setSelectedFilterIndex(next)
        document.getElementById(`${suggestionsId}-${next}`)?.scrollIntoView?.({ block: 'nearest' })
        return
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        if (tag) selectTag(tag)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing && !e.repeat) {
      e.preventDefault()
      e.stopPropagation()
      onRecall?.()
      return
    }
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
    } else if (e.key === 'Backspace' && value === '' && activeTag) {
      e.preventDefault()
      clearTag()
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
      <div
        aria-busy={isUpdatingResults}
        className="search-surface app-raised-surface relative flex items-center backdrop-blur-2xl border-none bg-slate-100/10 dark:bg-transparent rounded-xl shadow-sm shadow-black/4 dark:shadow-2xl"
      >
        {isUpdatingResults && <SearchLoadingBeam />}

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

        {activeTag && (
          <div
            className="ml-2 flex min-w-0 max-w-28 shrink items-center gap-1 rounded-md bg-violet-500/10 px-2 py-1.5 text-sm font-medium text-violet-700 dark:text-violet-200"
            title={activeTag.name}
          >
            <Tags aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{activeTag.name}</span>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 rounded p-0.5 text-current"
              aria-label={t('search.clearTag', { name: activeTag.name })}
              onClick={clearTag}
            >
              <X aria-hidden="true" className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* The Input */}
        <input
          data-recall-input="main"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showTagMenu || showFilterMenu}
          aria-controls={showTagMenu || showFilterMenu ? suggestionsId : undefined}
          aria-activedescendant={
            activeSuggestion !== null ? `${suggestionsId}-${activeSuggestion}` : undefined
          }
          value={displayValue}
          onChange={e => {
            setSelectedFilterIndex(0)
            setDismissedTagQuery(null)
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
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => {
            setIsInputFocused(false)
            setDismissedTagQuery(null)
          }}
          placeholder={
            activeCommand
              ? t('search.searchIn', { name: t(activeCommand.labelKey) })
              : scopePillConfig
                ? t('search.searchIn', { name: t(scopePillConfig.labelKey) })
                : activeTag
                  ? t('search.searchIn', { name: activeTag.name })
                  : (placeholder ?? t('search.placeholder'))
          }
          className={`min-w-0 flex-1 bg-transparent border-none outline-none py-4 text-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-0 ${activeCommand || scopePillConfig || activeTag ? 'px-3' : 'px-4'}`}
        />

        {/* Right Actions */}
        <div className="pr-4 flex items-center gap-2">
          {canRecall && (
            <button
              type="button"
              onClick={onRecall}
              disabled={isRecalling}
              className="flex items-center gap-1 rounded-md bg-violet-100 px-2 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30"
              title={
                recallAvailable
                  ? t('desktopUi.askRecallShortcut', { shortcut: recallShortcut })
                  : t('desktopUi.setUpRecall')
              }
            >
              <Sparkles className={`h-3.5 w-3.5 ${isRecalling ? 'animate-pulse' : ''}`} />
              {isRecalling
                ? t('desktopUi.readingSeconds', { count: recallElapsedSeconds })
                : recallAvailable
                  ? 'Recall'
                  : t('desktopUi.setUpRecall')}
              {!isRecalling && recallAvailable && (
                <span aria-hidden="true" className="hidden lg:inline opacity-60">
                  {recallShortcut}
                </span>
              )}
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

          {showUnavailableChip && (
            <div
              className="hidden sm:flex items-center gap-1 rounded-md border border-amber-200/70 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300"
              title={t('search.semanticFallback')}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('search.aiUnavailable')}</span>
            </div>
          )}

          {/* A fixed-size indicator keeps the layout stable as indexing starts and stops. */}
          {semanticHint && !showUnavailableChip && (
            <span
              role="status"
              aria-label={semanticHint}
              title={semanticHint}
              className="flex h-6 w-6 shrink-0 items-center justify-center text-indigo-500 dark:text-indigo-400"
            >
              {isSemanticIndexing && !queryFallback ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
              )}
            </span>
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

      {showTagMenu && (
        <div className={cn(dropdownSurfaceClass, 'absolute inset-x-0 top-full mt-2 p-1.5')}>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {t('clipboard.tags')}
          </div>
          <div
            id={suggestionsId}
            role="listbox"
            aria-label={t('clipboard.tags')}
            aria-busy={tagsLoading}
            className="max-h-60 overflow-y-auto"
          >
            {matchingTags.map((tag, index) => (
              <button
                key={tag.id}
                id={`${suggestionsId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === activeTagIndex}
                onMouseDown={event => event.preventDefault()}
                onPointerMove={() => setSelectedFilterIndex(index)}
                onClick={() => selectTag(tag)}
                className={cn(
                  suggestionItemClass,
                  'w-full gap-2',
                  index === activeTagIndex &&
                    'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-violet-400"
                  style={tag.color ? { backgroundColor: tag.color } : undefined}
                />
                <span className="min-w-0 break-words">{tag.name}</span>
              </button>
            ))}
          </div>
          {!matchingTags.length && (
            <p role="status" className="px-3 py-2 text-xs text-slate-500">
              {t(
                tagsLoading
                  ? 'clipboard.loadingTags'
                  : tagsLoadError
                    ? 'clipboard.tagsLoadError'
                    : 'clipboard.noMatchingTags'
              )}
            </p>
          )}
        </div>
      )}

      {/* Slash-Command Filter Menu */}
      {showFilterMenu && (
        <div
          id={suggestionsId}
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
                  id={`${suggestionsId}-${index}`}
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
