import { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { enable, disable } from '@tauri-apps/plugin-autostart'
import { save, open as openDialog } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'

import { useAuthStore, useSettingsStore } from '../../stores'
import { useClipboardStore } from '../../stores'
import { useTheme } from '../../shared/hooks/useTheme'
import type { Theme, PasteFormat, AppSettings, ItemActivationMode } from '../../shared/types'
import { Button, Switch, Select, Card } from '../../shared/components/ui'
import {
  getShortcutChips,
  getShortcutFromKeyboardEvent,
  parseAccelerator,
  toAccelerator,
} from '../../shared/keyboard/shortcuts'
import {
  Palette,
  Clipboard,
  Shield,
  Database,
  Keyboard,
  Trash,
  Loader2,
  Settings as SettingsIcon,
  Download,
  Upload,
  RotateCcw,
  Infinity as InfinityIcon,
  Zap,
  Timer,
  Clock,
  Calendar,
  RefreshCw,
  UserRound,
  LogOut,
  Cloud,
} from 'lucide-react'
import { useUpdaterStore } from '../../stores'
import { useTranslation } from 'react-i18next'
import { normalizeLanguage } from '../../i18n'
import {
  getSyncStatus,
  setSyncEnabled,
  synchronizeConfiguration,
  type SyncStatus,
} from '../../shared/sync/configSync'
import { SettingsNavigation, type SettingsNavigationItem } from './components/SettingsNavigation'
import { ButtonGroup, SettingRow, SettingsSection } from './components/SettingsPrimitives'

export type SettingsTab =
  | 'general'
  | 'clipboard'
  | 'keyboard'
  | 'storage'
  | 'privacy'
  | 'sync'
  | 'account'
  | 'advanced'

type SettingsProps = {
  initialTab?: SettingsTab
}

// --- ShortcutRecorder: visual key-combination recorder widget ---

type ShortcutRecorderProps = {
  readonly value: string
  readonly onChange: (shortcut: string) => void
}

const KeyChip = ({ label }: { label: string }) => (
  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100/10 dark:bg-slate-100/10 border border-gray-300 dark:border-white/15 text-[11px] font-mono font-semibold text-gray-700 dark:text-gray-200 shadow-sm shadow-black/5">
    {label}
  </span>
)

export const ShortcutRecorder = ({ value, onChange }: ShortcutRecorderProps) => {
  const { t } = useTranslation()
  const [isRecording, setIsRecording] = useState(false)
  const [pendingShortcut, setPendingShortcut] = useState<ReturnType<typeof parseAccelerator>>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const chips = getShortcutChips(
    isRecording && pendingShortcut ? pendingShortcut : parseAccelerator(value)
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault()
    const shortcut = getShortcutFromKeyboardEvent(e.nativeEvent)

    if (shortcut.key) {
      onChange(toAccelerator(shortcut))
      setIsRecording(false)
      setPendingShortcut(null)
      containerRef.current?.blur()
    } else {
      setPendingShortcut(shortcut)
    }
  }

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (isRecording) {
      const shortcut = getShortcutFromKeyboardEvent(e.nativeEvent)
      setPendingShortcut(shortcut.modifiers.length > 0 ? shortcut : null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        ref={containerRef}
        tabIndex={0}
        role="button"
        aria-label={t('settings.shortcutAria')}
        onFocus={() => {
          setIsRecording(true)
          setPendingShortcut(null)
        }}
        onBlur={() => {
          setIsRecording(false)
          setPendingShortcut(null)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`relative flex items-center justify-center gap-1 min-w-36 px-2.5 py-1.5 rounded-lg border-2 cursor-pointer transition-all duration-150 select-none outline-none ${
          isRecording
            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-500/10 shadow-[0_0_0_3px_rgba(59,130,246,0.15)]'
            : 'border-gray-200 dark:border-white/10 bg-slate-100/60 dark:bg-slate-100/5 hover:border-blue-300 dark:hover:border-blue-500/40 hover:bg-blue-50/30 dark:hover:bg-blue-500/5'
        }`}
      >
        {/* Recording pulse dot */}
        {isRecording && (
          <span className="absolute top-1.5 right-1.5 flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
          </span>
        )}

        {/* Key chips */}
        {chips.map((chip, i) => (
          <KeyChip key={i} label={chip} />
        ))}

        {/* Placeholder if no keys yet */}
        {chips.length === 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t('settings.pressShortcut')}
          </span>
        )}
      </div>

      {/* Contextual hint */}
      <p
        className={`text-[10px] transition-colors duration-150 ${isRecording ? 'text-blue-500' : 'text-gray-400 dark:text-gray-600'}`}
      >
        {isRecording ? t('settings.shortcutRecording') : t('settings.shortcutIdle')}
      </p>
    </div>
  )
}

// --- Main Settings component ---

export const Settings = ({ initialTab = 'general' }: SettingsProps) => {
  const { t, i18n } = useTranslation()
  const { settings, isLoading, error, updateSettings, resetSettings } = useSettingsStore()
  const clearAllClips = useClipboardStore(state => state.clearAllClips)
  const initializeUpdater = useUpdaterStore(state => state.initialize)
  const currentVersion = useUpdaterStore(state => state.currentVersion)
  const updaterConfigured = useUpdaterStore(state => state.updaterConfigured)
  const updaterStatus = useUpdaterStore(state => state.status)
  const availableUpdate = useUpdaterStore(state => state.update)
  const updaterError = useUpdaterStore(state => state.error)
  const isCheckingForUpdates = useUpdaterStore(state => state.isChecking)
  const isDownloadingUpdate = useUpdaterStore(state => state.isDownloading)
  const updateReady = useUpdaterStore(state => state.updateReady)
  const checkForUpdates = useUpdaterStore(state => state.checkForUpdates)
  const downloadAndInstallUpdate = useUpdaterStore(state => state.downloadAndInstallUpdate)
  const restartToApplyUpdate = useUpdaterStore(state => state.restartToApplyUpdate)
  const { setThemeMode } = useTheme()
  const authStatus = useAuthStore(state => state.status)
  const authEmail = useAuthStore(state => state.email)
  const authUserId = useAuthStore(state => state.userId)
  const authError = useAuthStore(state => state.error)
  const signIn = useAuthStore(state => state.signIn)
  const signOut = useAuthStore(state => state.signOut)
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (activeTab === 'sync') {
      void getSyncStatus().then(setSyncStatus).catch(() => setSyncStatus(null))
    }
  }, [activeTab])

  const toggleSync = async () => {
    if (!authUserId || !syncStatus) return
    setSyncBusy(true)
    try {
      const next = await setSyncEnabled(authUserId, !syncStatus.enabled)
      setSyncStatus(next)
      if (next.enabled) setSyncStatus(await synchronizeConfiguration())
    } finally {
      setSyncBusy(false)
    }
  }

  const syncNow = async () => {
    setSyncBusy(true)
    try {
      setSyncStatus(await synchronizeConfiguration())
    } finally {
      setSyncBusy(false)
    }
  }

  useEffect(() => {
    void initializeUpdater()
  }, [initializeUpdater])

  useEffect(() => {
    if (settings?.theme) {
      setThemeMode(settings.theme)
    }
  }, [settings?.theme, setThemeMode])

  useEffect(() => {
    if (settings?.global_shortcut) {
      invoke('register_global_shortcut', {
        shortcut: settings.global_shortcut,
      }).catch(err => {
        console.error('Failed to register global shortcut:', err)
      })
    }
  }, [settings?.global_shortcut])

  const handleClearAllData = async () => {
    if (confirm(t('settings.deleteAllConfirm'))) {
      await clearAllClips()
      alert(t('settings.deleteAllSuccess'))
    }
  }

  const handleExport = async () => {
    if (!settings) return
    const path = await save({
      defaultPath: `clips-settings-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!path) return
    await writeTextFile(path, JSON.stringify(settings, null, 2))
  }

  const handleImport = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!path) return
    try {
      const text = await readTextFile(path)
      const imported = JSON.parse(text) as Partial<AppSettings>
      const importedLanguage =
        typeof imported.language === 'string'
          ? normalizeLanguage(imported.language)
          : (settings?.language ?? 'en')
      await updateSettings({
        ...imported,
        language: importedLanguage,
        language_initialized: true,
      })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      alert(t('errors.settingsImport'))
    }
  }

  const handleReset = async () => {
    if (confirm(t('settings.resetConfirm'))) {
      await resetSettings()
    }
  }

  // --- Loading / Error states ---

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <div className="text-red-500 dark:text-red-400">
            <SettingsIcon className="h-12 w-12 mx-auto mb-3" />
            <h2 className="text-lg font-semibold">{t('errors.settingsLoadTitle')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              {t('errors.settingsLoadDescription')}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              void (async () => {
                try {
                  await resetSettings()
                } catch (err) {
                  console.error('Failed to reset settings:', err)
                  alert(t('errors.settingsReset'))
                }
              })()
            }}
          >
            {t('settings.resetDefaults')}
          </Button>
        </div>
      </div>
    )
  }

  // --- Option lists ---

  const tabs: SettingsNavigationItem<SettingsTab>[] = [
    {
      id: 'general',
      label: t('settings.general'),
      icon: <Palette className="h-4 w-4" />,
      group: 'preferences',
    },
    {
      id: 'clipboard',
      label: t('settings.clipboard'),
      icon: <Clipboard className="h-4 w-4" />,
      group: 'preferences',
    },
    {
      id: 'keyboard',
      label: 'Keyboard',
      icon: <Keyboard className="h-4 w-4" />,
      group: 'preferences',
    },
    {
      id: 'storage',
      label: t('settings.storage'),
      icon: <Database className="h-4 w-4" />,
      group: 'preferences',
    },
    {
      id: 'privacy',
      label: t('settings.privacy'),
      icon: <Shield className="h-4 w-4" />,
      group: 'preferences',
    },
    { id: 'sync', label: 'Sync', icon: <Cloud className="h-4 w-4" />, group: 'system' },
    {
      id: 'account',
      label: t('settings.account'),
      icon: <UserRound className="h-4 w-4" />,
      group: 'system',
    },
    {
      id: 'advanced',
      label: t('settings.advanced'),
      icon: <SettingsIcon className="h-4 w-4" />,
      group: 'system',
    },
  ]

  const tabDescriptions: Record<SettingsTab, string> = {
    general: 'Appearance, language, and window behavior.',
    clipboard: 'What ClipsX captures and how it returns content to other apps.',
    keyboard: 'Global and built-in action shortcuts.',
    storage: 'History retention and capture size limits.',
    privacy: 'When local clipboard data is cleared.',
    sync: 'Configuration status, devices, and conflicts.',
    account: 'Sign in and identity for account-backed services.',
    advanced: 'Updates, system integration, and configuration tools.',
  }

  const themeOptions = [
    { value: 'auto' as Theme, label: t('settings.themeAuto') },
    { value: 'light' as Theme, label: t('settings.themeLight') },
    { value: 'dark' as Theme, label: t('settings.themeDark') },
  ]

  const languageOptions = [
    { value: 'en', label: t('settings.english') },
    { value: 'ja', label: t('settings.japanese') },
  ]

  const pasteFormatOptions = [
    { value: 'auto' as PasteFormat, label: t('settings.pasteAuto') },
    { value: 'plain' as PasteFormat, label: t('settings.pastePlain') },
  ]

  const itemActivationOptions = [
    { value: 'single_click_copy' as ItemActivationMode, label: t('settings.singleClick') },
    { value: 'double_click_primary' as ItemActivationMode, label: t('settings.doubleClick') },
  ]

  const updaterStatusLabel =
    updaterStatus === 'unavailable'
      ? t('settings.notConfigured')
      : updaterStatus === 'idle'
        ? t('settings.idle')
        : updaterStatus === 'up-to-date'
          ? t('settings.upToDate')
          : updaterStatus === 'available'
            ? t('settings.updateAvailable', { version: availableUpdate?.version ?? '' })
            : updaterStatus === 'downloading'
              ? t('settings.installingUpdate')
              : updaterStatus === 'downloaded'
                ? t('settings.restartRequired')
                : updaterStatus === 'checking'
                  ? t('settings.checking')
                  : updaterStatus === 'error'
                    ? t('errors.update')
                    : t('settings.idle')

  // --- Render ---

  return (
    <div className="flex h-full overflow-hidden">
      <SettingsNavigation
        activeTab={activeTab}
        items={tabs}
        onSelect={setActiveTab}
        title={t('settings.title')}
      />

      {/* Right Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-8 space-y-6 max-w-3xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {tabs.find(t => t.id === activeTab)?.label}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{tabDescriptions[activeTab]}</p>
          </div>
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <>
              <SettingsSection
                icon={<Palette className="h-4 w-4" />}
                title={t('settings.appearance')}
                description={t('settings.appearanceDescription')}
              >
                <SettingRow
                  label={t('settings.theme')}
                  description={t('settings.themeDescription')}
                >
                  <Select
                    value={settings.theme}
                    onChange={value => void updateSettings({ theme: value })}
                    options={themeOptions}
                    className="w-40"
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.language')}
                  description={t('settings.languageDescription')}
                >
                  <Select
                    value={settings.language}
                    onChange={value =>
                      void updateSettings({ language: value, language_initialized: true })
                    }
                    options={languageOptions}
                    className="w-40"
                  />
                </SettingRow>
              </SettingsSection>

              <SettingsSection
                icon={<SettingsIcon className="h-4 w-4" />}
                title={t('settings.windowBehavior')}
                description={t('settings.windowBehaviorDescription')}
              >
                <SettingRow
                  label={t('settings.hideOnBlur')}
                  description={t('settings.hideOnBlurDescription')}
                >
                  <Switch
                    checked={settings.hide_on_blur}
                    onChange={value => void updateSettings({ hide_on_blur: value })}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.alwaysOnTop')}
                  description={t('settings.alwaysOnTopDescription')}
                >
                  <Switch
                    checked={settings.always_on_top}
                    onChange={value => void updateSettings({ always_on_top: value })}
                  />
                </SettingRow>
              </SettingsSection>
            </>
          )}

          {activeTab === 'keyboard' && (
            <>
              <SettingsSection
                icon={<Keyboard className="h-4 w-4" />}
                title="App shortcut"
                description="Choose the keyboard shortcut that opens ClipsX from anywhere."
              >
                <SettingRow
                  label={t('settings.globalShortcut')}
                  description={t('settings.globalShortcutDescription')}
                >
                  <ShortcutRecorder
                    value={settings.global_shortcut}
                    onChange={shortcut => void updateSettings({ global_shortcut: shortcut })}
                  />
                </SettingRow>
              </SettingsSection>

              <SettingsSection
                icon={<Keyboard className="h-4 w-4" />}
                title="Built-in actions"
                description="Action-specific shortcuts will appear here as they become configurable."
              >
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:bg-white/[0.02]">
                  Navigation, copy, pin, and other built-in actions currently use their documented
                  defaults. Extension action shortcuts live with each extension.
                </p>
              </SettingsSection>
            </>
          )}

          {activeTab === 'sync' && (
            <SettingsSection
              icon={<Cloud className="h-4 w-4" />}
              title="Configuration sync"
              description="Keep preferences and extension choices consistent across your devices."
            >
              <div className="space-y-4 rounded-xl border border-violet-300/50 bg-linear-to-br from-violet-500/[0.07] to-transparent px-4 py-4 dark:border-violet-400/20 dark:from-violet-500/[0.12]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {syncStatus?.enabled ? 'Sync enabled' : 'Sync disabled'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {authStatus === 'signed_in'
                        ? `${syncStatus?.pendingRecords ?? 0} pending · ${syncStatus?.quarantinedRecords ?? 0} quarantined`
                        : 'Sign in from Account before enabling configuration sync.'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={syncBusy || authStatus !== 'signed_in' || !syncStatus}
                      onClick={() => void toggleSync()}
                    >
                      {syncBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {syncStatus?.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      disabled={syncBusy || !syncStatus?.enabled}
                      onClick={() => void syncNow()}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncBusy ? 'animate-spin' : ''}`} />
                      Sync now
                    </Button>
                  </div>
                </div>
                {syncStatus?.lastError && (
                  <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    {syncStatus.lastError}
                  </p>
                )}
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-slate-500">Device</dt><dd>{syncStatus?.deviceName ?? 'Loading…'}</dd></div>
                  <div><dt className="text-slate-500">Last success</dt><dd>{syncStatus?.lastSuccessAt ? new Date(syncStatus.lastSuccessAt).toLocaleString() : 'Never'}</dd></div>
                </dl>
                <div className="grid gap-3 text-xs leading-5 md:grid-cols-2">
                  <div><p className="font-semibold">Included</p><p className="text-slate-500">Theme and language now; renderer preferences, OCR preferences, signed extension intent/settings, and shortcuts join this same typed record boundary.</p></div>
                  <div><p className="font-semibold">Always local</p><p className="text-slate-500">Clips, notes, tags, files, credentials, provider endpoints/models, grants, device capture/window settings, jobs, diagnostics, and derived data.</p></div>
                </div>
              </div>
            </SettingsSection>
          )}

          {/* CLIPBOARD TAB */}
          {activeTab === 'clipboard' && (
            <>
              <SettingsSection
                icon={<Clipboard className="h-4 w-4" />}
                title={t('settings.monitoring')}
                description={t('settings.monitoringDescription')}
              >
                <SettingRow
                  label={t('settings.captureImages')}
                  description={t('settings.captureImagesDescription')}
                >
                  <Switch
                    checked={settings.enable_images}
                    onChange={value => void updateSettings({ enable_images: value })}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.captureFiles')}
                  description={t('settings.captureFilesDescription')}
                >
                  <Switch
                    checked={settings.enable_files}
                    onChange={value => void updateSettings({ enable_files: value })}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.captureRichText')}
                  description={t('settings.captureRichTextDescription')}
                >
                  <Switch
                    checked={settings.enable_rich_text}
                    onChange={value => void updateSettings({ enable_rich_text: value })}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.captureOffice')}
                  description={t('settings.captureOfficeDescription')}
                >
                  <Switch
                    checked={settings.enable_office_formats}
                    onChange={value => void updateSettings({ enable_office_formats: value })}
                  />
                </SettingRow>
              </SettingsSection>

              <SettingsSection
                icon={<Clipboard className="h-4 w-4" />}
                title={t('settings.interactions')}
                description={t('settings.interactionsDescription')}
              >
                <div className="space-y-3">
                  {/* Option 1: Paste to App */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      void updateSettings({ paste_on_enter: true, hide_on_copy: true })
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void updateSettings({ paste_on_enter: true, hide_on_copy: true })
                      }
                    }}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer text-left ${
                      settings.paste_on_enter
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 shadow-[0_0_0_2px_rgba(59,130,246,0.1)]'
                        : 'border-gray-200 dark:border-white/10 bg-slate-100/30 dark:bg-slate-100/5 hover:border-blue-300 dark:hover:border-blue-500/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          settings.paste_on_enter
                            ? 'border-blue-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        {settings.paste_on_enter && (
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                        )}
                      </div>
                      <div>
                        <h4
                          className={`text-sm font-semibold ${settings.paste_on_enter ? 'text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}
                        >
                          {t('settings.pasteActive')}
                        </h4>
                        <p
                          className={`text-xs mt-1 leading-relaxed ${settings.paste_on_enter ? 'text-blue-700/80 dark:text-blue-200/70' : 'text-gray-500 dark:text-gray-400'}`}
                        >
                          {t('settings.pasteActiveDescription')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Option 2: Copy to Clipboard Only */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      void updateSettings({ paste_on_enter: false, hide_on_copy: false })
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void updateSettings({ paste_on_enter: false, hide_on_copy: false })
                      }
                    }}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer text-left ${
                      !settings.paste_on_enter
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 shadow-[0_0_0_2px_rgba(59,130,246,0.1)]'
                        : 'border-gray-200 dark:border-white/10 bg-slate-100/30 dark:bg-slate-100/5 hover:border-blue-300 dark:hover:border-blue-500/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          !settings.paste_on_enter
                            ? 'border-blue-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        {!settings.paste_on_enter && (
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                        )}
                      </div>
                      <div>
                        <h4
                          className={`text-sm font-semibold ${!settings.paste_on_enter ? 'text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}
                        >
                          {t('settings.copyOnly')}
                        </h4>
                        <p
                          className={`text-xs mt-1 leading-relaxed ${!settings.paste_on_enter ? 'text-blue-700/80 dark:text-blue-200/70' : 'text-gray-500 dark:text-gray-400'}`}
                        >
                          {t('settings.copyOnlyDescription')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-white/5 space-y-4">
                  <SettingRow
                    label={t('settings.pasteFormat')}
                    description={t('settings.pasteFormatDescription')}
                  >
                    <Select
                      value={settings.default_paste_format}
                      onChange={value => void updateSettings({ default_paste_format: value })}
                      options={pasteFormatOptions}
                      className="w-48"
                    />
                  </SettingRow>

                  <SettingRow
                    label={t('settings.clickBehavior')}
                    description={t('settings.clickBehaviorDescription')}
                  >
                    <Select
                      value={settings.item_activation_mode}
                      onChange={value => void updateSettings({ item_activation_mode: value })}
                      options={itemActivationOptions}
                      className="w-56"
                    />
                  </SettingRow>
                </div>
              </SettingsSection>

              <SettingsSection
                icon={<Shield className="h-4 w-4" />}
                title={t('settings.exclusions')}
                description={t('settings.exclusionsDescription')}
              >
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t('settings.excludedApplications')}
                    </label>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500 mb-2">
                      {t('settings.excludedApplicationsDescription')}
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t('settings.appNamePlaceholder')}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget
                            const appName = input.value.trim()
                            if (appName && !settings.excluded_apps.includes(appName)) {
                              void updateSettings({
                                excluded_apps: [...settings.excluded_apps, appName],
                              })
                              input.value = ''
                            }
                          }
                        }}
                        className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-slate-100/10 dark:bg-slate-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <Button
                        size="sm"
                        onClick={e => {
                          const btn = e.currentTarget as HTMLButtonElement
                          const input = btn.previousElementSibling as HTMLInputElement
                          const appName = input?.value.trim()
                          if (appName && !settings.excluded_apps.includes(appName)) {
                            void updateSettings({
                              excluded_apps: [...settings.excluded_apps, appName],
                            })
                            input.value = ''
                          }
                        }}
                      >
                        {t('settings.add')}
                      </Button>
                    </div>
                  </div>

                  {settings.excluded_apps.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {settings.excluded_apps.map(app => (
                        <div
                          key={app}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100/10 dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300"
                        >
                          <span>{app}</span>
                          <button
                            onClick={() => {
                              void updateSettings({
                                excluded_apps: settings.excluded_apps.filter(a => a !== app),
                              })
                            }}
                            className="text-gray-500 hover:text-red-500 transition-colors cursor-pointer"
                            aria-label={t('clipboard.removeApp', { name: app })}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {settings.excluded_apps.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-600 italic">
                      {t('settings.noExcludedApps')}
                    </p>
                  )}
                </div>
              </SettingsSection>
            </>
          )}

          {/* ACCOUNT TAB */}
          {activeTab === 'account' && (
            <>
              <SettingsSection
                icon={<UserRound className="h-4 w-4" />}
                title={t('settings.account')}
                description={t('settings.accountDescription')}
              >
                <div className="rounded-xl border border-gray-200/70 bg-slate-100/40 p-4 dark:border-white/10 dark:bg-slate-100/5">
                  {authStatus === 'unconfigured' && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {t('settings.accountUnconfigured')}
                    </p>
                  )}

                  {authStatus === 'loading' && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Loader2 className="h-4 w-4 animate-spin" /> {t('settings.restoringSession')}
                    </div>
                  )}

                  {authStatus === 'signed_in' && (
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {t('settings.signedIn')}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{authEmail}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<LogOut className="h-3.5 w-3.5" />}
                        onClick={() => void signOut()}
                      >
                        {t('settings.signOut')}
                      </Button>
                    </div>
                  )}

                  {(authStatus === 'signed_out' || authStatus === 'error') && (
                    <div className="space-y-3">
                      {authError && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {import.meta.env.DEV ? authError : t('errors.genericDescription')}
                        </p>
                      )}
                      <Button onClick={() => void signIn()}>{t('settings.signIn')}</Button>
                    </div>
                  )}

                  {authStatus === 'signing_in' && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Loader2 className="h-4 w-4 animate-spin" /> {t('settings.continueSignIn')}
                    </div>
                  )}
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.accountPrivacy')}
                </p>
              </SettingsSection>
            </>
          )}

          {/* STORAGE TAB */}
          {activeTab === 'storage' && (
            <>
              <SettingsSection
                icon={<Database className="h-4 w-4" />}
                title={t('settings.historyLimits')}
                description={t('settings.historyLimitsDescription')}
              >
                <SettingRow
                  label={t('settings.maximumClips')}
                  description={t('settings.maximumClipsDescription')}
                >
                  <ButtonGroup
                    value={settings.max_clips}
                    onChange={value => void updateSettings({ max_clips: value })}
                    options={[
                      {
                        value: 0,
                        label: t('settings.unlimited'),
                        icon: <InfinityIcon className="h-3 w-3" />,
                      },
                      { value: 100, label: '100' },
                      { value: 500, label: '500' },
                      {
                        value: 1000,
                        label: new Intl.NumberFormat(i18n.resolvedLanguage).format(1000),
                      },
                      {
                        value: 5000,
                        label: new Intl.NumberFormat(i18n.resolvedLanguage).format(5000),
                      },
                    ]}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.deleteOlder')}
                  description={t('settings.deleteOlderDescription')}
                >
                  <ButtonGroup
                    value={settings.max_age_days}
                    onChange={value => void updateSettings({ max_age_days: value })}
                    options={[
                      {
                        value: 0,
                        label: t('settings.never'),
                        icon: <InfinityIcon className="h-3 w-3" />,
                      },
                      {
                        value: 1,
                        label: t('settings.hours24'),
                        icon: <Clock className="h-3 w-3" />,
                      },
                      {
                        value: 7,
                        label: t('settings.week1'),
                        icon: <Calendar className="h-3 w-3" />,
                      },
                      {
                        value: 30,
                        label: t('settings.month1'),
                        icon: <Calendar className="h-3 w-3" />,
                      },
                      {
                        value: 90,
                        label: t('settings.months3'),
                        icon: <Calendar className="h-3 w-3" />,
                      },
                    ]}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.maxItemSize')}
                  description={t('settings.maxItemSizeDescription')}
                >
                  <ButtonGroup
                    value={settings.max_item_size_mb}
                    onChange={value => void updateSettings({ max_item_size_mb: value })}
                    options={[
                      { value: 1, label: '1 MB' },
                      { value: 5, label: '5 MB' },
                      { value: 10, label: '10 MB' },
                      { value: 25, label: '25 MB' },
                      { value: 50, label: '50 MB' },
                    ]}
                  />
                </SettingRow>
              </SettingsSection>

              <Card className="shadow-sm">
                <Button
                  variant="destructive"
                  leftIcon={<Trash className="h-4 w-4" />}
                  onClick={() => void handleClearAllData()}
                >
                  {t('settings.clearAllData')}
                </Button>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  {t('settings.clearAllDescription')}
                </p>
              </Card>
            </>
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <>
              <SettingsSection
                icon={<Shield className="h-4 w-4" />}
                title={t('settings.privacySecurity')}
                description={t('settings.privacySecurityDescription')}
              >
                <SettingRow
                  label={t('settings.autoClear')}
                  description={t('settings.autoClearDescription')}
                >
                  <ButtonGroup
                    value={settings.auto_clear_minutes}
                    onChange={value => void updateSettings({ auto_clear_minutes: value })}
                    options={[
                      {
                        value: 0,
                        label: t('settings.never'),
                        icon: <InfinityIcon className="h-3 w-3" />,
                      },
                      {
                        value: 5,
                        label: t('settings.minutes5'),
                        icon: <Zap className="h-3 w-3" />,
                      },
                      {
                        value: 15,
                        label: t('settings.minutes15'),
                        icon: <Timer className="h-3 w-3" />,
                      },
                      {
                        value: 30,
                        label: t('settings.minutes30'),
                        icon: <Clock className="h-3 w-3" />,
                      },
                      {
                        value: 60,
                        label: t('settings.hour1'),
                        icon: <Clock className="h-3 w-3" />,
                      },
                    ]}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.clearOnExit')}
                  description={t('settings.clearOnExitDescription')}
                >
                  <Switch
                    checked={settings.clear_on_exit}
                    onChange={value => void updateSettings({ clear_on_exit: value })}
                  />
                </SettingRow>
              </SettingsSection>
            </>
          )}

          {/* ADVANCED TAB */}
          {activeTab === 'advanced' && (
            <>
              <SettingsSection
                icon={<SettingsIcon className="h-4 w-4" />}
                title={t('settings.system')}
                description={t('settings.systemDescription')}
              >
                <SettingRow
                  label={t('settings.autoStart')}
                  description={t('settings.autoStartDescription')}
                >
                  <Switch
                    checked={settings.auto_start}
                    onChange={value => {
                      void (async () => {
                        try {
                          if (value) {
                            await enable()
                          } else {
                            await disable()
                          }
                          void updateSettings({ auto_start: value })
                        } catch (err) {
                          console.error('Failed to toggle autostart:', err)
                        }
                      })()
                    }}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.copyToast')}
                  description={t('settings.copyToastDescription')}
                >
                  <Switch
                    checked={settings.show_copy_toast}
                    onChange={value => void updateSettings({ show_copy_toast: value })}
                  />
                </SettingRow>
              </SettingsSection>

              <SettingsSection
                icon={<RefreshCw className="h-4 w-4" />}
                title={t('settings.updates')}
                description={t('settings.updatesDescription')}
              >
                <div className="rounded-xl border border-gray-200/70 dark:border-white/10 bg-slate-100/40 dark:bg-slate-100/5 px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        ClipsX {currentVersion ?? '...'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                        {updaterStatusLabel}
                      </p>
                      {availableUpdate && (
                        <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                          {t('settings.latestVersion', { version: availableUpdate.version })}
                        </p>
                      )}
                      {updaterConfigured === false && (
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                          {t('settings.updaterKeyMissing')}
                        </p>
                      )}
                      {updaterError && (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {t('errors.update')}
                        </p>
                      )}
                      {updateReady && (
                        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                          {t('settings.updateInstalled')}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        isLoading={isCheckingForUpdates}
                        leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                        onClick={() => void checkForUpdates()}
                      >
                        {t('settings.checkNow')}
                      </Button>

                      {availableUpdate && !updateReady && (
                        <Button
                          size="sm"
                          isLoading={isDownloadingUpdate}
                          onClick={() => void downloadAndInstallUpdate()}
                        >
                          {t('settings.installUpdate')}
                        </Button>
                      )}

                      {updateReady && (
                        <Button size="sm" onClick={() => void restartToApplyUpdate()}>
                          {t('settings.restartNow')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </SettingsSection>

              <Card className="shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  {t('settings.manageSettings')}
                </h3>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    leftIcon={<Download className="h-4 w-4" />}
                    onClick={() => void handleExport()}
                  >
                    {t('settings.export')}
                  </Button>
                  <Button
                    variant="outline"
                    leftIcon={<Upload className="h-4 w-4" />}
                    onClick={() => void handleImport()}
                  >
                    {t('settings.import')}
                  </Button>
                  <Button
                    variant="destructive"
                    leftIcon={<RotateCcw className="h-4 w-4" />}
                    onClick={() => void handleReset()}
                  >
                    {t('settings.resetToDefaults')}
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
