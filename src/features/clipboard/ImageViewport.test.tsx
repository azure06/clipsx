import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { ImageViewport } from './ImageViewport'
import i18n from '../../i18n'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const model = {
  kind: 'image' as const,
  source: { kind: 'managed' as const, assetId: 'asset-one' },
  ocr: { state: 'disabled' as const },
}
function load() {
  const image = screen.getByRole('img')
  Object.defineProperties(image, { naturalWidth: { value: 1600 }, naturalHeight: { value: 800 } })
  fireEvent.load(image)
  return image
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 400,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 400,
    toJSON: () => ({}),
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(invoke).mockReset()
  void i18n.changeLanguage('en')
})
describe('image viewport', () => {
  it('fits, zooms with local keyboard commands, and preserves the mounted image through expansion', async () => {
    render(<ImageViewport model={model} clipId="clip-one" />)
    const image = load()
    await screen.findByText('25%')
    fireEvent.keyDown(screen.getByRole('region'), { key: '1' })
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
    const before = image.style.transform
    fireEvent.click(screen.getByRole('button', { name: 'Expand preview' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('img')).toBe(image)
    expect(image.style.transform).toBe(before)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('img')).toBe(image)
    expect(screen.getByRole('button', { name: 'Expand preview' })).toHaveFocus()
  })
  it('uses the normal cursor when fitted and a grab cursor only when content can pan', async () => {
    render(<ImageViewport model={model} clipId="clip-one" />)
    const canvas = screen.getByRole('region')
    expect(canvas).toHaveClass('cursor-default')
    load()
    await screen.findByText('25%')
    expect(canvas).toHaveClass('cursor-default')
    fireEvent.click(screen.getByRole('button', { name: 'Actual size (100%)' }))
    expect(canvas).toHaveClass('cursor-grab')
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }))
    expect(canvas).toHaveClass('cursor-default')
  })
  it('keeps automatic fit after arrow keys when there is nothing to pan', async () => {
    render(<ImageViewport model={model} clipId="clip-one" />)
    load()
    await screen.findByText('25%')
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...screen.getByRole('region').getBoundingClientRect(),
      width: 800,
      height: 800,
    })
    fireEvent(window, new Event('resize'))
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
  })
  it('opens an owned image identity and reports a failed launch with retry available', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('image_launch_failed').mockResolvedValueOnce(undefined)
    render(<ImageViewport model={model} clipId="clip-one" />)
    load()
    const open = screen.getByRole('button', { name: 'Open externally' })
    fireEvent.click(open)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the image')
    expect(invoke).toHaveBeenCalledWith('open_clip_image_externally', {
      clipId: 'clip-one',
      source: model.source,
    })
    fireEvent.click(open)
    await waitFor(() => expect(screen.getByText(/Opened a separate copy/)).toBeInTheDocument())
  })
  it('zooms only with a modifier and leaves ordinary document scrolling alone while fitted', async () => {
    render(<ImageViewport model={model} clipId="clip-one" />)
    load()
    await screen.findByText('25%')
    const canvas = screen.getByRole('region')
    const ordinary = new WheelEvent('wheel', { deltaY: 50, cancelable: true, bubbles: true })
    fireEvent(canvas, ordinary)
    expect(ordinary.defaultPrevented).toBe(false)
    const zoom = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -100,
      clientX: 200,
      clientY: 200,
      cancelable: true,
      bubbles: true,
    })
    Object.defineProperty(zoom, 'ctrlKey', { value: true })
    fireEvent(canvas, zoom)
    expect(zoom.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('Zoom level')).not.toHaveTextContent('25%')
  })
  it('handles native trackpad pinch without Ctrl and suppresses duplicate wheel zoom', async () => {
    render(<ImageViewport model={model} clipId="clip-one" />)
    load()
    await screen.findByText('25%')
    const canvas = screen.getByRole('region')
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { cancelable: true })
      Object.defineProperty(event, 'scale', { value: scale })
      fireEvent(canvas, event)
      expect(event.defaultPrevented).toBe(true)
    }
    gesture('gesturestart', 1)
    gesture('gesturechange', 2)
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
    const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true })
    Object.defineProperty(wheel, 'ctrlKey', { value: true })
    fireEvent(canvas, wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
    gesture('gestureend', 2)
    const nextWheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true })
    Object.defineProperty(nextWheel, 'ctrlKey', { value: true })
    fireEvent(canvas, nextWheel)
    expect(screen.getByLabelText('Zoom level')).not.toHaveTextContent('50%')
  })
  it('keeps failure controls disabled and changes labels with the locale', async () => {
    render(<ImageViewport model={model} clipId="clip-one" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('button', { name: 'Open externally' })).toBeDisabled()
    expect(screen.getByText('No image source found')).toBeInTheDocument()
    await act(() => i18n.changeLanguage('ja'))
    expect(screen.getByRole('button', { name: '外部アプリで開く' })).toBeDisabled()
  })
})
