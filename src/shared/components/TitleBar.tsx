import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useClipboardStore, useUIStore } from '../../stores'

const isWindows = navigator.platform.includes('Win')
const SNAP_LAYOUT_DELAY_MS = 620

// Decorum's injected titlebar requires window.__TAURI__. Keep that global bridge
// disabled so extension child webviews never receive generic native IPC; this
// trusted main UI renders the controls and invokes only Decorum's scoped Snap API.

export const TitleBar = () => {
  const { t } = useTranslation()
  const { activeView } = useUIStore()
  const { clips } = useClipboardStore()
  const [maximized, setMaximized] = useState(false)
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSnapTimer = () => {
    if (snapTimer.current !== null) {
      clearTimeout(snapTimer.current)
      snapTimer.current = null
    }
  }

  useEffect(() => {
    if (!isWindows) return
    const appWindow = getCurrentWindow()
    let disposed = false
    void appWindow.isMaximized().then(value => {
      if (!disposed) setMaximized(value)
    })
    const unlisten = appWindow.onResized(() => {
      void appWindow.isMaximized().then(value => {
        if (!disposed) setMaximized(value)
      })
    })
    return () => {
      disposed = true
      clearSnapTimer()
      void unlisten.then(stop => stop())
    }
  }, [])

  const preventDrag = (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()

  const scheduleSnapLayout = () => {
    clearSnapTimer()
    snapTimer.current = setTimeout(() => {
      snapTimer.current = null
      const appWindow = getCurrentWindow()
      void appWindow
        .setFocus()
        .then(() => invoke('plugin:decorum|show_snap_overlay'))
        .catch(error => console.warn('[WINDOW] Unable to show Snap Layout', error))
    }, SNAP_LAYOUT_DELAY_MS)
  }

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-8 shrink-0 select-none items-center px-3"
    >
      <div className="pointer-events-none flex items-center gap-3 text-[10px] text-gray-500">
        <div className="absolute left-24 top-0 flex flex-col items-center gap-1">
          <div className="h-1 w-16 rounded-b-full bg-linear-to-r from-blue-400 to-violet-400 shadow-lg shadow-blue-400/60" />
          <span className="text-[10px] font-bold tracking-wider text-gray-700 dark:text-gray-300">
            {t(`titleBar.${activeView}`)}
          </span>
        </div>
      </div>

      <div className="pointer-events-none ml-auto text-[11px] font-semibold text-gray-600 dark:text-gray-400">
        {t('titleBar.clipCount', { count: clips.length })}
      </div>

      {isWindows && (
        <div className="-mr-3 ml-2 flex h-8 self-stretch" aria-label="Window controls">
          <WindowControl
            label="Minimize"
            glyph={'\uE921'}
            onClick={() => void getCurrentWindow().minimize()}
            onMouseDown={preventDrag}
          />
          <WindowControl
            label={maximized ? 'Restore' : 'Maximize'}
            glyph={maximized ? '\uE923' : '\uE922'}
            onClick={() => {
              clearSnapTimer()
              void getCurrentWindow().toggleMaximize()
            }}
            onMouseDown={preventDrag}
            onMouseEnter={scheduleSnapLayout}
            onMouseLeave={clearSnapTimer}
          />
          <WindowControl
            label="Close"
            glyph={'\uE8BB'}
            variant="close"
            onClick={() => void getCurrentWindow().close()}
            onMouseDown={preventDrag}
          />
        </div>
      )}
    </div>
  )
}

const WindowControl = ({
  label,
  glyph,
  variant = 'default',
  onClick,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: {
  label: string
  glyph: string
  variant?: 'default' | 'close'
  onClick: () => void
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    onMouseDown={onMouseDown}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    className={`flex h-8 w-[46px] cursor-default items-center justify-center rounded-none border-0 bg-transparent p-0 text-[10px] font-light text-gray-700 shadow-none transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 dark:text-gray-200 ${
      variant === 'close'
        ? 'hover:bg-[#e81123] hover:text-white active:bg-[#e81123] active:opacity-80'
        : 'hover:bg-black/10 active:bg-black/15 dark:hover:bg-white/10 dark:active:bg-white/15'
    }`}
    style={{ fontFamily: "'Segoe Fluent Icons', 'Segoe MDL2 Assets'" }}
  >
    <span aria-hidden="true">{glyph}</span>
  </button>
)
