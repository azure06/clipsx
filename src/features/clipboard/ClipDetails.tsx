import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Info,
  CalendarClock,
  AppWindow,
  LetterText,
  ListOrdered,
  Code2,
  ScanText,
} from 'lucide-react'
import { Button, dropdownSurfaceClass } from '../../shared/components/ui'
import type { OcrPresentation } from '../../shared/types/v2'
import type { presentationTextStats } from './presentationModel'

export function ClipDetails({
  capturedAt,
  source,
  stats,
  ocr,
}: {
  capturedAt: number
  source: string | null
  stats: ReturnType<typeof presentationTextStats>
  ocr: OcrPresentation | null
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const titleId = useId(),
    descriptionId = useId()
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [open])
  const row = (icon: ReactNode, label: string, value: ReactNode) => (
    <div className="flex items-start gap-3 py-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </dt>
        <dd className="mt-1 break-words text-xs text-slate-700 dark:text-slate-200">{value}</dd>
      </div>
    </div>
  )
  const iconClass = 'mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400'
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 px-2 text-[11px] text-slate-500"
          leftIcon={<Info aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {t('clipboard.clipDetails')}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="top"
          sideOffset={8}
          collisionPadding={12}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={`${dropdownSurfaceClass} z-[80] w-72 max-w-[calc(100vw-1.5rem)] rounded-xl outline-none`}
        >
          <div className="flex items-center gap-3 border-b border-slate-200/70 bg-slate-50/70 px-4 py-3 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300">
              <Info aria-hidden="true" size={16} />
            </span>
            <div>
              <h3 id={titleId} className="text-xs font-semibold">
                {t('clipDetails.title')}
              </h3>
              <p
                id={descriptionId}
                className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400"
              >
                {t('clipDetails.subtitle')}
              </p>
            </div>
          </div>
          <div className="max-h-[min(65vh,420px)] overflow-y-auto px-4 py-1">
            <dl className="divide-y divide-slate-200/60 dark:divide-white/5">
              {row(
                <CalendarClock aria-hidden="true" className={iconClass} />,
                t('clipDetails.captured'),
                new Date(capturedAt).toLocaleString(i18n.resolvedLanguage)
              )}
              {source &&
                row(
                  <AppWindow aria-hidden="true" className={iconClass} />,
                  t('clipboard.source'),
                  source
                )}
              {stats && (
                <div className="grid grid-cols-2 gap-4">
                  {row(
                    <LetterText aria-hidden="true" className={iconClass} />,
                    t('clipDetails.characters'),
                    stats.characters.toLocaleString(i18n.resolvedLanguage)
                  )}
                  {row(
                    <ListOrdered aria-hidden="true" className={iconClass} />,
                    t('clipDetails.lines'),
                    stats.lines.toLocaleString(i18n.resolvedLanguage)
                  )}
                </div>
              )}
              {stats?.language &&
                row(
                  <Code2 aria-hidden="true" className={iconClass} />,
                  t('clipDetails.language'),
                  stats.language
                )}
              {ocr &&
                row(
                  <ScanText aria-hidden="true" className={iconClass} />,
                  t('clipDetails.ocr'),
                  t(`clipDetails.ocrState.${ocr.state}`)
                )}
            </dl>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
