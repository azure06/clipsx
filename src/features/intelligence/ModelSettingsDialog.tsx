import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type ReactNode } from 'react'
import { X, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ModelSettingsDialog({
  title,
  description,
  children,
  onClose,
  busy = false,
}: {
  title: string
  description: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const previousFocus = useRef(document.activeElement)
  return (
    <Dialog.Root
      open
      onOpenChange={open => {
        if (!open && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[2px] dark:bg-black/55" />
        <Dialog.Content
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus()
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 p-5 shadow-[0_28px_80px_-36px_rgba(15,23,42,.55)] outline-none dark:border-white/10 dark:bg-slate-900"
        >
          <div className="mb-5 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-600 ring-1 ring-violet-500/15 dark:text-violet-300">
              <Wand2 className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close
              disabled={busy}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
