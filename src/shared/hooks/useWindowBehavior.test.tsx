import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWindowBehavior } from './useWindowBehavior'
import { useSettingsStore } from '../../stores'
import { DEFAULT_SETTINGS } from '../types'

const { hideMock, focusChangeHandlers } = vi.hoisted(() => ({
  hideMock: vi.fn().mockResolvedValue(undefined),
  focusChangeHandlers: [] as Array<(event: { payload: boolean }) => void>,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: hideMock,
    onFocusChanged: vi.fn((handler: (event: { payload: boolean }) => void) => {
      focusChangeHandlers.push(handler)
      return Promise.resolve(vi.fn())
    }),
  }),
}))

const HookHarness = () => {
  useWindowBehavior()
  return <div data-testid="window-behavior-hook" />
}

describe('useWindowBehavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    focusChangeHandlers.length = 0

    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isLoading: false,
      error: null,
      loadSettings: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      getSettingsPath: vi.fn(),
    })
  })

  it('hides on blur when hide_on_blur is enabled and always_on_top is off', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        hide_on_blur: true,
        always_on_top: false,
      },
    })

    render(<HookHarness />)

    await waitFor(() => {
      expect(focusChangeHandlers).toHaveLength(1)
    })

    document.dispatchEvent(new Event('mouseleave'))
    focusChangeHandlers[0]!({ payload: false })

    await waitFor(() => {
      expect(hideMock).toHaveBeenCalledTimes(1)
    })
  })

  it('does not hide on blur while always_on_top is enabled', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        hide_on_blur: true,
        always_on_top: true,
      },
    })

    render(<HookHarness />)

    await waitFor(() => {
      expect(focusChangeHandlers).toHaveLength(1)
    })

    document.dispatchEvent(new Event('mouseleave'))
    focusChangeHandlers[0]!({ payload: false })

    await waitFor(() => {
      expect(hideMock).not.toHaveBeenCalled()
    })
  })

  it('does not hide on blur when hide_on_blur is disabled', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        hide_on_blur: false,
        always_on_top: false,
      },
    })

    render(<HookHarness />)

    await waitFor(() => {
      expect(focusChangeHandlers).toHaveLength(1)
    })

    document.dispatchEvent(new Event('mouseleave'))
    focusChangeHandlers[0]!({ payload: false })

    await waitFor(() => {
      expect(hideMock).not.toHaveBeenCalled()
    })
  })
})
