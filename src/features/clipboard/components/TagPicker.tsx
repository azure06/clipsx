import * as Popover from '@radix-ui/react-popover'
import { ArrowLeft, Check, Plus, Search, Settings2, Tags, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, dropdownSurfaceClass, suggestionItemClass } from '../../../shared/components/ui'
import { useClipboardStore } from '../../../stores/clipboardStore'
import type { V2Tag } from '../../../shared/types/v2'
import { cn } from '../../../shared/utils/cn'

type Props = {
  trigger: ReactElement
  selectedIds: string[]
  onChoose: (tag: V2Tag | null) => Promise<void>
  onCreate?: (name: string) => Promise<void>
  onRemove?: (id: string) => Promise<void>
  attachedTags?: V2Tag[]
  onDelete?: (id: string) => Promise<void>
}
export function TagPicker({
  trigger,
  selectedIds,
  onChoose,
  onCreate,
  onDelete,
  onRemove,
  attachedTags = [],
}: Props) {
  const { t } = useTranslation()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [managing, setManaging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<V2Tag | null>(null)
  const tags = useClipboardStore(state => state.availableTags)
  const loading = useClipboardStore(state => state.tagsLoading)
  const loadError = useClipboardStore(state => state.tagsError)
  const refresh = useClipboardStore(state => state.refreshAvailableTags)
  const attaching = Boolean(onCreate)
  const tagName = query.trim()
  const normalized = tagName.toLowerCase()
  const matchingTags = tags.filter(tag => tag.name.toLowerCase().includes(normalized))
  const options: { tag: V2Tag | null; create?: boolean; label: string }[] = [
    ...(!attaching && !normalized ? [{ tag: null, label: t('clipboard.allTags') }] : []),
    ...matchingTags
      .filter(tag => !attaching || !selectedIds.includes(tag.id))
      .map(tag => ({ tag, label: tag.name })),
    ...(attaching && normalized && !tags.some(tag => tag.name.toLowerCase() === normalized)
      ? [{ tag: null, create: true, label: t('clipboard.createTag', { name: tagName }) }]
      : []),
  ]
  const active = Math.min(activeIndex, Math.max(0, options.length - 1))
  useEffect(() => {
    if (open && !busy) (deleteTarget ? cancelDelete : input).current?.focus()
  }, [open, busy, managing, deleteTarget])
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [open])
  const run = async (action: () => Promise<void>, { close = false, resetQuery = true } = {}) => {
    if (busy) return
    setBusy(true)
    setActionError(false)
    try {
      await action()
      if (resetQuery) setQuery('')
      setActiveIndex(0)
      if (close) setOpen(false)
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }
  const choose = (index: number) => {
    const option = options[index]
    if (option)
      void run(() => (option.create && onCreate ? onCreate(tagName) : onChoose(option.tag)), {
        close: !attaching,
      })
  }
  const changeView = (manage: boolean) => {
    setManaging(manage)
    setQuery('')
    setActiveIndex(0)
    setActionError(false)
  }
  const confirmDelete = () => {
    if (!onDelete || !deleteTarget) return
    void run(
      async () => {
        await onDelete(deleteTarget.id)
        setDeleteTarget(null)
      },
      { resetQuery: false }
    )
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={next => {
        if (busy) return
        setOpen(next)
        if (next) {
          changeView(false)
          setDeleteTarget(null)
          void refresh()
        }
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={t(
            managing
              ? 'clipboard.manageTags'
              : attaching
                ? 'clipboard.addTag'
                : 'clipboard.filterByTag'
          )}
          sideOffset={8}
          collisionPadding={12}
          align="start"
          className={cn(dropdownSurfaceClass, 'z-[80] w-72 max-w-[calc(100vw-1.5rem)]')}
          onOpenAutoFocus={event => {
            event.preventDefault()
            input.current?.focus()
          }}
          onEscapeKeyDown={event => {
            if (!deleteTarget) return
            event.preventDefault()
            if (!busy) {
              setDeleteTarget(null)
              setActionError(false)
            }
          }}
          onKeyDown={event => event.stopPropagation()}
        >
          {managing && !deleteTarget && (
            <div className="flex items-center gap-2 border-b border-slate-200/70 px-2 py-1 dark:border-white/10">
              <Button
                variant="ghost"
                size="sm"
                className="p-1.5"
                aria-label={t('clipboard.filterByTag')}
                onClick={() => changeView(false)}
              >
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-medium">{t('clipboard.manageTags')}</span>
            </div>
          )}
          <div
            className={cn(
              'items-center gap-2 border-b border-slate-200/70 px-3 dark:border-white/10',
              deleteTarget ? 'hidden' : 'flex'
            )}
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={input}
              value={query}
              role={managing ? undefined : 'combobox'}
              aria-label={t(attaching ? 'clipboard.findOrCreateTag' : 'clipboard.searchTags')}
              aria-autocomplete={managing ? undefined : 'list'}
              aria-expanded={managing ? undefined : true}
              aria-controls={managing ? undefined : `${id}-list`}
              aria-activedescendant={
                !managing && options.length ? `${id}-option-${active}` : undefined
              }
              disabled={busy}
              placeholder={t(attaching ? 'clipboard.tagPlaceholder' : 'clipboard.searchTags')}
              className="min-w-0 flex-1 bg-transparent py-3 text-xs outline-none placeholder:text-slate-400 disabled:opacity-50"
              onChange={event => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={event => {
                if (managing || event.nativeEvent.isComposing) return
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault()
                  if (!options.length) return
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? options.length - 1
                        : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                          options.length
                  setActiveIndex(next)
                  document
                    .getElementById(`${id}-option-${next}`)
                    ?.scrollIntoView?.({ block: 'nearest' })
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  choose(active)
                }
              }}
            />
          </div>
          {onRemove && attachedTags.length > 0 && (
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto border-b border-slate-200/70 p-3 dark:border-white/10">
              {attachedTags.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  disabled={busy}
                  aria-label={t('clipboard.removeTag', { name: tag.name })}
                  onClick={() => void run(() => onRemove(tag.id))}
                  className="flex max-w-full items-center gap-1.5 rounded-md bg-violet-500/10 px-2 py-1 text-[11px] text-violet-700 transition-colors hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:text-violet-200"
                >
                  <span className="truncate">{tag.name}</span>
                  <X aria-hidden="true" className="h-3 w-3 shrink-0" />
                </button>
              ))}
            </div>
          )}
          {!deleteTarget && loading && (
            <p role="status" className="px-3 py-2 text-xs text-slate-500">
              {t('clipboard.loadingTags')}
            </p>
          )}
          {!deleteTarget && loadError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
            >
              <span>{t('clipboard.tagsLoadError')}</span>
              <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
                {t('common.retry')}
              </Button>
            </div>
          )}
          {managing ? (
            !deleteTarget && (
              <ul aria-label={t('clipboard.tags')} className="max-h-60 overflow-y-auto p-1.5">
                {matchingTags.map(tag => (
                  <li key={tag.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full bg-violet-400"
                      style={tag.color ? { backgroundColor: tag.color } : undefined}
                    />
                    <span className="min-w-0 flex-1 break-words text-xs">{tag.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 p-1.5 text-slate-500 hover:text-red-700 dark:hover:text-red-300"
                      aria-label={t('clipboard.deleteNamedTag', { name: tag.name })}
                      title={t('clipboard.deleteTag')}
                      onClick={() => setDeleteTarget(tag)}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div
              id={`${id}-list`}
              role="listbox"
              aria-label={t('clipboard.tags')}
              aria-busy={busy || loading}
              className="max-h-60 overflow-y-auto p-1.5"
            >
              {options.map((option, index) => (
                <button
                  key={option.create ? 'create' : (option.tag?.id ?? 'all')}
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active === index}
                  tabIndex={-1}
                  disabled={busy}
                  onMouseDown={event => event.preventDefault()}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    suggestionItemClass,
                    'w-full gap-2 py-2 text-xs disabled:opacity-50',
                    active === index &&
                      'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'
                  )}
                >
                  {option.create ? (
                    <Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  ) : option.tag ? (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full bg-violet-400"
                      style={option.tag.color ? { backgroundColor: option.tag.color } : undefined}
                    />
                  ) : (
                    <Tags aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 break-words text-left">{option.label}</span>
                  {!attaching &&
                    (option.tag ? selectedIds.includes(option.tag.id) : !selectedIds.length) && (
                      <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                    )}
                </button>
              ))}
              {!options.length && !loading && (
                <p role="status" className="px-3 py-6 text-center text-xs text-slate-500">
                  {t(attaching ? 'clipboard.allTagsAdded' : 'clipboard.noMatchingTags')}
                </p>
              )}
            </div>
          )}
          {managing && !deleteTarget && !loading && !matchingTags.length && (
            <p role="status" className="px-3 py-4 text-center text-xs text-slate-500">
              {t('clipboard.noMatchingTags')}
            </p>
          )}
          {actionError && (
            <p role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {t('clipboard.tagActionError')}
            </p>
          )}
          {onDelete && !managing && (
            <div className="border-t border-slate-200/70 p-2 dark:border-white/10">
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start text-slate-500"
                leftIcon={<Settings2 aria-hidden="true" className="h-3.5 w-3.5" />}
                disabled={busy}
                onClick={() => changeView(true)}
              >
                {t('clipboard.manageTags')}
              </Button>
            </div>
          )}
          {deleteTarget && (
            <div className="space-y-3 p-3" aria-busy={busy}>
              <p
                id={`${id}-delete-description`}
                className="break-words text-xs text-slate-600 dark:text-slate-300"
              >
                {t('clipboard.deleteTagConfirm', { name: deleteTarget.name })}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  ref={cancelDelete}
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDeleteTarget(null)
                    setActionError(false)
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  aria-describedby={`${id}-delete-description`}
                  isLoading={busy}
                  onClick={confirmDelete}
                >
                  {t('clipboard.deleteTag')}
                </Button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
