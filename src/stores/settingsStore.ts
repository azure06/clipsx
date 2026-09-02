import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'
import { PROFILE_MUTATED_EVENT } from '../shared/sync/configSync'

type V2Settings = {
  theme: string
  language: string
  languageInitialized: boolean
  activationMode: 'single_click_copy' | 'double_click_primary' | 'select_only'
  defaultOutputFormat: 'original' | 'plain_text'
  pasteOnEnter: boolean
  hideOnCopy: boolean
  hideOnBlur: boolean
  alwaysOnTop: boolean
  showCopyToast: boolean
  globalShortcut: string
  excludedApps: string[]
  autoClearMinutes: number | null
  clearOnExit: boolean
  autoStart: boolean
  captureFilters: {
    images: boolean
    files: boolean
    richText: boolean
    officeAndDocuments: boolean
  }
  capture: {
    maxOrdinaryClips: number | null
    maxAgeDays: number | null
    maxRepresentationBytes: number | null
  }
}
const fromV2 = (settings: V2Settings): AppSettings => ({
  ...DEFAULT_SETTINGS,
  theme: settings.theme === 'system' ? 'auto' : (settings.theme as AppSettings['theme']),
  language: settings.language,
  language_initialized: settings.languageInitialized,
  global_shortcut: settings.globalShortcut,
  enable_images: settings.captureFilters.images,
  enable_files: settings.captureFilters.files,
  enable_rich_text: settings.captureFilters.richText,
  enable_office_formats: settings.captureFilters.officeAndDocuments,
  excluded_apps: settings.excludedApps,
  max_clips: settings.capture.maxOrdinaryClips ?? 0,
  max_age_days: settings.capture.maxAgeDays ?? 0,
  max_item_size_mb: Math.round((settings.capture.maxRepresentationBytes ?? 0) / 1_048_576),
  default_paste_format: settings.defaultOutputFormat === 'plain_text' ? 'plain' : 'auto',
  paste_on_enter: settings.pasteOnEnter,
  item_activation_mode: settings.activationMode,
  hide_on_copy: settings.hideOnCopy,
  hide_on_blur: settings.hideOnBlur,
  always_on_top: settings.alwaysOnTop,
  show_copy_toast: settings.showCopyToast,
  auto_clear_minutes: settings.autoClearMinutes ?? 0,
  clear_on_exit: settings.clearOnExit,
  auto_start: settings.autoStart,
})
const toV2 = (settings: AppSettings): V2Settings => ({
  theme: settings.theme === 'auto' ? 'system' : settings.theme,
  language: settings.language,
  languageInitialized: settings.language_initialized,
  activationMode: settings.item_activation_mode,
  defaultOutputFormat: settings.default_paste_format === 'plain' ? 'plain_text' : 'original',
  pasteOnEnter: settings.paste_on_enter,
  hideOnCopy: settings.hide_on_copy,
  hideOnBlur: settings.hide_on_blur,
  alwaysOnTop: settings.always_on_top,
  showCopyToast: settings.show_copy_toast,
  globalShortcut: settings.global_shortcut,
  autoClearMinutes: settings.auto_clear_minutes || null,
  clearOnExit: settings.clear_on_exit,
  autoStart: settings.auto_start,
  excludedApps: settings.excluded_apps,
  captureFilters: {
    images: settings.enable_images,
    files: settings.enable_files,
    richText: settings.enable_rich_text,
    officeAndDocuments: settings.enable_office_formats,
  },
  capture: {
    maxOrdinaryClips: settings.max_clips || null,
    maxAgeDays: settings.max_age_days || null,
    maxRepresentationBytes: settings.max_item_size_mb
      ? settings.max_item_size_mb * 1_048_576
      : null,
  },
})

interface SettingsState {
  settings: AppSettings | null
  isLoading: boolean
  error: string | null
  loadSettings: () => Promise<void>
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  resetSettings: () => Promise<void>
  getSettingsPath: () => Promise<string>
}
export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,
  loadSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      set({ settings: fromV2(await invoke<V2Settings>('get_app_settings')), isLoading: false })
    } catch (error) {
      set({ error: String(error), isLoading: false })
    }
  },
  updateSettings: async updates => {
    const current = get().settings
    if (!current) throw new Error('Settings not loaded')
    const next = { ...current, ...updates }
    set({ settings: next })
    try {
      set({
        settings: fromV2(await invoke<V2Settings>('update_app_settings', { settings: toV2(next) })),
      })
      window.dispatchEvent(new Event(PROFILE_MUTATED_EVENT))
    } catch (error) {
      set({ settings: current })
      throw error
    }
  },
  resetSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      set({
        settings: fromV2(
          await invoke<V2Settings>('update_app_settings', { settings: toV2(DEFAULT_SETTINGS) })
        ),
        isLoading: false,
      })
      window.dispatchEvent(new Event(PROFILE_MUTATED_EVENT))
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },
  getSettingsPath: async () => await Promise.resolve('ClipsX local profile'),
}))
