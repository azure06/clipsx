export type Platform = 'macos' | 'windows' | 'linux'
export type ShortcutModifier = 'primary' | 'secondary' | 'shift' | 'alt'

export type ShortcutDef = {
  modifiers: ShortcutModifier[]
  key: string
}

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string
  }
}

const MODIFIER_ORDER: ShortcutModifier[] = ['primary', 'secondary', 'alt', 'shift']
const MODIFIER_ONLY_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

const MAC_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  primary: '⌘',
  secondary: '⌃',
  alt: '⌥',
  shift: '⇧',
}

const TEXT_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  primary: 'Ctrl',
  secondary: 'Meta',
  alt: 'Alt',
  shift: 'Shift',
}

const SPECIAL_KEY_DISPLAY_LABELS: Record<string, Record<Platform, string>> = {
  Enter: {
    macos: '⏎',
    windows: 'Enter',
    linux: 'Enter',
  },
  Backspace: {
    macos: '⌫',
    windows: 'Backspace',
    linux: 'Backspace',
  },
  Delete: {
    macos: '⌦',
    windows: 'Del',
    linux: 'Del',
  },
  Space: {
    macos: 'Space',
    windows: 'Space',
    linux: 'Space',
  },
}

const ACCELERATOR_MODIFIER_LABELS: Record<Platform, Record<ShortcutModifier, string>> = {
  macos: {
    primary: 'Cmd',
    secondary: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
  },
  windows: {
    primary: 'Ctrl',
    secondary: 'Meta',
    alt: 'Alt',
    shift: 'Shift',
  },
  linux: {
    primary: 'Ctrl',
    secondary: 'Meta',
    alt: 'Alt',
    shift: 'Shift',
  },
}

const DEFAULT_GLOBAL_SHORTCUT_DEF: ShortcutDef = {
  modifiers: ['primary', 'shift'],
  key: 'V',
}

const MODIFIER_TOKEN_TO_MODIFIER: Record<string, ShortcutModifier | 'cmd_or_ctrl'> = {
  cmd: 'primary',
  command: 'primary',
  ctrl: 'primary',
  control: 'primary',
  meta: 'secondary',
  cmdorctrl: 'cmd_or_ctrl',
  commandorcontrol: 'cmd_or_ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
}

const uniqueModifiers = (modifiers: ShortcutModifier[]) =>
  MODIFIER_ORDER.filter(modifier => modifiers.includes(modifier))

const detectPlatformString = (): string => {
  if (typeof navigator === 'undefined') return ''
  const browserNavigator = navigator as NavigatorWithUserAgentData
  return (
    browserNavigator.userAgentData?.platform ||
    browserNavigator.platform ||
    browserNavigator.userAgent ||
    ''
  )
}

export const getPlatform = (platformLike = detectPlatformString()): Platform => {
  const normalized = platformLike.toLowerCase()

  if (normalized.includes('mac')) return 'macos'
  if (normalized.includes('win')) return 'windows'
  return 'linux'
}

export const normalizeShortcutKey = (key: string): string => {
  const trimmed = key.trim()
  if (trimmed === '') return ''

  const lower = trimmed.toLowerCase()

  if (lower === ' ') return 'Space'
  if (lower === 'spacebar') return 'Space'
  if (lower === 'esc') return 'Escape'
  if (lower === 'return') return 'Enter'
  if (lower === 'del') return 'Delete'
  if (lower === 'cmd') return 'Meta'
  if (lower === 'command') return 'Meta'
  if (lower === 'control') return 'Control'
  if (lower === 'option') return 'Alt'

  if (trimmed.length === 1) return trimmed.toUpperCase()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export const isModifierOnlyKey = (key: string): boolean =>
  MODIFIER_ONLY_KEYS.has(normalizeShortcutKey(key))

export const getDeleteShortcut = (platform = getPlatform()): ShortcutDef =>
  platform === 'macos'
    ? { modifiers: ['primary'], key: 'Backspace' }
    : { modifiers: [], key: 'Delete' }

export const getDefaultGlobalShortcutDef = (): ShortcutDef => ({
  modifiers: [...DEFAULT_GLOBAL_SHORTCUT_DEF.modifiers],
  key: DEFAULT_GLOBAL_SHORTCUT_DEF.key,
})

export const getShortcutChips = (
  shortcut: ShortcutDef | null | undefined,
  platform = getPlatform()
): string[] => {
  if (!shortcut) return []

  const modifiers = uniqueModifiers(shortcut.modifiers)
  const modifierLabels = modifiers.map(modifier =>
    platform === 'macos' ? MAC_MODIFIER_LABELS[modifier] : TEXT_MODIFIER_LABELS[modifier]
  )

  const key = normalizeShortcutKey(shortcut.key)
  if (!key) return modifierLabels

  const keyLabel = SPECIAL_KEY_DISPLAY_LABELS[key]?.[platform] || key
  return [...modifierLabels, keyLabel]
}

export const formatShortcut = (
  shortcut: ShortcutDef | null | undefined,
  platform = getPlatform()
): string => {
  const chips = getShortcutChips(shortcut, platform)
  if (chips.length === 0) return ''
  return platform === 'macos' ? chips.join('') : chips.join('+')
}

export const toAccelerator = (shortcut: ShortcutDef, platform = getPlatform()): string => {
  const modifiers = uniqueModifiers(shortcut.modifiers).map(
    modifier => ACCELERATOR_MODIFIER_LABELS[platform][modifier]
  )
  const key = normalizeShortcutKey(shortcut.key)

  return [...modifiers, key].filter(Boolean).join('+')
}

const isModifierActive = (
  event: ShortcutEvent,
  modifier: ShortcutModifier,
  platform = getPlatform()
): boolean => {
  switch (modifier) {
    case 'primary':
      return platform === 'macos' ? event.metaKey : event.ctrlKey
    case 'secondary':
      return platform === 'macos' ? event.ctrlKey : event.metaKey
    case 'alt':
      return event.altKey
    case 'shift':
      return event.shiftKey
  }
}

export const matchShortcut = (
  event: ShortcutEvent,
  shortcut: ShortcutDef,
  platform = getPlatform()
): boolean => {
  const expectedModifiers = new Set(uniqueModifiers(shortcut.modifiers))
  const actualKey = normalizeShortcutKey(event.key)
  const expectedKey = normalizeShortcutKey(shortcut.key)

  if (actualKey !== expectedKey) return false

  return MODIFIER_ORDER.every(modifier => {
    const isActive = isModifierActive(event, modifier, platform)
    return expectedModifiers.has(modifier) ? isActive : !isActive
  })
}

export const getShortcutFromKeyboardEvent = (
  event: ShortcutEvent,
  platform = getPlatform()
): ShortcutDef => {
  const modifiers = MODIFIER_ORDER.filter(modifier => isModifierActive(event, modifier, platform))
  const key = isModifierOnlyKey(event.key) ? '' : normalizeShortcutKey(event.key)

  return {
    modifiers,
    key,
  }
}

export const parseAccelerator = (
  accelerator: string,
  platform = getPlatform()
): ShortcutDef | null => {
  if (!accelerator.trim()) return null

  const parts = accelerator
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return null

  const modifiers: ShortcutModifier[] = []
  let key = ''

  for (const part of parts) {
    const normalizedPart = part.toLowerCase().replace(/\s+/g, '')
    const modifier = MODIFIER_TOKEN_TO_MODIFIER[normalizedPart]

    if (modifier === 'cmd_or_ctrl') {
      modifiers.push('primary')
      continue
    }

    if (modifier === 'primary') {
      modifiers.push(
        platform === 'macos' && normalizedPart.startsWith('ctrl') ? 'secondary' : 'primary'
      )
      continue
    }

    if (modifier === 'secondary') {
      modifiers.push('secondary')
      continue
    }

    if (modifier) {
      modifiers.push(modifier)
      continue
    }

    key = normalizeShortcutKey(part)
  }

  return {
    modifiers: uniqueModifiers(modifiers),
    key,
  }
}

export const getDefaultGlobalShortcut = (platform = getPlatform()): string =>
  toAccelerator(getDefaultGlobalShortcutDef(), platform)
