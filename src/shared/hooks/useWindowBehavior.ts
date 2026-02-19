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
    const setupBlurListener = async () => {
      const win = getCurrentWindow()
      // Listen for window focus changes
      const unlisten = await win.onFocusChanged(({ payload: focused }) => {
        if (!focused && settings?.hide_on_blur) {
          void win.hide()
        }
      })
      return unlisten
    }

    const unlistenPromise = setupBlurListener()

    return () => {
      void unlistenPromise.then(unlisten => unlisten())
    }
  }, [settings?.hide_on_blur])
}
