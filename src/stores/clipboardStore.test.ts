import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipboardStore } from './clipboardStore'

const { mockInvoke, mockHide } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockHide: vi.fn(),
}))

let clipboardWriteTextMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: mockHide,
  }),
}))

describe('useClipboardStore.copyDerivedText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clipboardWriteTextMock = vi.fn()

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    })
  })

  it('routes derived copies through the backend plain-text copy command without hiding the window', async () => {
    await useClipboardStore.getState().copyDerivedText('example.com', 'clip-1')

    expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
      text: 'example.com',
      id: 'clip-1',
      plain: true,
    })
    expect(mockHide).not.toHaveBeenCalled()
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
  })
})
