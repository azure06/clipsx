export type Theme = 'light' | 'dark' | 'auto'
export type ViewMode = 'list' | 'grid'
export type RetentionPolicy = 'unlimited' | 'days' | 'count'
export type PasteFormat = 'auto' | 'plain' | 'html' | 'markdown'

export interface AppSettings {
  // General
  theme: Theme
  view_mode: ViewMode
  language: string

  // Shortcuts
  global_shortcut: string

  // Clipboard monitoring
  enable_images: boolean
  enable_files: boolean
  enable_rich_text: boolean
  excluded_apps: string[]

  // Storage & History
  history_limit: number
  retention_policy: RetentionPolicy
  retention_value: number
  auto_delete_days: number
  max_image_size_mb: number

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
  toast_duration_ms: number
}

export const DEFAULT_SETTINGS: AppSettings = {
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
  paste_on_enter: true,
  hide_on_blur: true,
  always_on_top: false,
  show_copy_toast: true,
  toast_duration_ms: 1500,
}
