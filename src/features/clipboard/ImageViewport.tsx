import { attachTrackpadGestures } from './trackpadGestures'
import { invoke } from '@tauri-apps/api/core'
import { ImageOff, Minus, Plus, Scan, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RenderModel } from '../../shared/types/v2'
import { Button } from '../../shared/components/ui/Button'
import { managedAssetUrl, artifactFileUrl } from '../../shared/utils/assetUrl'
import { ExpandablePreview } from './ExpandablePreview'
import {
  boundTransform,
  canPan,
  emptyTransform,
  fitTransform,
  MAX_ZOOM,
  MIN_ZOOM,
  resizeTransform,
  zoomTransform,
  type Size,
  type Transform,
} from './viewportGeometry'

type ImageModel = Extract<RenderModel, { kind: 'image' }>
export function ImageViewport({ model, clipId }: { model: ImageModel; clipId: string }) {
  const { t } = useTranslation()
  return (
    <ExpandablePreview title={t('preview.navigation.image')}>
      {expand => <ImageCanvas model={model} clipId={clipId} expand={expand} />}
    </ExpandablePreview>
  )
}

function ImageCanvas({
  model,
  clipId,
  expand,
}: {
  model: ImageModel
  clipId: string
  expand: ReactNode
}) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Size>({ width: 0, height: 0 })
  const previousViewport = useRef<Size>({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [transform, setTransform] = useState<Transform>(emptyTransform)
  const current = useRef(transform)
  useEffect(() => {
    current.current = transform
  }, [transform])
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [dragging, setDragging] = useState(false)
  const [failed, setFailed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openState, setOpenState] = useState<'done' | 'error' | null>(null)
  const sourceUrl =
    model.source.kind === 'managed'
      ? managedAssetUrl(model.source.assetId)
      : artifactFileUrl(model.source.fileId)
  const loaded = content.width > 0 && !failed
  const pannable = loaded && canPan(content, viewport, transform.scale)
  const center = () => ({ x: viewport.width / 2, y: viewport.height / 2 })
  const zoom = (scale: number, point = center()) =>
    setTransform(value => zoomTransform(value, scale, point, content, viewport))
  const pan = (x: number, y: number) => {
    if (!pannable) return
    setTransform(value =>
      boundTransform({ ...value, fit: false, x: value.x + x, y: value.y + y }, content, viewport)
    )
  }
  const fit = () => setTransform(fitTransform(content, viewport))
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const resize = () => {
      const rect = element.getBoundingClientRect()
      const after = { width: rect.width, height: rect.height }
      const before = previousViewport.current
      previousViewport.current = after
      setViewport(after)
      setTransform(value => resizeTransform(value, content, before, after))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    window.addEventListener('resize', resize)
    resize()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [content])
  useEffect(() => {
    const element = canvas.current
    if (!element || !loaded) return
    const gestures = attachTrackpadGestures(
      element,
      () => current.current,
      setTransform,
      content,
      () => previousViewport.current,
      () => {
        pointers.current.clear()
        setDragging(false)
      }
    )
    const wheel = (event: WheelEvent) => {
      if (gestures.active()) {
        event.preventDefault()
        return
      }
      const value = current.current
      const rect = element.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        setTransform(
          zoomTransform(
            value,
            value.scale * Math.exp(-event.deltaY * 0.005),
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            content,
            viewport
          )
        )
      } else if (
        content.width * value.scale > rect.width ||
        content.height * value.scale > rect.height
      ) {
        event.preventDefault()
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
        setTransform(
          boundTransform(
            {
              ...value,
              fit: false,
              x: value.x - event.deltaX * unit,
              y: value.y - event.deltaY * unit,
            },
            content,
            viewport
          )
        )
      }
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', wheel)
      gestures.dispose()
    }
  }, [content, loaded, viewport])
  const open = async () => {
    setOpening(true)
    setOpenState(null)
    try {
      await invoke('open_clip_image_externally', { clipId, source: model.source })
      setOpenState('done')
    } catch {
      setOpenState('error')
    } finally {
      setOpening(false)
    }
  }
  const tool = (label: string, action: () => void, child: ReactNode, disabled = !loaded) => (
    <Button
      variant="ghost"
      size="sm"
      className="px-2"
      title={label}
      aria-label={label}
      onClick={action}
      disabled={disabled}
    >
      {child}
    </Button>
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/40 dark:bg-black/20">
      <div
        role="group"
        aria-label={t('preview.navigation.controls')}
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200/70 px-2 py-1.5 dark:border-white/10"
      >
        {tool(
          t('preview.navigation.zoomOut'),
          () => zoom(transform.scale / 1.25),
          <Minus className="h-4 w-4" />,
          !loaded || transform.scale <= MIN_ZOOM
        )}
        <output
          aria-label={t('preview.navigation.zoom')}
          className="min-w-12 text-center text-xs tabular-nums text-slate-600 dark:text-slate-300"
        >
          {loaded ? `${Math.round(transform.scale * 1000) / 10}%` : '—'}
        </output>
        {tool(
          t('preview.navigation.zoomIn'),
          () => zoom(transform.scale * 1.25),
          <Plus className="h-4 w-4" />,
          !loaded || transform.scale >= MAX_ZOOM
        )}
        {tool(
          t('preview.navigation.fit'),
          fit,
          <>
            <Scan className="h-4 w-4" />
            <span>{t('preview.navigation.fit')}</span>
          </>
        )}
        {tool(t('preview.navigation.actualSize'), () => zoom(1), '100%')}
        {expand}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto px-2"
          disabled={!loaded}
          isLoading={opening}
          title={t('preview.navigation.openHelp')}
          aria-label={t('preview.navigation.open')}
          onClick={() => void open()}
        >
          <ExternalLink className="h-4 w-4" />
          <span>{t('preview.navigation.open')}</span>
        </Button>
      </div>
      {openState && (
        <p
          role={openState === 'error' ? 'alert' : 'status'}
          className="px-3 py-1 text-xs text-slate-600 dark:text-slate-300"
        >
          {t(openState === 'error' ? 'preview.navigation.openFailed' : 'preview.navigation.opened')}
        </p>
      )}
      <div
        ref={canvas}
        tabIndex={0}
        role="region"
        aria-label={t('preview.navigation.canvas')}
        aria-busy={!loaded && !failed}
        className={`relative min-h-0 flex-1 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${pannable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
        style={{ touchAction: 'none' }}
        onKeyDown={event => {
          if (
            event.target !== event.currentTarget ||
            !loaded ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return
          const actions: Record<string, () => void> = {
            '+': () => zoom(transform.scale * 1.25),
            '=': () => zoom(transform.scale * 1.25),
            '-': () => zoom(transform.scale / 1.25),
            '0': fit,
            '1': () => zoom(1),
            ArrowLeft: () => pan(40, 0),
            ArrowRight: () => pan(-40, 0),
            ArrowUp: () => pan(0, 40),
            ArrowDown: () => pan(0, -40),
          }
          const action = actions[event.key]
          if (action) {
            event.preventDefault()
            event.stopPropagation()
            action()
          }
        }}
        onPointerDown={event => {
          if (!loaded || event.button !== 0 || (!pannable && event.pointerType !== 'touch')) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          setDragging(true)
        }}
        onPointerMove={event => {
          const previous = pointers.current.get(event.pointerId)
          if (!previous) return
          const next = { x: event.clientX, y: event.clientY }
          const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
          pointers.current.set(event.pointerId, next)
          if (other) {
            const distance = Math.hypot(previous.x - other.x, previous.y - other.y)
            if (distance < 1) return
            const ratio = Math.hypot(next.x - other.x, next.y - other.y) / distance
            const rect = event.currentTarget.getBoundingClientRect()
            const origin = {
              x: (previous.x + other.x) / 2 - rect.left,
              y: (previous.y + other.y) / 2 - rect.top,
            }
            setTransform(value => {
              const result = zoomTransform(value, value.scale * ratio, origin, content, viewport)
              return boundTransform(
                {
                  ...result,
                  x: result.x + (next.x - previous.x) / 2,
                  y: result.y + (next.y - previous.y) / 2,
                },
                content,
                viewport
              )
            })
          } else if (pannable) pan(next.x - previous.x, next.y - previous.y)
        }}
        onPointerUp={event => {
          pointers.current.delete(event.pointerId)
          setDragging(pointers.current.size > 0)
        }}
        onPointerCancel={event => {
          pointers.current.delete(event.pointerId)
          setDragging(pointers.current.size > 0)
        }}
        onLostPointerCapture={event => {
          pointers.current.delete(event.pointerId)
          setDragging(pointers.current.size > 0)
        }}
      >
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
            <ImageOff className="h-8 w-8" />
            {t('preview.noImageSource')}
          </div>
        ) : (
          <>
            {!loaded && (
              <p
                role="status"
                className="absolute inset-0 grid place-items-center text-sm text-slate-500"
              >
                {t('desktopUi.loadingPreview')}
              </p>
            )}
            <img
              src={sourceUrl}
              alt={t('preview.navigation.image')}
              draggable={false}
              onError={() => setFailed(true)}
              onLoad={event =>
                setContent({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              className="absolute left-0 top-0 max-w-none select-none"
              style={{
                width: content.width || undefined,
                height: content.height || undefined,
                opacity: loaded ? 1 : 0,
                transformOrigin: 'top left',
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }}
            />
          </>
        )}
      </div>
      <p className="shrink-0 px-3 py-1 text-[10px] text-slate-500 dark:text-slate-400">
        {t('preview.navigation.hint')}
      </p>
    </div>
  )
}
