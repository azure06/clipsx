import { Search, Command, X, Sparkles } from 'lucide-react'
import { useRef, useEffect } from 'react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder?: string
  autoFocus?: boolean
  isSemanticSearch?: boolean
}

export const SearchBar = ({
  value,
  onChange,
  onClear,
  placeholder = 'Type to search or paste...',
  autoFocus = true,
  isSemanticSearch = false,
}: SearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  return (
    <div className="relative w-full group">
      {/* Input Container with Glow Effect */}
      {/* <div className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-blue-500 to-indigo-500 opacity-20 blur transition duration-500 group-hover:opacity-40" /> */}

      <div className="relative flex items-center backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl">
        {/* Search Icon */}
        <div className="pl-4 text-gray-400">
          <Search className="w-5 h-5" />
        </div>

        {/* The Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none px-4 py-4 text-lg text-white placeholder-gray-500 focus:ring-0"
        />

        {/* Semantic Search Indicator */}
        {isSemanticSearch && value.trim() !== '' && (
          <div className="absolute top-0 right-16 bottom-0 flex items-center pr-4">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Semantic</span>
            </div>
          </div>
        )}

        {/* Right Actions */}
        <div className="pr-4 flex items-center gap-2">
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
    </div>
  )
}
