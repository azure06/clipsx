import { describe, expect, it, vi } from 'vitest'
import { attachTrackpadGestures } from './trackpadGestures'
import { fitTransform, type Transform } from './viewportGeometry'
function gesture(type: string, scale: number, coordinates = true) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperty(event, 'scale', { value: scale })
  if (coordinates)
    Object.defineProperties(event, { clientX: { value: 200 }, clientY: { value: 200 } })
  return event
}
function setup() {
  const element = document.createElement('div')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 400,
    left: 0,
    top: 0,
  } as DOMRect)
  const content = { width: 1600, height: 800 },
    viewport = { width: 400, height: 400 }
  let value: Transform = fitTransform(content, viewport)
  const update = vi.fn((next: Transform) => {
      value = next
    }),
    cancel = vi.fn()
  const controller = attachTrackpadGestures(
    element,
    () => value,
    update,
    content,
    () => viewport,
    cancel
  )
  return { element, value: () => value, update, cancel, controller }
}
describe('native trackpad gestures', () => {
  it('uses cumulative WebKit scales, anchors the content, and needs no modifier', () => {
    const state = setup(),
      start = gesture('gesturestart', 1)
    state.element.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(true)
    expect(state.cancel).toHaveBeenCalledOnce()
    state.element.dispatchEvent(gesture('gesturechange', 1.5))
    expect(state.value().scale).toBe(0.375)
    state.element.dispatchEvent(gesture('gesturechange', 2))
    expect(state.value()).toEqual({ scale: 0.5, fit: false, x: -200, y: 0 })
    const end = gesture('gestureend', 2)
    state.element.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(true)
    expect(state.controller.active()).toBe(false)
    state.element.dispatchEvent(gesture('gesturestart', 1))
    state.element.dispatchEvent(gesture('gesturechange', 0.5))
    expect(state.value().scale).toBe(0.25)
    state.controller.dispose()
  })
  it('supports center fallback, clamps zoom, and ignores invalid or detached events', () => {
    const state = setup()
    state.element.dispatchEvent(gesture('gesturechange', 2))
    expect(state.update).not.toHaveBeenCalled()
    state.element.dispatchEvent(gesture('gesturestart', Number.NaN))
    expect(state.controller.active()).toBe(false)
    state.element.dispatchEvent(gesture('gesturestart', 1, false))
    state.element.dispatchEvent(gesture('gesturechange', 100, false))
    expect(state.value().scale).toBe(8)
    state.element.dispatchEvent(gesture('gesturechange', 0))
    expect(state.value().scale).toBe(8)
    state.controller.dispose()
    state.element.dispatchEvent(gesture('gesturechange', 2))
    expect(state.update).toHaveBeenCalledOnce()
  })
  it('releases duplicate-wheel suppression when the window loses focus', () => {
    const state = setup()
    state.element.dispatchEvent(gesture('gesturestart', 1))
    expect(state.controller.active()).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(state.controller.active()).toBe(false)
    state.controller.dispose()
  })
})
