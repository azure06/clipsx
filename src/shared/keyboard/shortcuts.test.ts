import { describe, expect, it } from 'vitest'
import {
  formatShortcut,
  getDefaultGlobalShortcut,
  getDeleteShortcut,
  getShortcutChips,
  getShortcutFromKeyboardEvent,
  matchShortcut,
  parseAccelerator,
  toAccelerator,
  type ShortcutDef,
} from './shortcuts'

const copyShortcut: ShortcutDef = {
  modifiers: ['primary'],
  key: 'C',
}

describe('shortcut helpers', () => {
  it('formats primary shortcuts using native platform labels', () => {
    expect(formatShortcut(copyShortcut, 'macos')).toBe('⌘C')
    expect(formatShortcut(copyShortcut, 'windows')).toBe('Ctrl+C')
    expect(formatShortcut(copyShortcut, 'linux')).toBe('Ctrl+C')
  })

  it('formats delete shortcuts per platform', () => {
    expect(formatShortcut(getDeleteShortcut('macos'), 'macos')).toBe('⌘⌫')
    expect(formatShortcut(getDeleteShortcut('windows'), 'windows')).toBe('Del')
    expect(formatShortcut(getDeleteShortcut('linux'), 'linux')).toBe('Del')
  })

  it('matches delete shortcuts per platform', () => {
    expect(
      matchShortcut(
        { key: 'Backspace', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        getDeleteShortcut('macos'),
        'macos'
      )
    ).toBe(true)

    expect(
      matchShortcut(
        { key: 'Delete', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
        getDeleteShortcut('windows'),
        'windows'
      )
    ).toBe(true)

    expect(
      matchShortcut(
        { key: 'Delete', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        getDeleteShortcut('windows'),
        'windows'
      )
    ).toBe(false)
  })

  it('matches primary shortcuts on both macOS and Windows', () => {
    expect(
      matchShortcut(
        { key: 'c', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        copyShortcut,
        'macos'
      )
    ).toBe(true)

    expect(
      matchShortcut(
        { key: 'c', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        copyShortcut,
        'windows'
      )
    ).toBe(true)
  })

  it('parses accelerators into platform-aware chips for recorder display', () => {
    expect(getShortcutChips(parseAccelerator('Cmd+Shift+V', 'macos'), 'macos')).toEqual([
      '⌘',
      '⇧',
      'V',
    ])
    expect(getShortcutChips(parseAccelerator('Ctrl+Shift+V', 'windows'), 'windows')).toEqual([
      'Ctrl',
      'Shift',
      'V',
    ])
  })

  it('normalizes recorded shortcuts into accelerators', () => {
    expect(
      toAccelerator(
        getShortcutFromKeyboardEvent(
          {
            key: 'v',
            metaKey: true,
            ctrlKey: false,
            altKey: false,
            shiftKey: true,
          },
          'macos'
        ),
        'macos'
      )
    ).toBe('Cmd+Shift+V')

    expect(
      toAccelerator(
        getShortcutFromKeyboardEvent(
          {
            key: 'v',
            metaKey: false,
            ctrlKey: true,
            altKey: false,
            shiftKey: true,
          },
          'windows'
        ),
        'windows'
      )
    ).toBe('Ctrl+Shift+V')
  })

  it('returns platform-specific default global accelerators', () => {
    expect(getDefaultGlobalShortcut('macos')).toBe('Cmd+Shift+V')
    expect(getDefaultGlobalShortcut('windows')).toBe('Ctrl+Shift+V')
  })
})
