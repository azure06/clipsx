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
} from 'lucide-react'
import { useRef, useEffect, useState } from 'react'

const FILTER_OPTIONS = [
  { prefix: '/image', label: 'Images', description: 'Screenshots, photos', icon: Image },
  { prefix: '/url', label: 'URLs', description: 'Links and web addresses', icon: Link },
  { prefix: '/text', label: 'Text', description: 'Plain text clips', icon: Type },
  { prefix: '/code', label: 'Code', description: 'Code snippets', icon: Code },
  { prefix: '/file', label: 'Files', description: 'File paths', icon: FileText },
  { prefix: '/office', label: 'Office', description: 'Word, Excel, PPT', icon: Briefcase },
]

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder?: string
  autoFocus?: boolean
  isSemanticAvailable?: boolean
  isSemanticActive?: boolean
  onToggleSemantic?: () => void
}

export const SearchBar = ({
  value,
  onChange,
  onClear,
  placeholder = 'Type to search or paste...',
  autoFocus = true,
  isSemanticAvailable = false,
  isSemanticActive = false,
  onToggleSemantic,
}: SearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedFilterIndex, setSelectedFilterIndex] = useState(0)

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  // Derive filter menu visibility from value (no useEffect needed)
  // Only show menu if the ENTIRE value is a slash command (no trailing string/space yet)
  const slashMatch = value.match(/^(\/\S*)$/)
  const currentSlash = slashMatch ? slashMatch[1] : null

  const filteredOptions = currentSlash
    ? FILTER_OPTIONS.filter(opt => opt.prefix.toLowerCase().startsWith(currentSlash.toLowerCase()))
    : FILTER_OPTIONS

  const showFilterMenu = currentSlash !== null && filteredOptions.length > 0

  // Calculate Active Pill Information
  const trimmedValue = value.trimStart()
  const firstWordMatch = trimmedValue.match(/^(\/\S+)/)
  const firstWord = firstWordMatch?.[1] ? firstWordMatch[1].toLowerCase() : null

  const activeFilter = firstWord ? FILTER_OPTIONS.find(opt => opt.prefix === firstWord) : undefined

  const displayValue = activeFilter
    ? value.slice(value.indexOf(activeFilter.prefix) + activeFilter.prefix.length).trimStart()
    : value

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showFilterMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedFilterIndex(prev => Math.min(prev + 1, filteredOptions.length - 1))
        return
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedFilterIndex(prev => Math.max(prev - 1, 0))
        return
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredOptions[selectedFilterIndex]) {
          e.preventDefault()
          const selected = filteredOptions[selectedFilterIndex]
          const rest = value.replace(/^\/\S*/, '').trim()
          onChange(selected.prefix + ' ' + rest)
        }
        return
      }
    }

    if (e.key === 'Backspace' && displayValue === '' && activeFilter) {
      e.preventDefault()
      // Remove pill, leave just the prefix minus last char so they can keep editing or deleting
      onChange(activeFilter.prefix.slice(0, -1))
    } else if (e.key === 'Escape') {
      onClear()
    }
  }

  const handleFilterClick = (prefix: string) => {
    const rest = value.replace(/^\/\S*/, '').trim()
    onChange(prefix + ' ' + rest)
    inputRef.current?.focus()
  }

  return (
    <div className="relative w-full group">
      <div className="relative flex items-center backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl">
        {/* Search Icon */}
        <div className="pl-4 text-gray-400">
          <Search className="w-5 h-5" />
        </div>

        {/* Active Pill */}
        {activeFilter && (
          <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500/20 text-blue-300 rounded-md border border-blue-500/30 whitespace-nowrap shadow-sm">
            <activeFilter.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{activeFilter.label}</span>
          </div>
        )}

        {/* The Input */}
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={e => {
            if (activeFilter) {
              onChange(`${activeFilter.prefix} ${e.target.value}`)
            } else {
              onChange(e.target.value)
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={activeFilter ? `Search in ${activeFilter.label}...` : placeholder}
          className={`flex-1 bg-transparent border-none outline-none py-4 text-lg text-white placeholder-gray-500 focus:ring-0 ${activeFilter ? 'px-3' : 'px-4'}`}
        />

        {/* Right Actions */}
        <div className="pr-4 flex items-center gap-2">
          {/* Semantic Toggle (only visible when a model is loaded) */}
          {isSemanticAvailable && (
            <button
              onClick={onToggleSemantic}
              className={`p-1.5 rounded-md transition-all duration-200 ${
                isSemanticActive
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-sm shadow-indigo-500/10'
                  : 'text-gray-500 hover:text-gray-400 hover:bg-white/5'
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

          {value ? (
            <button
              onClick={onClear}
              className="p-1 rounded-full hover:bg-white/10 text-gray-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/5">
              <Command className="w-3 h-3 text-gray-500" />
              <span className="text-xs text-gray-500 font-medium">K</span>
            </div>
          )}
        </div>
      </div>

      {/* Slash-Command Filter Menu */}
      {showFilterMenu && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
          <div className="p-1.5">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Filters
            </div>
            {filteredOptions.map((option, index) => {
              const Icon = option.icon
              return (
                <button
                  key={option.prefix}
                  onClick={() => handleFilterClick(option.prefix)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    index === selectedFilterIndex
                      ? 'bg-white/10 text-white'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium font-mono">{option.prefix}</span>
                      <span className="text-xs text-gray-500">{option.description}</span>
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
}
