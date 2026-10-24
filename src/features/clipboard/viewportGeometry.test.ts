import { describe, expect, it } from 'vitest'
import {
  canPan,
  fitTransform,
  boundTransform,
  zoomTransform,
  resizeTransform,
} from './viewportGeometry'
describe('visual viewport geometry', () => {
  it('allows panning only for actual overflow, including one-axis overflow', () => {
    const viewport = { width: 400, height: 400 }
    expect(canPan({ width: 200, height: 100 }, viewport, 1)).toBe(false)
    expect(canPan({ width: 400, height: 400 }, viewport, 1)).toBe(false)
    expect(canPan({ width: 400.1, height: 400.1 }, viewport, 1)).toBe(false)
    expect(canPan({ width: 800, height: 100 }, viewport, 1)).toBe(true)
    expect(canPan({ width: 100, height: 800 }, viewport, 1)).toBe(true)
  })

  it('fits both dimensions, never enlarges small content, and supports tiny fit scales', () => {
    expect(fitTransform({ width: 200, height: 100 }, { width: 400, height: 400 })).toEqual({
      x: 100,
      y: 150,
      scale: 1,
      fit: true,
    })
    expect(fitTransform({ width: 10000, height: 20000 }, { width: 400, height: 400 }).scale).toBe(
      0.02
    )
  })
  it('does not turn zoom-out into zoom-in below the manual minimum', () => {
    const content = { width: 20000, height: 20000 },
      viewport = { width: 400, height: 400 }
    const fit = fitTransform(content, viewport)
    expect(zoomTransform(fit, fit.scale / 1.25, { x: 200, y: 200 }, content, viewport)).toEqual(fit)
  })
  it('keeps the content point under the pointer when leaving fit mode', () => {
    const content = { width: 2000, height: 1000 },
      viewport = { width: 500, height: 500 }
    const fit = fitTransform(content, viewport),
      point = { x: 150, y: 250 }
    const result = zoomTransform(fit, 0.5, point, content, viewport)
    expect((point.x - result.x) / result.scale).toBe((point.x - fit.x) / fit.scale)
    expect((point.y - result.y) / result.scale).toBe((point.y - fit.y) / fit.scale)
    expect(result.fit).toBe(false)
    expect(zoomTransform(fit, 100, point, content, viewport).scale).toBe(8)
    expect(zoomTransform(fit, 0.001, point, content, viewport).scale).toBe(0.1)
  })
  it('bounds dragging and keeps the center point on manual resize', () => {
    const content = { width: 2000, height: 2000 },
      before = { width: 400, height: 400 },
      after = { width: 800, height: 600 }
    const manual = { x: -400, y: -500, scale: 1, fit: false }
    expect(resizeTransform(manual, content, before, after)).toEqual({ ...manual, x: -200, y: -400 })
    expect(resizeTransform({ ...manual, fit: true }, content, before, after)).toEqual(
      fitTransform(content, after)
    )
    expect(boundTransform({ ...manual, x: 10000, y: -10000 }, content, before)).toEqual({
      ...manual,
      x: 0,
      y: -1600,
    })
  })
})
