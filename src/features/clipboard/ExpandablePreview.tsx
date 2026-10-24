import * as Dialog from '@radix-ui/react-dialog'
import { Maximize2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui/Button'

// Keep a single portal target: moving its DOM preserves image and native-webview state.
export function ExpandablePreview({
  children,
  title,
}: {
  children: (expand: ReactNode) => ReactNode
  title: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [target] = useState(() => {
    const node = document.createElement('div')
    node.className = 'h-full min-h-0 w-full'
    return node
  })
  const inline = useRef<HTMLDivElement>(null)
  const expanded = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const destination = open ? expanded.current : inline.current
    destination?.append(target)
    window.dispatchEvent(new Event('resize'))
  }, [open, target])
  useLayoutEffect(() => {
    const escape = () => setOpen(false)
    target.addEventListener('clipsx-preview-escape', escape)
    return () => {
      target.removeEventListener('clipsx-preview-escape', escape)
      target.remove()
    }
  }, [target])
  const expand = (
    <Button
      ref={trigger}
      variant="ghost"
      size="sm"
      className="px-2"
      title={t('preview.navigation.expand')}
      aria-label={t('preview.navigation.expand')}
      onClick={() => setOpen(true)}
    >
      <Maximize2 className="h-4 w-4" />
    </Button>
  )
  return (
    <>
      <div ref={inline} className="h-full min-h-0" />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            onCloseAutoFocus={event => {
              event.preventDefault()
              trigger.current?.focus()
            }}
            className="fixed inset-3 z-50 flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 outline-none dark:border-white/10 dark:bg-slate-900"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-1 dark:border-white/10">
              <Dialog.Title className="text-sm font-medium">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" aria-label={t('desktopUi.close')}>
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
            <div
              ref={node => {
                expanded.current = node
                if (node) node.append(target)
              }}
              className="min-h-0 flex-1"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {createPortal(children(expand), target)}
    </>
  )
}
