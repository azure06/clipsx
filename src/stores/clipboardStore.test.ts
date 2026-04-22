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

describe('useClipboardStore.mergeClipUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useClipboardStore.setState({
      clips: [
        {
          id: 'clip-1',
          contentType: 'text',
          detectedType: 'text',
          contentText: 'hello',
          contentHtml: null,
          contentRtf: null,
          svgPath: null,
          pdfPath: null,
          imagePath: null,
          attachmentPath: null,
          attachmentType: null,
          filePaths: null,
          metadata: null,
          note: 'keep me',
          createdAt: 1,
          updatedAt: 1,
          appName: null,
          isPinned: false,
          isFavorite: false,
          accessCount: 0,
          contentHash: null,
          hasEmbedding: false,
          tags: [{ id: 1, name: 'saved', color: '#fff', createdAt: 1 }],
        },
      ],
    })
  })

  it('updates existing clip state without dropping local tags or note', () => {
    useClipboardStore.getState().mergeClipUpdate({
      id: 'clip-1',
      contentType: 'text',
      detectedType: 'text',
      contentText: 'hello',
      contentHtml: null,
      contentRtf: null,
      svgPath: null,
      pdfPath: null,
      imagePath: null,
      attachmentPath: null,
      attachmentType: null,
      filePaths: null,
      metadata: null,
      note: null,
      createdAt: 1,
      updatedAt: 2,
      appName: null,
      isPinned: false,
      isFavorite: false,
      accessCount: 0,
      contentHash: null,
      hasEmbedding: true,
    })

    expect(useClipboardStore.getState().clips[0]).toMatchObject({
      id: 'clip-1',
      hasEmbedding: true,
      note: 'keep me',
      tags: [{ id: 1, name: 'saved', color: '#fff', createdAt: 1 }],
    })
  })
})
