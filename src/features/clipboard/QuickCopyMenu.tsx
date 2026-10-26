import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../shared/components/ui'
import { copyClipboardOutput, clipboardOutputRevision } from '../../shared/clipboardOutput'
import { listen } from '@tauri-apps/api/event'
import { useToast } from '../../shared/contexts/ToastContext'
import { failureMessage } from '../extensions/failures'
import type { Transformer } from './useTransformState'
import type { ExtensionJob } from './useClipExtensionJobs'
import type { ClipViewDescriptor } from '../../shared/types/v2'
import { quickCopyCandidates, type QuickCopyCandidate } from './quickCopy'
import { sourceLabel } from './previewViews'

type Pending = {
  jobId: string
  clipId: string
  mimeType: string
  outputId: string
  label: string
  clipboardRevision: number
}
export function QuickCopyMenu({
  clipId,
  transformers,
  jobs,
  views = [],
  hasPlainText = false,
  refreshJobs,
  onViewResult,
}: {
  clipId: string
  transformers: Transformer[]
  jobs: ExtensionJob[]
  views?: ClipViewDescriptor[]
  hasPlainText?: boolean
  refreshJobs: () => Promise<void>
  onViewResult: (id: string) => void
}) {
  const { t } = useTranslation(),
    { toast } = useToast(),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [lastJob, setLastJob] = useState<string | null>(null)
  const currentClip = useRef(clipId),
    locked = useRef(false),
    alive = useRef(true)
  const generation = useRef(0)
  useLayoutEffect(() => {
    currentClip.current = clipId
    generation.current += 1
  }, [clipId])
  const [preferred, setPreferred] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem('clipsx.copyProviders.v1') ?? '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'string' && value.length < 256)
          .slice(0, 64)
      ) as Record<string, string>
    } catch {
      return {}
    }
  })
  const candidates = useMemo(() => quickCopyCandidates(transformers), [transformers])
  const groups = useMemo(
    () =>
      [...new Set(candidates.map(item => item.setup.copyAs!.intent))].map(intent => ({
        intent,
        items: candidates.filter(item => item.setup.copyAs!.intent === intent),
      })),
    [candidates]
  )
  useEffect(() => {
    setPending(null)
    setLastJob(null)
    setBusy(false)
    locked.current = false
  }, [clipId])
  useEffect(() => {
    const subscription = listen('clip-captured', () => {
      if (!locked.current) return
      generation.current += 1
      locked.current = false
      setPending(null)
      setBusy(false)
    })
    return () => {
      void subscription.then(stop => stop()).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => {
      if (currentClip.current === pending.clipId) {
        setPending(null)
        setBusy(false)
        locked.current = false
        toast({ title: t('previewWorkspace.copyStillRunning'), type: 'default' })
      }
    }, 30000)
    return () => clearTimeout(timer)
  }, [pending, t, toast])
  useEffect(() => {
    if (!pending || pending.clipId !== clipId) return
    const job = jobs.find(job => job.jobId === pending.jobId)
    if (!job || !['completed', 'failed', 'cancelled'].includes(job.status)) return
    setPending(null)
    const output = job.outputs.find(
      item => item.outputId === pending.outputId && item.mimeType === pending.mimeType
    )
    const finish = async () => {
      try {
        if (job.status !== 'completed' || !output)
          throw new Error(
            job.reasonCode
              ? failureMessage(job.reasonCode)
              : t('previewWorkspace.copyOutputMismatch')
          )
        if (
          !alive.current ||
          currentClip.current !== pending.clipId ||
          clipboardOutputRevision() !== pending.clipboardRevision
        )
          return
        await copyClipboardOutput({
          kind: 'derived_output',
          jobId: job.jobId,
          ordinal: output.ordinal,
        })
        if (alive.current && currentClip.current === pending.clipId)
          toast({
            title: t('previewWorkspace.copiedAs', { format: pending.label }),
            type: 'success',
          })
      } catch (error) {
        if (alive.current && currentClip.current === pending.clipId)
          toast({
            title: t('previewWorkspace.copyFailed'),
            description: failureMessage(error),
            type: 'error',
          })
      } finally {
        if (alive.current && currentClip.current === pending.clipId) {
          locked.current = false
          setBusy(false)
        }
      }
    }
    void finish()
  }, [jobs, pending, clipId, t, toast])
  const run = async (candidate: QuickCopyCandidate) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    const clipboardRevision = clipboardOutputRevision()
    const ticket = generation.current
    const sourceClip = clipId,
      copy = candidate.setup.copyAs!
    try {
      const result = await invoke<{ jobId: string }>('enqueue_extension_transform', {
        request: {
          clipId: sourceClip,
          sourceId: candidate.sourceId,
          transformerId: candidate.transformer.id,
          parameters: candidate.parameters,
          setupId: null,
          defaultView: 'result_only',
          requestId: crypto.randomUUID(),
          invocationToken: null,
        },
      })
      if (!alive.current || currentClip.current !== sourceClip || generation.current !== ticket)
        return
      setLastJob(result.jobId)
      setPending({
        jobId: result.jobId,
        clipId: sourceClip,
        mimeType: copy.mimeType,
        outputId: copy.outputId,
        label: copy.label,
        clipboardRevision,
      })
      const next = { ...preferred, [copy.intent]: candidate.key }
      setPreferred(next)
      try {
        localStorage.setItem('clipsx.copyProviders.v1', JSON.stringify(next))
      } catch {
        /* Runtime remains usable when storage is unavailable. */
      }
      await refreshJobs()
    } catch (error) {
      if (alive.current && currentClip.current === sourceClip) {
        setBusy(false)
        locked.current = false
        toast({
          title: t('previewWorkspace.copyFailed'),
          description: failureMessage(error),
          type: 'error',
        })
      }
    }
  }
  if (!candidates.length && !hasPlainText) return null
  const option = (candidate: QuickCopyCandidate) => {
    const view = views.find(view => view.sourceId === candidate.sourceId)
    return (
      <DropdownMenuItem
        key={candidate.key}
        onSelect={() => void run(candidate)}
        className="px-2 py-2 text-xs"
      >
        {candidate.transformer.packageLabel ?? candidate.transformer.label}
        {view ? ` · ${sourceLabel(view)}` : ''}
      </DropdownMenuItem>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <DropdownMenu
        onOpenChange={open =>
          window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open } }))
        }
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={t('previewWorkspace.copyAs')}
            className="gap-1 px-2"
            leftIcon={
              busy ? <LoaderCircle size={13} className="motion-safe:animate-spin" /> : undefined
            }
            rightIcon={<ChevronDown size={12} />}
          >
            {t(busy ? 'previewWorkspace.copying' : 'previewWorkspace.copyAs')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {hasPlainText && (
            <DropdownMenuItem
              className="px-2 py-2 text-xs"
              onSelect={() => {
                void copyClipboardOutput({ kind: 'plain_text', clipId })
                  .then(() => toast({ title: t('clipboard.copiedToClipboard'), type: 'success' }))
                  .catch(error =>
                    toast({
                      title: t('previewWorkspace.copyFailed'),
                      description: String(error),
                      type: 'error',
                    })
                  )
              }}
            >
              {t('previewWorkspace.plainText')}
            </DropdownMenuItem>
          )}
          {groups.map(group => {
            const preferredCandidate = group.items.find(
              item => item.key === preferred[group.intent]
            )
            const unambiguous = new Set(group.items.map(item => item.sourceId)).size === 1
            const direct =
              group.items.length === 1
                ? group.items[0]
                : unambiguous
                  ? preferredCandidate
                  : undefined
            return (
              <div key={group.intent}>
                {direct && (
                  <DropdownMenuItem className="px-2 py-2 text-xs" onSelect={() => void run(direct)}>
                    {direct.setup.copyAs!.label}
                  </DropdownMenuItem>
                )}
                {group.items.length > 1 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {group.items[0]!.setup.copyAs!.label}
                      {direct ? ` · ${t('previewWorkspace.otherProviders')}` : ''}
                      <ChevronRight size={12} className="ml-auto" />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>{group.items.map(option)}</DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </div>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {lastJob && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onViewResult(lastJob)}
          className="px-2 text-xs"
        >
          {t('previewWorkspace.viewResult')}
        </Button>
      )}
    </div>
  )
}
