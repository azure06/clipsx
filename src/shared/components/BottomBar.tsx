import { useEffect, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { useUIStore } from '../../stores'

// Array of helpful tips for the user
const TIPS = [
  'Press Enter to paste the selected clip.',
  'Use ↑ and ↓ arrows or J and K to navigate.',
  'Type /image, /url, or /text to instantly filter clips.',
  'Press F to favorite a clip or P to pin it.',
  'Press Delete or Backspace to remove a clip.',
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
      <div className="hidden sm:flex items-center gap-2 font-medium opacity-40 uppercase tracking-widest shrink-0 pl-4">
        {activeView === 'clips' && (
          <img src="/monochromatic.svg" alt="Clips Icon" className="w-5 h-5 opacity-70" />
        )}
        <span>{activeView}</span>
      </div>
    </div>
  )
}
