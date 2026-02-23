import { useEffect, useState, type ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'
import { useUIStore } from '../../stores'

const Kbd = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-white/10 border border-white/10 text-[10px] font-mono font-semibold text-gray-200 leading-none">
    {children}
  </span>
)

// Array of helpful tips for the user
const TIPS: ReactNode[] = [
  <>
    Press <Kbd>Enter</Kbd> to paste the selected clip.
  </>,
  <>
    Use <Kbd>↑</Kbd> <Kbd>↓</Kbd> arrows or <Kbd>J</Kbd> <Kbd>K</Kbd> to navigate.
  </>,
  <>
    Type <Kbd>/image</Kbd> <Kbd>/url</Kbd> or <Kbd>/text</Kbd> to filter clips.
  </>,
  <>
    Press <Kbd>F</Kbd> to favorite a clip or <Kbd>P</Kbd> to pin it.
  </>,
  <>
    Press <Kbd>Delete</Kbd> or <Kbd>Backspace</Kbd> to remove a clip.
  </>,
]

export const BottomBar = () => {
  const { activeView } = useUIStore()
  const [currentTipIndex, setCurrentTipIndex] = useState(0)
  const [isFading, setIsFading] = useState(false)

  // Rotate tips every 10 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Start fade out
      setIsFading(true)

      // Change tip after fade out completes (500ms)
      setTimeout(() => {
        setCurrentTipIndex(prev => (prev + 1) % TIPS.length)
        // Start fade in
        setIsFading(false)
      }, 500)
    }, 10000)

    return () => clearInterval(intervalId)
  }, [])

  return (
    <div className="flex h-8 w-full shrink-0 select-none items-center justify-between px-4 text-[11px] text-gray-500 bg-black/20 border-t border-white/5">
      {/* Left: Rotating Tips */}
      <div className="flex items-center gap-2 overflow-hidden flex-1">
        <Lightbulb className="h-3.5 w-3.5 text-yellow-500/80 shrink-0" />
        <span className="font-medium text-gray-400">Pro Tip:</span>
        <span
          className={`text-gray-300 truncate transition-opacity duration-500 ease-in-out ${
            isFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {TIPS[currentTipIndex]}
        </span>
      </div>

      {/* Right: Icon and Active View Indicator */}
      <div className="hidden sm:flex items-center gap-1 opacity-40 uppercase shrink-0 pl-4">
        {activeView === 'clips' && (
          <img
            src="/monochromatic.svg"
            alt="Clips Icon"
            className="w-5 h-5 opacity-70 mt-[0.12rem]"
          />
        )}
        <span className="font-bold tracking-widest text-xs">{activeView}</span>
      </div>
    </div>
  )
}
