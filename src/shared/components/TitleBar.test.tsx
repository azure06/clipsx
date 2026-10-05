import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { getPlatform, type Platform } from '../keyboard/shortcuts'
import { TitleBar } from './TitleBar'

const { appWindow, invokeMock, resizeHandler, stopListening } = vi.hoisted(() => ({
  appWindow: {
    isMaximized: vi.fn(),
    onResized: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    setFocus: vi.fn(),
  },
  invokeMock: vi.fn(),
  resizeHandler: { current: undefined as (() => void) | undefined },
  stopListening: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => appWindow }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../keyboard/shortcuts', () => ({ getPlatform: vi.fn() }))
vi.mock('../../stores', () => ({
  useUIStore: (select: (state: { activeView: string }) => unknown) =>
    select({ activeView: 'clips' }),
  useClipboardStore: (select: (state: { clips: unknown[] }) => unknown) => select({ clips: [] }),
}))

async function renderTitleBar(platform: Platform) {
  vi.mocked(getPlatform).mockReturnValue(platform)
  await act(async () => {
    render(<TitleBar />)
    await Promise.resolve()
  })
}

type ControlName = 'minimize' | 'maximizeWindow' | 'restoreWindow' | 'close'
const control = (key: ControlName) =>
  screen.getByRole('button', { name: i18n.t(`desktopUi.${key}`) })

describe('TitleBar platform controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    appWindow.isMaximized.mockResolvedValue(false)
    appWindow.setFocus.mockResolvedValue(undefined)
    invokeMock.mockResolvedValue(undefined)
    appWindow.onResized.mockImplementation((handler: () => void) => {
      resizeHandler.current = handler
      return Promise.resolve(stopListening)
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('provides Linux controls with portable icons and no Windows Snap invocation', async () => {
    await renderTitleBar('linux')
    const buttons = (['minimize', 'maximizeWindow', 'close'] as const).map(control)
    for (const button of buttons) {
      expect(button.querySelector('svg')).toBeInTheDocument()
      expect(button.style.fontFamily).toBe('')
      expect(button).not.toHaveAttribute('data-tauri-drag-region')
      fireEvent.click(button)
    }
    expect(appWindow.minimize).toHaveBeenCalledOnce()
    expect(appWindow.toggleMaximize).toHaveBeenCalledOnce()
    expect(appWindow.close).toHaveBeenCalledOnce()

    fireEvent.mouseEnter(control('maximizeWindow'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(appWindow.setFocus).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('updates the Linux restore control when the native window is maximized', async () => {
    await renderTitleBar('linux')
    appWindow.isMaximized.mockResolvedValue(true)
    await act(async () => {
      resizeHandler.current?.()
      await Promise.resolve()
    })
    expect(screen.queryByRole('button', { name: i18n.t('desktopUi.maximizeWindow') })).toBeNull()
    fireEvent.click(control('restoreWindow'))
    expect(appWindow.toggleMaximize).toHaveBeenCalledOnce()

    await act(async () => {
      cleanup()
      await Promise.resolve()
    })
    expect(stopListening).toHaveBeenCalledOnce()
  })

  it('preserves Windows glyphs and the delayed Snap overlay', async () => {
    await renderTitleBar('windows')
    expect(control('minimize')).toHaveTextContent('\uE921')
    expect(control('close')).toHaveTextContent('\uE8BB')
    fireEvent.mouseEnter(control('maximizeWindow'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(619)
    })
    expect(invokeMock).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(invokeMock).toHaveBeenCalledWith('plugin:decorum|show_snap_overlay')
  })

  it('leaves macOS controls to the native titlebar', async () => {
    await renderTitleBar('macos')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(appWindow.isMaximized).not.toHaveBeenCalled()
    expect(appWindow.onResized).not.toHaveBeenCalled()
  })
})
