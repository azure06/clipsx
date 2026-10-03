import { DiagnosticsActions } from './features/settings/DiagnosticsActions'
import { useTranslation } from 'react-i18next'
import { diagnostic } from './shared/diagnostics'
import { useEffect, useRef, useState } from 'react'
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

  void invoke('set_tray_labels', {
    labels: {
      open: i18n.t('tray.open'),
      settings: i18n.t('tray.settings'),
      quit: i18n.t('tray.quit'),
    },
  }).catch(() => {
    diagnostic('failed_to_update_tray_language')
  })
}

const App = () => {
  useTranslation()

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

  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const appliedLanguage = useRef<string | null>(null)

  useEffect(() => {
    if (startupStatus?.state !== 'ready') return
    let cancelled = false
    void loadSettings().then(() => {
      if (!cancelled) setSettingsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadSettings, startupStatus?.state])

  useEffect(() => {
    if (!startupStatus || (startupStatus.state === 'ready' && !settingsLoaded)) return
    let cancelled = false
    const detectedLanguages =
      navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : []
    const language =
      startupStatus.state === 'ready' && settings
        ? settings.language_initialized
          ? normalizeLanguage(settings.language)
          : detectSupportedLanguage(detectedLanguages)
        : detectSupportedLanguage(detectedLanguages)

    const synchronizeLanguage = async () => {
      if (appliedLanguage.current !== language) {
        await applyAppLanguage(language)
        if (cancelled) return
        appliedLanguage.current = language
      }
      if (cancelled) return
      setIsLanguageReady(true)
      if (
        startupStatus.state === 'ready' &&
        settings &&
        (settings.language !== language || !settings.language_initialized)
      ) {
        void updateSettings({ language, language_initialized: true }).catch(() => {
          diagnostic('failed_to_initialize_application_language')
        })
      }
    }
    void synchronizeLanguage().catch(async () => {
      diagnostic('failed_to_initialize_application_language')
      await applyAppLanguage('en')
      if (!cancelled) setIsLanguageReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [settings, settingsLoaded, startupStatus, updateSettings])

  if (startupError) {
    return (
      <StartupRecovery
        status={{ state: 'startup_failed', message: startupError, resetAvailable: false }}
      />
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
          <DiagnosticsActions notifyOnly />
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
