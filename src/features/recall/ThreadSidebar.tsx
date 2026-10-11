import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, MoreHorizontal, Check } from 'lucide-react'
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
  threadOffset: number
  open: boolean
  onToggle: () => void
  onSelectThread: (id: string) => void
  onNewThread: () => void
  onLoadMore: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string, archived: boolean) => void
  onDelete: (id: string) => void
}

interface ThreadRowProps {
  row: RecallThread
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onArchive: () => void
  onDelete: () => void
}

function ThreadRow({ row, active, onSelect, onRename, onArchive, onDelete }: ThreadRowProps) {
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
          autoFocus
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('recallPage.rename')}
          onClick={confirmRename}
        >
          <Check size={12} aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      <button
        type="button"
        className={`w-full truncate rounded-md px-2 py-1 text-left text-xs ${
          active
            ? 'bg-violet-50/60 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
            : 'text-slate-600 hover:bg-slate-100/60 dark:text-slate-300 dark:hover:bg-white/5'
        }`}
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
            className="shrink-0 px-1"
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
          <DropdownMenuItem onSelect={onDelete}>
            {t('recallPage.deleteThread')}
          </DropdownMenuItem>
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
}: ThreadSidebarProps) {
  const { t } = useTranslation()

  if (!open) {
    return (
      <aside className="hidden shrink-0 w-10 flex-col items-center border-r border-slate-200 py-1 transition-all duration-150 dark:border-white/10 lg:flex">
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('recallPage.newThread')}
          disabled={busy || running}
          onClick={onNewThread}
        >
          <Plus size={14} aria-hidden="true" />
        </Button>
      </aside>
    )
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50/60 transition-all duration-150 dark:border-white/10 dark:bg-white/[0.015]">
      <div className="shrink-0 border-b border-slate-200 px-1 py-1 dark:border-white/10">
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start gap-1.5"
          disabled={busy || running}
          onClick={onNewThread}
        >
          <Plus size={13} aria-hidden="true" />
          {t('recallPage.newThread')}
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {threads.map(row => (
          <li key={row.id}>
            <ThreadRow
              row={row}
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
        <div className="shrink-0 border-t border-slate-200 p-1 dark:border-white/10">
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={onLoadMore}
          >
            {t('recallPage.moreThreads')}
          </Button>
        </div>
      )}
    </aside>
  )
}
