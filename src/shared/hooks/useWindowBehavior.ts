import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingsStore } from '../../stores'

export const useWindowBehavior = () => {
    const settings = useSettingsStore(state => state.settings)

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
