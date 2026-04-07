export type Theme = 'light' | 'dark' | 'auto'
export type ViewMode = 'list' | 'grid'
export type PasteFormat = 'auto' | 'plain'

export interface AppSettings {
  // General
  theme: Theme
  language: string

  // Shortcuts
  global_shortcut: string

  // Clipboard monitoring
  enable_images: boolean
  enable_files: boolean
  enable_rich_text: boolean
  enable_office_formats: boolean
  excluded_apps: string[]

  // Storage & History
  max_clips: number
  max_age_days: number
  max_item_size_mb: number

  // Privacy & Behavior
  auto_clear_minutes: number
  hide_on_copy: boolean
  clear_on_exit: boolean
  auto_start: boolean

  // Paste behavior
  default_paste_format: PasteFormat
  auto_close_after_paste: boolean
  paste_on_enter: boolean
  hide_on_blur: boolean
  always_on_top: boolean

  // Notifications
  show_copy_toast: boolean

  // Onboarding
  has_seen_welcome: boolean

  // Plugins
  semantic_search_enabled: boolean
  semantic_model: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  language: 'en',
  global_shortcut: 'Cmd+Shift+V',
  enable_images: true,
  enable_files: true,
  enable_rich_text: true,
  enable_office_formats: true,
  excluded_apps: [],
  max_clips: 1000,
  max_age_days: 0,
  max_item_size_mb: 10,
  auto_clear_minutes: 0,
  hide_on_copy: false,
  clear_on_exit: false,
  auto_start: false,
  default_paste_format: 'auto',
  auto_close_after_paste: true,
  paste_on_enter: true,
  hide_on_blur: true,
  always_on_top: false,
  show_copy_toast: true,
  has_seen_welcome: false,
  semantic_search_enabled: false,
  semantic_model: 'all-MiniLM-L6-v2',
}
