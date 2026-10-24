export type Size = { width: number; height: number }
export type Transform = { x: number; y: number; scale: number; fit: boolean }
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
export const emptyTransform: Transform = { x: 0, y: 0, scale: 1, fit: true }

export function fitTransform(content: Size, viewport: Size): Transform {
  if (!content.width || !content.height || !viewport.width || !viewport.height)
    return emptyTransform
  const scale = Math.min(1, viewport.width / content.width, viewport.height / content.height)
  return {
    scale,
    fit: true,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  }
}

export function boundTransform(value: Transform, content: Size, viewport: Size): Transform {
  const axis = (offset: number, size: number, available: number) => {
    if (size <= available) return (available - size) / 2
    return Math.min(0, Math.max(available - size, offset))
  }
  return {
    ...value,
    x: axis(value.x, content.width * value.scale, viewport.width),
    y: axis(value.y, content.height * value.scale, viewport.height),
  }
}

export function zoomTransform(
  value: Transform,
  scale: number,
  point: { x: number; y: number },
  content: Size,
  viewport: Size
): Transform {
  if (scale < value.scale && value.scale <= MIN_ZOOM) return value
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
  return boundTransform(
    {
      scale: next,
      fit: false,
      x: point.x - ((point.x - value.x) * next) / value.scale,
      y: point.y - ((point.y - value.y) * next) / value.scale,
    },
    content,
    viewport
  )
}

export function resizeTransform(
  value: Transform,
  content: Size,
  before: Size,
  after: Size
): Transform {
  return value.fit
    ? fitTransform(content, after)
    : boundTransform(
        {
          ...value,
          x: value.x + (after.width - before.width) / 2,
          y: value.y + (after.height - before.height) / 2,
        },
        content,
        after
      )
}

export function canPan(content: Size, viewport: Size, scale: number): boolean {
  return (
    content.width * scale > viewport.width + 0.5 || content.height * scale > viewport.height + 0.5
  )
}
