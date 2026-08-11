import { useEffect, useState, type ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'
import { useUIStore } from '../../stores'
import { getDeleteShortcut, getShortcutChips } from '../keyboard/shortcuts'
import { Trans, useTranslation } from 'react-i18next'

const Kbd = ({ children }: { children?: ReactNode }) => (
  <span className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-slate-100/80 dark:bg-slate-100/10 border border-gray-300/70 dark:border-gray-100/10 text-[10px] font-mono font-semibold text-gray-700 dark:text-gray-200 leading-none">
    {children}
  </span>
)

export const BottomBar = () => {
  const { t } = useTranslation()
  const { activeView } = useUIStore()
  const [currentTipIndex, setCurrentTipIndex] = useState(0)
  const [isFading, setIsFading] = useState(false)
  const deleteShortcutHint = getShortcutChips(getDeleteShortcut())
  const tips: ReactNode[] = [
    <Trans i18nKey="bottomBar.paste" components={{ key: <Kbd /> }} />,
    <Trans
      i18nKey="bottomBar.navigate"
      components={{ up: <Kbd />, down: <Kbd />, j: <Kbd />, k: <Kbd /> }}
    />,
    <Trans
      i18nKey="bottomBar.filter"
      components={{ image: <Kbd />, url: <Kbd />, markdown: <Kbd /> }}
    />,
    <Trans i18nKey="bottomBar.favorite" components={{ favorite: <Kbd />, pin: <Kbd /> }} />,
    <Trans
      i18nKey="bottomBar.remove"
      values={{ shortcut: deleteShortcutHint.join('+') }}
      components={{ key: <Kbd /> }}
    />,
  ]

  // Rotate tips every 10 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Start fade out
      setIsFading(true)

      // Change tip after fade out completes (500ms)
      setTimeout(() => {
        setCurrentTipIndex(prev => (prev + 1) % tips.length)
        // Start fade in
        setIsFading(false)
      }, 500)
    }, 10000)

    return () => clearInterval(intervalId)
  }, [tips.length])

  return (
    <div className="flex h-8 w-full shrink-0 select-none items-center justify-between px-4 text-[11px] text-gray-600 dark:text-gray-500">
      {/* Left: Rotating Tips */}
      <div className="flex items-center gap-2 overflow-hidden flex-1">
        <Lightbulb className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-500/80 shrink-0" />
        <span className="font-medium text-gray-700 dark:text-gray-400">
          {t('bottomBar.proTip')}
        </span>
        <span
          className={`text-gray-700 dark:text-gray-300 truncate transition-opacity duration-500 ease-in-out ${
            isFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {tips[currentTipIndex]}
        </span>
      </div>

      {/* Right: Icon and Active View Indicator */}
      <div className="hidden sm:flex items-center gap-1 opacity-60 dark:opacity-40 uppercase shrink-0 pl-4">
        {activeView === 'clips' && (
          <img
            src="/monochromatic.svg"
            alt={t('bottomBar.iconAlt')}
            className="w-5 h-5 opacity-70 mt-[0.12rem]"
          />
        )}
        <span className="font-bold tracking-widest text-xs">{t(`titleBar.${activeView}`)}</span>
      </div>
    </div>
  )
}
