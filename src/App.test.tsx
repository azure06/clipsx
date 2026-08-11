import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { useSettingsStore } from './stores'
import i18n from './i18n'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

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
      if (command === 'get_settings') {
        return Promise.resolve({ language: 'en', language_initialized: true })
      }
      if (command === 'update_settings') return Promise.resolve(args?.settings)
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
      if (command === 'get_settings') {
        return Promise.resolve({ language: 'en', language_initialized: false })
      }
      if (command === 'update_settings') return Promise.resolve(args?.settings)
      return Promise.resolve(null)
    })

    render(<App />)
    expect(await screen.findByText('Mock App Layout')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ja')
    expect(invokeMock).toHaveBeenCalledWith('update_settings', {
      settings: { language: 'ja', language_initialized: true },
    })
    expect(invokeMock).toHaveBeenCalledWith('set_tray_labels', {
      labels: { open: 'Clipsを開く', settings: '設定', quit: '終了' },
    })
  })

  it('normalizes an unsupported saved language to English and persists it', async () => {
    invokeMock.mockImplementation((command: string, args?: { settings?: unknown }) => {
      if (command === 'get_settings') {
        return Promise.resolve({ language: 'de', language_initialized: true })
      }
      if (command === 'update_settings') return Promise.resolve(args?.settings)
      return Promise.resolve(null)
    })

    render(<App />)
    expect(await screen.findByText('Mock App Layout')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(invokeMock).toHaveBeenCalledWith('update_settings', {
      settings: { language: 'en', language_initialized: true },
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
})
