import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { ThemeProvider } from './shared/hooks/useTheme'
import { AppLayout } from './features/app/AppLayout'
import { StartupRecovery } from './features/app/StartupRecovery'
import { ToastProvider } from './shared/contexts/ToastContext'
import { useSettingsStore } from './stores'
import i18n, { detectSupportedLanguage, normalizeLanguage } from './i18n'
import type { StartupStatus } from './shared/types'

const applyAppLanguage = async (language: string) => {
  const normalized = normalizeLanguage(language)
  await i18n.changeLanguage(normalized)
  document.documentElement.lang = normalized
  document.documentElement.dir = i18n.dir(normalized)

  await invoke('set_tray_labels', {
    labels: {
      open: i18n.t('tray.open'),
      settings: i18n.t('tray.settings'),
      quit: i18n.t('tray.quit'),
    },
  }).catch(error => {
    console.error('Failed to update tray language:', error)
  })
}

const App = () => {
  const settings = useSettingsStore(state => state.settings)
  const loadSettings = useSettingsStore(state => state.loadSettings)
  const updateSettings = useSettingsStore(state => state.updateSettings)
  const [startupStatus, setStartupStatus] = useState<StartupStatus | null>(null)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [isLanguageReady, setIsLanguageReady] = useState(false)

  useEffect(() => {
    void invoke<StartupStatus>('get_startup_status')
      .then(setStartupStatus)
      .catch(error => setStartupError(String(error)))
  }, [])

  useEffect(() => {
    if (!startupStatus) return
    let cancelled = false

    const bootstrap = async () => {
      if (startupStatus.state !== 'ready') {
        await applyAppLanguage('en')
        if (!cancelled) setIsLanguageReady(true)
        return
      }
      await loadSettings()
      const loadedSettings = useSettingsStore.getState().settings

      if (!loadedSettings) {
        await applyAppLanguage('en')
        if (!cancelled) setIsLanguageReady(true)
        return
      }

      const detectedLanguages =
        navigator.languages.length > 0
          ? navigator.languages
          : navigator.language
            ? [navigator.language]
            : []
      const language = loadedSettings.language_initialized
        ? normalizeLanguage(loadedSettings.language)
        : detectSupportedLanguage(detectedLanguages)

      if (loadedSettings.language !== language || loadedSettings.language_initialized !== true) {
        await updateSettings({ language, language_initialized: true })
      }

      await applyAppLanguage(language)
      if (!cancelled) setIsLanguageReady(true)
    }

    void bootstrap().catch(async error => {
      console.error('Failed to initialize application language:', error)
      await applyAppLanguage('en')
      if (!cancelled) setIsLanguageReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [loadSettings, startupStatus, updateSettings])

  useEffect(() => {
    if (!isLanguageReady || !settings?.language) return
    void applyAppLanguage(settings.language)
  }, [isLanguageReady, settings?.language])

  if (startupError) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-950 px-6 text-red-200">
        <p role="alert">Unable to inspect ClipsX storage: {startupError}</p>
      </main>
    )
  }

  if (!startupStatus || !isLanguageReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" aria-hidden="true">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
      </div>
    )
  }

  if (startupStatus.state !== 'ready') return <StartupRecovery status={startupStatus} />

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
