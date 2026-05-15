import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingsStore } from '../../stores'
import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'

export const useWindowBehavior = () => {
  const settings = useSettingsStore(state => state.settings)

  // Enable rounded corners on macOS
  useEffect(() => {
    const setupRoundedCorners = async () => {
      try {
        await enableModernWindowStyle({
          cornerRadius: 12,
          offsetX: -6,
          offsetY: 0,
        })
      } catch (error) {
        // Plugin is macOS-only, silently fail on other platforms
        console.debug('Rounded corners not available:', error)
      }
    }

    void setupRoundedCorners()
  }, [])

  useEffect(() => {
    // Track whether the mouse cursor is inside the window.
    // When the OS steals focus (e.g. during a title-bar drag), the window
    // blurs even though the user is still interacting with it.  We only
    // want to hide when the user genuinely clicked *outside* the window.
    let mouseInWindow = true

    const onEnter = () => {
      mouseInWindow = true
    }
    const onLeave = () => {
      mouseInWindow = false
    }

    document.addEventListener('mouseenter', onEnter)
    document.addEventListener('mouseleave', onLeave)

    const setupBlurListener = async () => {
      const win = getCurrentWindow()
      const unlisten = await win.onFocusChanged(({ payload: focused }) => {
        // always_on_top takes precedence: don't hide while it's active.
        if (!focused && settings?.hide_on_blur && !settings?.always_on_top && !mouseInWindow) {
          void win.hide()
        }
      })
      return unlisten
    }

    const unlistenPromise = setupBlurListener()

    return () => {
      document.removeEventListener('mouseenter', onEnter)
      document.removeEventListener('mouseleave', onLeave)
      void unlistenPromise.then(unlisten => unlisten())
    }
  }, [settings?.hide_on_blur, settings?.always_on_top])
}
