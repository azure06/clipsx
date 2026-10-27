import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { WandSparkles, ChevronDown, Play, SlidersHorizontal, LoaderCircle } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
import { failureMessage } from '../extensions/failures'
import type { SavedSetup } from '../extensions/parameters'
import type { Transformer } from './useTransformState'
import type { ClipViewDescriptor } from '../../shared/types/v2'
import { previewTransforms, type PreviewTransform } from './transformMenu'
import { sourceLabel } from './previewViews'
export function PreviewTransformMenu({
  clipId,
  transformers,
  views,
  onRunStarted,
  onQueued,
  onConfigure,
}: {
  clipId: string
  transformers: Transformer[]
  views: ClipViewDescriptor[]
  onRunStarted: () => number
  onQueued: (id: string, ticket: number) => void
  onConfigure: (id: string) => void
}) {
  const { t } = useTranslation(),
    { toast } = useToast()
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<SavedSetup[]>([]),
    [loadError, setLoadError] = useState(false)
  const alive = useRef(false),
    locked = useRef(false)
  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    setLoadError(false)
    void invoke<SavedSetup[]>('list_extension_transform_setups')
      .then(items => {
        if (active) setSaved(items)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))
    return () => {
      active = false
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [open, transformers])
  const entries = useMemo(() => previewTransforms(transformers, saved), [transformers, saved])
  const run = async (entry: PreviewTransform) => {
    if (locked.current || entry.disabled) return
    if (entry.configure) {
      onConfigure(entry.id)
      return
    }
    locked.current = true
    setBusy(true)
    const ticket = onRunStarted()
    try {
      const invocation =
        entry.transformer.execution === 'capability_backed'
          ? await invoke<{ token: string }>('issue_extension_transformer_invocation', {
              transformerId: entry.transformer.id,
              clipId,
              sourceId: entry.sourceId,
            })
          : null
      if (!alive.current) return
      const job = await invoke<{ jobId: string }>('enqueue_extension_transform', {
        request: {
          clipId,
          sourceId: entry.sourceId,
          transformerId: entry.transformer.id,
          parameters: entry.parameters,
          setupId: entry.setupId,
          defaultView: 'result_only',
          requestId: crypto.randomUUID(),
          invocationToken: invocation?.token ?? null,
        },
      })
      if (alive.current) onQueued(job.jobId, ticket)
    } catch (error) {
      if (alive.current)
        toast({
          title: t('previewTransform.failed'),
          description: failureMessage(error),
          type: 'error',
        })
    } finally {
      if (alive.current) {
        locked.current = false
        setBusy(false)
      }
    }
  }
  if (!transformers.length) return null
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={t('previewTransform.title')}
          title={t('previewTransform.title')}
          className="shrink-0 gap-1 px-2 text-slate-500"
          leftIcon={
            busy ? (
              <LoaderCircle size={14} className="motion-safe:animate-spin" />
            ) : (
              <WandSparkles size={14} />
            )
          }
          rightIcon={<ChevronDown size={11} />}
        >
          <span className="hidden lg:inline">{t('previewTransform.title')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(65vh,460px)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto"
      >
        {transformers.map(transformer => {
          const options = entries.filter(entry => entry.transformer.id === transformer.id)
          return options.length ? (
            <div key={transformer.id}>
              <div className="px-2 pb-1 pt-2">
                <p className="text-[11px] font-semibold text-slate-500">{transformer.label}</p>
                <p className="text-[10px] text-slate-400">
                  {transformer.packageLabel ?? transformer.packageId}
                </p>
              </div>
              {options.map(entry => {
                const input = views.find(view => view.sourceId === entry.sourceId)
                return (
                  <DropdownMenuItem
                    key={entry.id}
                    disabled={entry.disabled || busy}
                    title={entry.reason ? failureMessage(entry.reason) : undefined}
                    className="items-start gap-2 px-2 py-2 text-xs"
                    onSelect={() => void run(entry)}
                  >
                    {entry.configure ? (
                      <SlidersHorizontal aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
                    ) : (
                      <Play aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block break-words">
                        {entry.id.startsWith('custom:') && transformer.setups.length
                          ? t('previewTransform.custom')
                          : entry.label}
                        {entry.configure ? '…' : ''}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {entry.disabled
                          ? entry.reason
                            ? failureMessage(entry.reason)
                            : t('previewTransform.unavailable')
                          : entry.configure
                            ? t('previewTransform.configure')
                            : input
                              ? t('previewTransform.input', { source: sourceLabel(input) })
                              : t('previewTransform.run')}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          ) : null
        })}
        {!entries.length && (
          <p className="px-3 py-4 text-xs text-slate-500">{t('previewTransform.empty')}</p>
        )}
        {loadError && (
          <p role="status" className="px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
            {t('previewTransform.savedError')}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
