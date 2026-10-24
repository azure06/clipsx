import { afterEach, describe, expect, it } from 'vitest'
import { guardPageZoom, guardPreviewFrameZoom } from './previewPageZoom'
let dispose = () => {}
afterEach(() => {
  dispose()
  dispose = () => {}
})
function wheel(ctrlKey = false, metaKey = false) {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, deltaY: 30 })
  Object.defineProperties(event, { ctrlKey: { value: ctrlKey }, metaKey: { value: metaKey } })
  return event
}
describe('host page zoom guard', () => {
  it('blocks page scaling on a non-image clip without blocking ordinary scrolling', () => {
    dispose = guardPageZoom(window)
    const pinch = wheel(true)
    window.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    const metaPinch = wheel(false, true)
    window.dispatchEvent(metaPinch)
    expect(metaPinch.defaultPrevented).toBe(true)
    const scroll = wheel()
    window.dispatchEvent(scroll)
    expect(scroll.defaultPrevented).toBe(false)
  })
  it('delivers a cancelled pinch to the image canvas and releases listeners on cleanup', () => {
    dispose = guardPageZoom(window)
    const canvas = document.createElement('div')
    document.body.append(canvas)
    let received = false
    canvas.addEventListener('wheel', () => {
      received = true
    })
    const pinch = wheel(true)
    canvas.dispatchEvent(pinch)
    expect(received).toBe(true)
    expect(pinch.defaultPrevented).toBe(true)
    canvas.remove()
    dispose()
    const after = wheel(true)
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
  it('blocks native WebKit page magnification too', () => {
    dispose = guardPageZoom(window)
    for (const name of ['gesturestart', 'gesturechange']) {
      const gesture = new Event(name, { cancelable: true })
      window.dispatchEvent(gesture)
      expect(gesture.defaultPrevented).toBe(true)
    }
  })
  it('guards a sandboxed same-origin HTML frame without enabling its scripts', () => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin')
    document.body.append(frame)
    guardPreviewFrameZoom(frame)
    const pinch = wheel(true)
    frame.contentWindow!.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    frame.remove()
  })
})
