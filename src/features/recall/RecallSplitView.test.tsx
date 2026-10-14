import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RecallSplitView } from './RecallSplitView'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('keeps context inline, resizes with the keyboard, and preserves chat across layout changes', () => {
  let width = 1000
  let resize = () => {}
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    width,
    height: 700,
    top: 0,
    left: 0,
    right: width,
    bottom: 700,
    toJSON: () => ({}),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  const view = (open: boolean) => (
    <RecallSplitView open={open}>
      <textarea aria-label="Chat" />
      <aside>Context</aside>
    </RecallSplitView>
  )
  const mounted = render(view(true))
  const chat = screen.getByRole('textbox')
  const divider = screen.getByRole('separator')
  expect(divider).toHaveAttribute('aria-orientation', 'vertical')
  fireEvent.keyDown(divider, { key: 'ArrowLeft' })
  expect(divider).toHaveAttribute('aria-valuenow', '42')
  act(() => {
    width = 420
    resize()
  })
  expect(divider).toHaveAttribute('aria-orientation', 'horizontal')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.keyDown(divider, { key: 'End' })
  expect(divider).toHaveAttribute('aria-valuenow', '65')
  fireEvent.doubleClick(divider)
  expect(divider).toHaveAttribute('aria-valuenow', '40')
  mounted.rerender(view(false))
  expect(screen.getByRole('textbox')).toBe(chat)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
})
