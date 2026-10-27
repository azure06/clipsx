import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  WandSparkles,
  ChevronDown,
  ChevronRight,
  Play,
  SlidersHorizontal,
  LoaderCircle,
} from 'lucide-react'
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
        {[
          {
            id: 'run',
            title: t('previewTransform.runNow'),
            description: t('previewTransform.runNowHelp'),
            items: entries.filter(entry => !entry.disabled && !entry.configure),
          },
          {
            id: 'configure',
            title: t('previewTransform.configureTitle'),
            description: t('previewTransform.configure'),
            items: entries.filter(entry => !entry.disabled && entry.configure),
          },
          {
            id: 'unavailable',
            title: t('previewTransform.unavailableTitle'),
            description: null,
            items: entries.filter(entry => entry.disabled),
          },
        ]
          .filter(section => section.items.length > 0)
          .map((section, index) => (
            <div
              key={section.id}
              role="group"
              aria-label={section.title}
              className={index ? 'mt-2 border-t border-slate-200/70 pt-2 dark:border-white/10' : ''}
            >
              <div className="px-2.5 pb-2 pt-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {section.title}
                  </p>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-400 dark:bg-white/5">
                    {section.items.length}
                  </span>
                </div>
                {section.description && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {section.description}
                  </p>
                )}
              </div>
              {transformers.map(transformer => {
                const options = section.items.filter(
                  entry => entry.transformer.id === transformer.id
                )
                if (!options.length) return null
                return (
                  <div key={transformer.id} className="mb-1 last:mb-0">
                    <p className="px-2.5 pb-1 pt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                      {transformer.packageLabel ?? transformer.packageId}{' '}
                      <span aria-hidden="true" className="px-0.5 opacity-50">
                        /
                      </span>{' '}
                      {transformer.label}
                    </p>
                    {options.map(entry => {
                      const input = views.find(view => view.sourceId === entry.sourceId)
                      return (
                        <DropdownMenuItem
                          key={entry.id}
                          disabled={entry.disabled || busy}
                          title={entry.reason ? failureMessage(entry.reason) : undefined}
                          className="items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-xs"
                          onSelect={() => void run(entry)}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${entry.configure || entry.disabled ? 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400' : 'bg-violet-500/10 text-violet-600 dark:text-violet-300'}`}
                          >
                            {entry.configure ? (
                              <SlidersHorizontal aria-hidden="true" size={13} />
                            ) : (
                              <Play aria-hidden="true" size={13} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words font-medium text-slate-800 dark:text-slate-100">
                              {entry.id.startsWith('custom:') && transformer.setups.length
                                ? t('previewTransform.custom')
                                : entry.label}
                              {entry.configure ? '…' : ''}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                              {entry.disabled
                                ? entry.reason
                                  ? failureMessage(entry.reason)
                                  : t('previewTransform.unavailable')
                                : input
                                  ? t('previewTransform.input', { source: sourceLabel(input) })
                                  : entry.configure
                                    ? t('previewTransform.configure')
                                    : t('previewTransform.run')}
                            </span>
                          </span>
                          {entry.configure && (
                            <ChevronRight
                              aria-hidden="true"
                              size={13}
                              className="shrink-0 text-slate-400"
                            />
                          )}
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
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
