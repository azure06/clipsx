import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'
import { PROFILE_MUTATED_EVENT, SYNC_APPLIED_EVENT } from '../shared/sync/configSync'

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
  loggingEnabled: boolean
  captureFilters: {
    images: boolean
    files: boolean
    richText: boolean
    officeAndDocuments: boolean
  }
  capture: {
    maxOrdinaryClips: number | null
    maxAgeDays: number | null
    maxManagedBytes: number | null
    maxRepresentationBytes: number | null
    maxSnapshotBytes: number | null
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
  max_item_size_mb: (settings.capture.maxRepresentationBytes ?? 0) / 1_048_576,
  max_managed_bytes: settings.capture.maxManagedBytes,
  max_snapshot_bytes: settings.capture.maxSnapshotBytes,
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
  logging_enabled: settings.loggingEnabled,
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
  loggingEnabled: settings.logging_enabled,
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
    maxManagedBytes: settings.max_managed_bytes,
    maxRepresentationBytes: settings.max_item_size_mb
      ? settings.max_item_size_mb * 1_048_576
      : null,
    maxSnapshotBytes: settings.max_snapshot_bytes,
  },
})

type SettingsResult = { settings: V2Settings; failedEffects: string[] }

// Mutations and reloads share one queue. Each patch is derived only when its turn
// starts, so an earlier failure cannot roll back a later successful operation.
let pending: Promise<unknown> = Promise.resolve()
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const result = pending.then(work)
  pending = result.catch(() => undefined)
  return result
}

const changedValues = (previous: object, next: object): Record<string, unknown> => {
  const before = previous as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(next as Record<string, unknown>).flatMap(([key, value]) => {
      if (JSON.stringify(before[key]) === JSON.stringify(value)) return []
      if (value && typeof value === 'object' && !Array.isArray(value) && before[key]) {
        return [[key, changedValues(before[key] as object, value)]]
      }
      return [[key, value]]
    })
  )
}

interface SettingsState {
  settings: AppSettings | null
  isLoading: boolean
  error: string | null
  saveError: string | null
  failedEffects: string[]
  loadSettings: () => Promise<void>
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  resetSettings: () => Promise<void>
  retryEffects: () => Promise<void>
  exportSettings: () => Promise<string>
  importSettings: (document: string) => Promise<void>
  getSettingsPath: () => Promise<string>
}
export const useSettingsStore = create<SettingsState>((set, get) => {
  const accept = (result: SettingsResult) => {
    set({ settings: fromV2(result.settings), failedEffects: result.failedEffects, saveError: null })
    window.dispatchEvent(new Event(PROFILE_MUTATED_EVENT))
  }
  const mutate = async (command: string, args?: Record<string, unknown>) => {
    set({ saveError: null })
    try {
      accept(await invoke<SettingsResult>(command, args))
    } catch (error) {
      set({ saveError: String(error) })
      throw error
    }
  }
  return {
    settings: null,
    isLoading: false,
    error: null,
    saveError: null,
    failedEffects: [],
    loadSettings: () =>
      serial(async () => {
        set({ isLoading: !get().settings, error: null })
        try {
          const [settings, failedEffects] = await Promise.all([
            invoke<V2Settings>('get_app_settings'),
            invoke<string[]>('get_settings_effects'),
          ])
          set({ settings: fromV2(settings), failedEffects, isLoading: false })
        } catch (error) {
          set({ error: String(error), isLoading: false })
        }
      }),
    updateSettings: updates =>
      serial(async () => {
        const current = get().settings
        if (!current) throw new Error('Settings not loaded')
        const patch = changedValues(toV2(current), toV2({ ...current, ...updates }))
        await mutate('update_app_settings', { settings: patch })
      }),
    resetSettings: () =>
      serial(async () => {
        await mutate('reset_app_settings')
        set({ error: null })
        window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
      }),
    retryEffects: () =>
      serial(async () => {
        await mutate('retry_settings_effects')
        window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
      }),
    exportSettings: () => serial(() => invoke<string>('export_portable_settings')),
    importSettings: document =>
      serial(async () => {
        await mutate('import_portable_settings', { document })
        window.dispatchEvent(new Event(SYNC_APPLIED_EVENT))
      }),
    getSettingsPath: () => Promise.resolve('ClipsX local profile'),
  }
})
