import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Content } from './types'
import { CopyableRow } from './previews/PreviewShell'
import { MathPreview } from './previews/MathPreview'
import { useCopyDomainAction } from './actions/type-specific/URLActions'

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

const makeContent = (overrides: Partial<Content>): Content => ({
  type: 'text',
  text: 'sample',
  metadata: {},
  clip: { id: 'clip-1' } as Content['clip'],
  ...overrides,
})

describe('content copy routing', () => {
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

  it('CopyableRow routes preview copies through copy_to_clipboard', async () => {
    const user = userEvent.setup()

    render(<CopyableRow label="Domain" value="example.com" sourceClipId="clip-1" />)

    await user.click(screen.getByText('example.com'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
        text: 'example.com',
        plain: true,
        trackUsage: false,
      })
    })
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
  })

  it('MathPreview uses the backend copy flow for result copies', async () => {
    const user = userEvent.setup()

    render(
      <MathPreview
        content={makeContent({
          type: 'math',
          text: '2+2',
          metadata: {},
        })}
      />
    )

    await user.click(screen.getByRole('button', { name: /copy result/i }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
        text: '4',
        plain: true,
        trackUsage: false,
      })
    })
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
  })

  it('type-specific transformed actions use the derived copy helper', async () => {
    const action = useCopyDomainAction()

    await action.execute(
      makeContent({
        type: 'url',
        text: 'https://example.com/docs',
        metadata: {
          url: 'https://example.com/docs',
          domain: 'example.com',
        },
      })
    )

    expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', {
      text: 'example.com',
      plain: true,
      trackUsage: false,
    })
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
  })
})
