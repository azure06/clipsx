import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Plus, MoreHorizontal, Check, X } from 'lucide-react'
import {
  Button,
  Input,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../shared/components/ui'
import type { RecallThread } from './contracts.generated'

export interface ThreadSidebarProps {
  threads: RecallThread[]
  thread: RecallThread | null
  busy: boolean
  running: boolean
  open: boolean
  onSelectThread: (id: string) => void
  onNewThread: () => void
  onLoadMore: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string, archived: boolean) => void
  onDelete: (id: string) => void
  onClose: () => void
}

interface ThreadRowProps {
  row: RecallThread
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onArchive: () => void
  onDelete: () => void
  disabled: boolean
}

function ThreadRow({
  row,
  active,
  onSelect,
  onRename,
  onArchive,
  onDelete,
  disabled,
}: ThreadRowProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const label =
    (row.archived ? t('recallPage.archivedPrefix') : '') + (row.title || t('recallPage.untitled'))

  const confirmRename = () => {
    const trimmed = draft.trim()
    if (trimmed) onRename(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-1 py-0.5">
        <Input
          aria-label={t('recallPage.threadTitle')}
          value={draft}
          onChange={setDraft}
          className="min-w-0 flex-1 text-xs"
          onKeyDown={event => {
            if (event.key === 'Enter') confirmRename()
            if (event.key === 'Escape') setEditing(false)
          }}
          disabled={disabled}
          autoFocus
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('recallPage.rename')}
          disabled={disabled}
          onClick={confirmRename}
        >
          <Check size={12} aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-1 rounded-xl px-1.5 py-0.5 transition-colors">
      <button
        type="button"
        className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 ${
          active
            ? 'bg-violet-500/10 font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200'
            : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200'
        }`}
        disabled={disabled}
        onClick={onSelect}
      >
        {label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('recallPage.threadSettings')}
            disabled={disabled}
            className="shrink-0 size-7 p-0 rounded-lg text-slate-400 opacity-60 hover:opacity-100 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal size={13} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(row.title || '')
              setEditing(true)
            }}
          >
            {t('recallPage.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            {row.archived ? t('recallPage.unarchive') : t('recallPage.archive')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete}>{t('recallPage.deleteThread')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ThreadSidebar({
  threads,
  thread,
  busy,
  running,
  open,
  onSelectThread,
  onNewThread,
  onLoadMore,
  onRename,
  onArchive,
  onDelete,
  onClose,
}: ThreadSidebarProps) {
  const { t } = useTranslation()

  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  if (!open) {
    return (
      <aside className="flex shrink-0 w-11 flex-col items-center rounded-2xl border border-slate-200/60 bg-slate-100/30 py-2.5 dark:border-white/10 dark:bg-slate-100/5">
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('recallPage.newThread')}
          disabled={busy || running}
          onClick={onNewThread}
          className="size-8 rounded-xl p-0 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
        >
          <Plus size={15} aria-hidden="true" />
        </Button>
      </aside>
    )
  }

  const content = (
    <aside
      aria-label={t('recallPage.thread')}
      className="flex h-full w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-slate-50 dark:border-white/10 dark:bg-slate-900 lg:w-52 lg:bg-slate-100/30 lg:dark:bg-slate-100/5"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-200/60 p-2 dark:border-white/10">
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start gap-2 rounded-xl bg-violet-50/80 font-medium text-violet-700 hover:bg-violet-100/80 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
          disabled={busy || running}
          onClick={onNewThread}
        >
          <Plus size={14} aria-hidden="true" />
          {t('recallPage.newThread')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 shrink-0 px-0 lg:hidden"
          aria-label={t('recallOptions.closeThreads')}
          onClick={onClose}
        >
          <X size={13} aria-hidden="true" />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5 custom-scrollbar">
        {threads.map(row => (
          <li key={row.id}>
            <ThreadRow
              row={row}
              disabled={busy || running}
              active={thread?.id === row.id}
              onSelect={() => onSelectThread(row.id)}
              onRename={title => onRename(row.id, title)}
              onArchive={() => onArchive(row.id, row.archived)}
              onDelete={() => onDelete(row.id)}
            />
          </li>
        ))}
      </ul>
      {threads.length >= 200 && (
        <div className="shrink-0 border-t border-slate-200/60 p-2 dark:border-white/5">
          <Button
            size="sm"
            variant="ghost"
            className="w-full rounded-xl text-xs"
            disabled={busy}
            onClick={onLoadMore}
          >
            {t('recallPage.moreThreads')}
          </Button>
        </div>
      )}
    </aside>
  )
  if (desktop) return content
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/25" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-3 left-3 z-[70] w-60 max-w-[calc(100vw-1.5rem)] outline-none"
          onCloseAutoFocus={event => {
            event.preventDefault()
            onClose()
          }}
        >
          <Dialog.Title className="sr-only">{t('recallPage.thread')}</Dialog.Title>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
