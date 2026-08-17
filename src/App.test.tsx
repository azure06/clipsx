import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { useSettingsStore } from './stores'
import i18n from './i18n'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

const v2Settings = (overrides: Record<string, unknown> = {}) => ({
  theme: 'system',
  language: 'en',
  languageInitialized: true,
  activationMode: 'double_click_primary',
  defaultOutputFormat: 'original',
  pasteOnEnter: false,
  hideOnCopy: false,
  hideOnBlur: false,
  alwaysOnTop: false,
  showCopyToast: true,
  globalShortcut: 'Ctrl+Shift+V',
  excludedApps: [],
  autoClearMinutes: null,
  clearOnExit: false,
  autoStart: false,
  captureFilters: { images: true, files: true, richText: true, officeAndDocuments: true },
  capture: {
    maxOrdinaryClips: 1000,
    maxAgeDays: null,
    maxRepresentationBytes: 52_428_800,
  },
  ...overrides,
})

vi.mock('./shared/hooks/useWindowBehavior', () => ({
  useWindowBehavior: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('./features/app/AppLayout', () => ({
  AppLayout: () => <div>Mock App Layout</div>,
}))

describe('App', () => {
  beforeEach(async () => {
    invokeMock.mockReset()
    invokeMock.mockImplementation((command: string, args?: { settings?: unknown }) => {
      if (command === 'get_startup_status') {
        return Promise.resolve({ state: 'ready', message: 'ready', resetAvailable: false })
      }
      if (command === 'get_app_settings') {
        return Promise.resolve(v2Settings())
      }
      if (command === 'update_app_settings') return Promise.resolve(args?.settings)
      return Promise.resolve(null)
    })
    useSettingsStore.setState({ settings: null, isLoading: false, error: null })
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: ['en-US'],
    })
    await i18n.changeLanguage('en')
  })

  it('renders the application shell after language bootstrap', async () => {
    render(<App />)
    expect(screen.queryByText('Mock App Layout')).not.toBeInTheDocument()
    expect(await screen.findByText('Mock App Layout')).toBeInTheDocument()
  })

  it('detects and persists Japanese only for a new installation', async () => {
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: ['ja-JP', 'en-US'],
    })
    invokeMock.mockImplementation((command: string, args?: { settings?: unknown }) => {
      if (command === 'get_startup_status') {
        return Promise.resolve({ state: 'ready', message: 'ready', resetAvailable: false })
      }
      if (command === 'get_app_settings') {
        return Promise.resolve(v2Settings({ languageInitialized: false }))
      }
      if (command === 'update_app_settings') return Promise.resolve(args?.settings)
      return Promise.resolve(null)
    })

    render(<App />)
    expect(await screen.findByText('Mock App Layout')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ja')
    expect(invokeMock).toHaveBeenCalledWith('update_app_settings', {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      settings: expect.objectContaining({ language: 'ja', languageInitialized: true }),
    })
    expect(invokeMock).toHaveBeenCalledWith('set_tray_labels', {
      labels: { open: 'Clipsを開く', settings: '設定', quit: '終了' },
    })
  })

  it('normalizes an unsupported saved language to English and persists it', async () => {
    invokeMock.mockImplementation((command: string, args?: { settings?: unknown }) => {
      if (command === 'get_startup_status') {
        return Promise.resolve({ state: 'ready', message: 'ready', resetAvailable: false })
      }
      if (command === 'get_app_settings') {
        return Promise.resolve(v2Settings({ language: 'de' }))
      }
      if (command === 'update_app_settings') return Promise.resolve(args?.settings)
      return Promise.resolve(null)
    })

    render(<App />)
    expect(await screen.findByText('Mock App Layout')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(invokeMock).toHaveBeenCalledWith('update_app_settings', {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      settings: expect.objectContaining({ language: 'en', languageInitialized: true }),
    })
  })

  it('applies a saved language change to the document and tray immediately', async () => {
    render(<App />)
    expect(await screen.findByText('Mock App Layout')).toBeInTheDocument()

    act(() => {
      useSettingsStore.setState(state => ({
        settings: state.settings ? { ...state.settings, language: 'ja' } : null,
      }))
    })

    await waitFor(() => expect(document.documentElement.lang).toBe('ja'))
    expect(document.documentElement.dir).toBe('ltr')
    expect(invokeMock).toHaveBeenCalledWith('set_tray_labels', {
      labels: { open: 'Clipsを開く', settings: '設定', quit: '終了' },
    })
  })

  it('shows a reset gate without loading normal application state for a legacy database', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_startup_status') {
        return Promise.resolve({
          state: 'legacy_reset_required',
          message: 'Factory reset is required.',
          resetAvailable: true,
        })
      }
      return Promise.resolve(null)
    })

    render(<App />)

    expect(await screen.findByText('A factory reset is required')).toBeInTheDocument()
    expect(screen.queryByText('Mock App Layout')).not.toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalledWith('get_app_settings')
  })
})
