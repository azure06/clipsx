import { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ShieldAlert, ShieldCheck, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
type Status = { captureHash: string; secret: boolean; private: boolean }
export function ClipSecretControl({ clipId }: { clipId: string }) {
  const { t } = useTranslation(),
    { toast } = useToast()
  const sequence = useRef(0)
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () => {
      const request = ++sequence.current
      void invoke<Status>('get_clip_secret_status', { clipId })
        .then(value => {
          if (active && request === sequence.current) setStatus(value)
        })
        .catch(() => {
          if (active && request === sequence.current) setStatus(null)
        })
    }
    refresh()
    const subscription = listen<{ clipId: string | null }>('clip-facets-updated', event => {
      if (!event.payload.clipId || event.payload.clipId === clipId) refresh()
    })
    return () => {
      active = false
      void subscription.then(stop => stop()).catch(() => undefined)
    }
  }, [clipId])
  const change = async () => {
    if (!status || busy) return
    if (!window.confirm(t('secretOverride.confirm'))) return
    sequence.current += 1
    setBusy(true)
    try {
      const next = await invoke<Status>('clear_clip_secret', {
        clipId,
        captureHash: status.captureHash,
      })
      setStatus(next)
      toast({
        title: t('secretOverride.cleared'),
        type: 'success',
      })
    } catch {
      toast({ title: t('secretOverride.failed'), type: 'error' })
    } finally {
      setBusy(false)
    }
  }
  if (!status?.secret) return null
  return (
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
          aria-label={t('secretOverride.review')}
          className={`shrink-0 gap-1 px-2 text-[11px] text-amber-700 dark:text-amber-300`}
          leftIcon={<ShieldAlert size={13} />}
          rightIcon={<ChevronDown size={10} />}
        >
          <span>{t('secretOverride.secret')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {t('secretOverride.help')}
        </p>
        {status.private && (
          <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-300">
            {t('secretOverride.privateRemains')}
          </p>
        )}
        <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void change()}>
          <ShieldCheck size={13} />
          <span>{t('secretOverride.action')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
