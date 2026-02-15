import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../../stores'
import { useClipboardStore } from '../../stores'
import { useTheme } from '../../shared/hooks/useTheme'
import type { Theme, ViewMode, RetentionPolicy, PasteFormat } from '../../shared/types'
import { Button, Switch, Select, Card } from '../../shared/components/ui'
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
} from 'lucide-react'

type Tab = 'general' | 'clipboard' | 'storage' | 'privacy' | 'advanced'

// --- Settings-specific layout components (not shared) ---

type SettingsSectionProps = {
  readonly icon: React.ReactNode
  readonly title: string
  readonly description: string
  readonly children: React.ReactNode
}

const SettingsSection = ({ icon, title, description, children }: SettingsSectionProps) => (
  <Card
    header={
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-100 to-violet-100 dark:from-blue-900/30 dark:to-violet-900/30 text-blue-600 dark:text-violet-400">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-500">{description}</p>
        </div>
      </div>
    }
    className="shadow-sm"
  >
    <div className="space-y-4">{children}</div>
  </Card>
)

type SettingRowProps = {
  readonly label: string
  readonly description?: string
  readonly children: React.ReactNode
}

const SettingRow = ({ label, description, children }: SettingRowProps) => (
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1 min-w-0">
      <label className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</label>
      {description && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">{description}</p>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

type ButtonGroupOption = {
  readonly value: number
  readonly label: string
  readonly icon?: React.ReactNode
}

type ButtonGroupProps = {
  readonly value: number
  readonly onChange: (value: number) => void
  readonly options: readonly ButtonGroupOption[]
}

const ButtonGroup = ({ value, onChange, options }: ButtonGroupProps) => (
  <div className="flex flex-wrap gap-2">
    {options.map(option => (
      <Button
        key={option.value}
        variant={value === option.value ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => onChange(option.value)}
        leftIcon={option.icon}
      >
        {option.label}
      </Button>
    ))}
  </div>
)

// --- Main Settings component ---

export const Settings = () => {
  const { settings, isLoading, error, loadSettings, updateSettings } = useSettingsStore()
  const clearAllClips = useClipboardStore(state => state.clearAllClips)
  const { setThemeMode } = useTheme()
  const [activeTab, setActiveTab] = useState<Tab>('general')

  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (settings) {
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
    if (
      confirm(
        'Are you sure you want to delete ALL clipboard history? This action cannot be undone!'
      )
    ) {
      await clearAllClips()
      alert('All clipboard data has been deleted.')
    }
  }

  const handleExport = () => {
    if (!settings) return
    const json = JSON.stringify(settings, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clips-settings-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        try {
          const text = await file.text()
          const imported = JSON.parse(text)
          await updateSettings(imported)
          alert('Settings imported successfully!')
        } catch (error) {
          alert('Failed to import settings. Please check the file format.')
        }
      }
    }
    input.click()
  }

  const handleReset = async () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      await loadSettings()
      alert('Settings reset to defaults!')
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
            <h2 className="text-lg font-semibold">Failed to Load Settings</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              {error || 'Settings file may be corrupted'}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await invoke('update_settings', {
                  settings: {
                    theme: 'auto',
                    view_mode: 'list',
                    language: 'en',
                    global_shortcut: 'Cmd+Shift+V',
                    enable_images: true,
                    enable_files: true,
                    enable_rich_text: true,
                    excluded_apps: [],
                    history_limit: 1000,
                    retention_policy: 'unlimited',
                    retention_value: 0,
                    auto_delete_days: 0,
                    max_image_size_mb: 10,
                    auto_clear_minutes: 0,
                    hide_on_copy: false,
                    clear_on_exit: false,
                    auto_start: false,
                    default_paste_format: 'auto',
                    auto_close_after_paste: true,
                    show_copy_toast: true,
                    toast_duration_ms: 1500,
                  }
                })
                await loadSettings()
              } catch (err) {
                console.error('Failed to reset settings:', err)
                alert('Failed to reset settings: ' + err)
              }
            }}
          >
            Reset to Default Settings
          </Button>
        </div>
      </div>
    )
  }

  // --- Option lists ---

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <SettingsIcon className="h-4 w-4" /> },
    { id: 'clipboard', label: 'Clipboard', icon: <Clipboard className="h-4 w-4" /> },
    { id: 'storage', label: 'Storage', icon: <Database className="h-4 w-4" /> },
    { id: 'privacy', label: 'Privacy', icon: <Shield className="h-4 w-4" /> },
    { id: 'advanced', label: 'Advanced', icon: <Keyboard className="h-4 w-4" /> },
  ]

  const themeOptions = [
    { value: 'auto' as Theme, label: 'Auto (System)' },
    { value: 'light' as Theme, label: 'Light' },
    { value: 'dark' as Theme, label: 'Dark' },
  ]

  const viewModeOptions = [
    { value: 'list' as ViewMode, label: 'List' },
    { value: 'grid' as ViewMode, label: 'Grid' },
  ]

  const languageOptions = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'ja', label: '日本語' },
    { value: 'zh', label: '中文' },
  ]

  const retentionPolicyOptions = [
    { value: 'unlimited' as RetentionPolicy, label: 'Keep Everything' },
    { value: 'days' as RetentionPolicy, label: 'Delete After X Days' },
    { value: 'count' as RetentionPolicy, label: 'Keep Last X Clips' },
  ]

  const pasteFormatOptions = [
    { value: 'auto' as PasteFormat, label: 'Auto (Original Format)' },
    { value: 'plain' as PasteFormat, label: 'Plain Text' },
    { value: 'html' as PasteFormat, label: 'HTML' },
    { value: 'markdown' as PasteFormat, label: 'Markdown' },
  ]

  // --- Render ---

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/30 px-3">
        <div className="flex gap-0.5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 border-b-2 relative overflow-hidden cursor-pointer ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:scale-105 hover:shadow-sm'
              }`}
            >
              <span className="transition-transform duration-200 group-hover:scale-110">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-gray-50 dark:bg-transparent">
        <div className="px-4 pt-4 pb-6 space-y-5 max-w-4xl">
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <>
              <SettingsSection
                icon={<Palette className="h-4 w-4" />}
                title="Appearance"
                description="Customize the look and feel"
              >
                <SettingRow label="Theme" description="Choose your preferred color scheme">
                  <Select
                    value={settings.theme}
                    onChange={value => updateSettings({ theme: value as Theme })}
                    options={themeOptions}
                    className="w-40"
                  />
                </SettingRow>

                <SettingRow label="View Mode" description="List or grid display">
                  <Select
                    value={settings.view_mode}
                    onChange={value => updateSettings({ view_mode: value as ViewMode })}
                    options={viewModeOptions}
                    className="w-40"
                  />
                </SettingRow>

                <SettingRow label="Language" description="Select your preferred language">
                  <Select
                    value={settings.language}
                    onChange={value => updateSettings({ language: value })}
                    options={languageOptions}
                    className="w-40"
                  />
                </SettingRow>
              </SettingsSection>

              <SettingsSection
                icon={<Keyboard className="h-4 w-4" />}
                title="Shortcuts"
                description="Keyboard shortcuts"
              >
                <SettingRow
                  label="Global Shortcut"
                  description="Keyboard shortcut to show/hide the app"
                >
                  <input
                    type="text"
                    value={settings.global_shortcut}
                    onChange={e => updateSettings({ global_shortcut: e.target.value })}
                    placeholder="Cmd+Shift+V"
                    className="w-48 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </SettingRow>
              </SettingsSection>
            </>
          )}

          {/* CLIPBOARD TAB */}
          {activeTab === 'clipboard' && (
            <>
              <SettingsSection
                icon={<Clipboard className="h-4 w-4" />}
                title="Clipboard Monitoring"
                description="Control what gets captured"
              >
                <SettingRow label="Capture Images" description="Save images from clipboard">
                  <Switch
                    checked={settings.enable_images}
                    onChange={value => updateSettings({ enable_images: value })}
                  />
                </SettingRow>

                <SettingRow label="Capture Files" description="Save file paths from clipboard">
                  <Switch
                    checked={settings.enable_files}
                    onChange={value => updateSettings({ enable_files: value })}
                  />
                </SettingRow>

                <SettingRow label="Capture Rich Text" description="Save HTML/RTF formatting">
                  <Switch
                    checked={settings.enable_rich_text}
                    onChange={value => updateSettings({ enable_rich_text: value })}
                  />
                </SettingRow>

                <SettingRow label="Default Paste Format" description="Format to use when pasting">
                  <Select
                    value={settings.default_paste_format}
                    onChange={value => updateSettings({ default_paste_format: value as PasteFormat })}
                    options={pasteFormatOptions}
                    className="w-48"
                  />
                </SettingRow>
              </SettingsSection>

              <SettingsSection
                icon={<Shield className="h-4 w-4" />}
                title="App Exclusions"
                description="Prevent specific apps from being monitored"
              >
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Excluded Applications
                    </label>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500 mb-2">
                      Clipboard content from these apps won't be captured
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter app name..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget
                            const appName = input.value.trim()
                            if (appName && !settings.excluded_apps.includes(appName)) {
                              updateSettings({
                                excluded_apps: [...settings.excluded_apps, appName]
                              })
                              input.value = ''
                            }
                          }
                        }}
                        className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <Button
                        size="sm"
                        onClick={(e) => {
                          const btn = e.currentTarget as HTMLButtonElement
                          const input = btn.previousElementSibling as HTMLInputElement
                          const appName = input?.value.trim()
                          if (appName && !settings.excluded_apps.includes(appName)) {
                            updateSettings({
                              excluded_apps: [...settings.excluded_apps, appName]
                            })
                            input.value = ''
                          }
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                  
                  {settings.excluded_apps.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {settings.excluded_apps.map(app => (
                        <div
                          key={app}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300"
                        >
                          <span>{app}</span>
                          <button
                            onClick={() => {
                              updateSettings({
                                excluded_apps: settings.excluded_apps.filter(a => a !== app)
                              })
                            }}
                            className="text-gray-500 hover:text-red-500 transition-colors cursor-pointer"
                            aria-label={`Remove ${app}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {settings.excluded_apps.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-600 italic">
                      No excluded apps. Add apps to prevent clipboard monitoring.
                    </p>
                  )}
                </div>
              </SettingsSection>
            </>
          )}

          {/* STORAGE TAB */}
          {activeTab === 'storage' && (
            <>
              <SettingsSection
                icon={<Database className="h-4 w-4" />}
                title="History Limits"
                description="Control memory usage"
              >
                <SettingRow
                  label="History Limit"
                  description="Maximum clips to keep in memory"
                >
                  <ButtonGroup
                    value={settings.history_limit}
                    onChange={value => updateSettings({ history_limit: value })}
                    options={[
                      { value: 100, label: '100' },
                      { value: 500, label: '500' },
                      { value: 1000, label: '1,000' },
                      { value: 5000, label: '5,000' },
                      { value: 10000, label: '10,000' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Max Image Size" description="Maximum size for image clips">
                  <ButtonGroup
                    value={settings.max_image_size_mb}
                    onChange={value => updateSettings({ max_image_size_mb: value })}
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

              <SettingsSection
                icon={<Calendar className="h-4 w-4" />}
                title="Retention Policy"
                description="How long to keep clips"
              >
                <SettingRow label="Retention Policy" description="Choose retention strategy">
                  <Select
                    value={settings.retention_policy}
                    onChange={value => updateSettings({ retention_policy: value as RetentionPolicy })}
                    options={retentionPolicyOptions}
                    className="w-48"
                  />
                </SettingRow>

                {settings.retention_policy !== 'unlimited' && (
                  <SettingRow
                    label={settings.retention_policy === 'days' ? 'Days to Keep' : 'Number of Clips'}
                    description={
                      settings.retention_policy === 'days'
                        ? 'Delete clips older than this many days'
                        : 'Keep only this many recent clips'
                    }
                  >
                    <input
                      type="number"
                      min="1"
                      value={settings.retention_value}
                      onChange={e => updateSettings({ retention_value: parseInt(e.target.value) || 0 })}
                      className="w-24 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </SettingRow>
                )}

                <SettingRow
                  label="Auto-delete Old Clips"
                  description="Remove clips older than a specific age"
                >
                  <ButtonGroup
                    value={settings.auto_delete_days}
                    onChange={value => updateSettings({ auto_delete_days: value })}
                    options={[
                      { value: 0, label: 'Never', icon: <InfinityIcon className="h-3 w-3" /> },
                      { value: 1, label: '24 hours', icon: <Clock className="h-3 w-3" /> },
                      { value: 7, label: '1 week', icon: <Calendar className="h-3 w-3" /> },
                      { value: 30, label: '1 month', icon: <Calendar className="h-3 w-3" /> },
                      { value: 90, label: '3 months', icon: <Calendar className="h-3 w-3" /> },
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
                  Clear All Clipboard Data
                </Button>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  Permanently delete all clipboard history. This action cannot be undone.
                </p>
              </Card>
            </>
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <SettingsSection
              icon={<Shield className="h-4 w-4" />}
              title="Privacy & Security"
              description="Protect your sensitive information"
            >
              <SettingRow
                label="Auto-clear After Copy"
                description="Automatically delete sensitive clips after a set time"
              >
                <ButtonGroup
                  value={settings.auto_clear_minutes}
                  onChange={value => updateSettings({ auto_clear_minutes: value })}
                  options={[
                    { value: 0, label: 'Never', icon: <InfinityIcon className="h-3 w-3" /> },
                    { value: 5, label: '5 min', icon: <Zap className="h-3 w-3" /> },
                    { value: 15, label: '15 min', icon: <Timer className="h-3 w-3" /> },
                    { value: 30, label: '30 min', icon: <Clock className="h-3 w-3" /> },
                    { value: 60, label: '1 hour', icon: <Clock className="h-3 w-3" /> },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Hide Window on Copy"
                description="Automatically hide the app after copying a clip"
              >
                <Switch
                  checked={settings.hide_on_copy}
                  onChange={value => updateSettings({ hide_on_copy: value })}
                />
              </SettingRow>

              <SettingRow
                label="Clear on Exit"
                description="Delete all clipboard history when closing the app"
              >
                <Switch
                  checked={settings.clear_on_exit}
                  onChange={value => updateSettings({ clear_on_exit: value })}
                />
              </SettingRow>

              <SettingRow
                label="Auto-close After Paste"
                description="Close window after pasting a clip"
              >
                <Switch
                  checked={settings.auto_close_after_paste}
                  onChange={value => updateSettings({ auto_close_after_paste: value })}
                />
              </SettingRow>
            </SettingsSection>
          )}

          {/* ADVANCED TAB */}
          {activeTab === 'advanced' && (
            <>
              <SettingsSection
                icon={<SettingsIcon className="h-4 w-4" />}
                title="System"
                description="System integration"
              >
                <SettingRow
                  label="Auto-start on Login"
                  description="Launch automatically when you log in"
                >
                  <Switch
                    checked={settings.auto_start}
                    onChange={value => updateSettings({ auto_start: value })}
                  />
                </SettingRow>

                <SettingRow label="Show Copy Toast" description="Display notification when copying">
                  <Switch
                    checked={settings.show_copy_toast}
                    onChange={value => updateSettings({ show_copy_toast: value })}
                  />
                </SettingRow>

                <SettingRow label="Toast Duration" description="How long notifications stay visible">
                  <ButtonGroup
                    value={settings.toast_duration_ms}
                    onChange={value => updateSettings({ toast_duration_ms: value })}
                    options={[
                      { value: 1000, label: 'Quick (1s)' },
                      { value: 1500, label: 'Default (1.5s)' },
                      { value: 2000, label: 'Slow (2s)' },
                      { value: 3000, label: 'Long (3s)' },
                    ]}
                  />
                </SettingRow>
              </SettingsSection>

              <Card className="shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Manage Settings
                </h3>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    leftIcon={<Download className="h-4 w-4" />}
                    onClick={handleExport}
                  >
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    leftIcon={<Upload className="h-4 w-4" />}
                    onClick={handleImport}
                  >
                    Import
                  </Button>
                  <Button
                    variant="destructive"
                    leftIcon={<RotateCcw className="h-4 w-4" />}
                    onClick={() => void handleReset()}
                  >
                    Reset to Defaults
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
