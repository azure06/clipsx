import * as Popover from '@radix-ui/react-popover'
import { Check, Plus, Search, Tags, Trash2 } from 'lucide-react'
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
  onDelete?: (id: string) => Promise<void>
}
export function TagPicker({ trigger, selectedIds, onChoose, onCreate, onDelete }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const tags = useClipboardStore(state => state.availableTags)
  const loading = useClipboardStore(state => state.tagsLoading)
  const loadError = useClipboardStore(state => state.tagsError)
  const refresh = useClipboardStore(state => state.refreshAvailableTags)
  const attaching = Boolean(onCreate)
  const normalized = query.trim().toLowerCase()
  const selected = tags.find(tag => selectedIds.includes(tag.id))
  const options: { tag: V2Tag | null; create?: boolean; label: string }[] = [
    ...(!attaching && !normalized ? [{ tag: null, label: t('clipboard.allTags') }] : []),
    ...tags
      .filter(
        tag =>
          (!attaching || !selectedIds.includes(tag.id)) &&
          tag.name.toLowerCase().includes(normalized)
      )
      .map(tag => ({ tag, label: tag.name })),
    ...(attaching && normalized && !tags.some(tag => tag.name.toLowerCase() === normalized)
      ? [{ tag: null, create: true, label: t('clipboard.createTag', { name: query.trim() }) }]
      : []),
  ]
  const active = Math.min(activeIndex, Math.max(0, options.length - 1))
  useEffect(() => {
    if (open && !busy) input.current?.focus()
  }, [open, busy])
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
    }
  }, [open])
  const run = async (action: () => Promise<void>, close = false) => {
    if (busy) return
    setBusy(true)
    setActionError(false)
    try {
      await action()
      setQuery('')
      setActiveIndex(0)
      setConfirmDelete(false)
      if (close) setOpen(false)
      else input.current?.focus()
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }
  const choose = (index: number) => {
    const option = options[index]
    if (option)
      void run(
        () => (option.create && onCreate ? onCreate(normalized) : onChoose(option.tag)),
        !attaching
      )
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={next => {
        if (busy) return
        setOpen(next)
        if (next) {
          setQuery('')
          setActiveIndex(0)
          setActionError(false)
          setConfirmDelete(false)
          void refresh()
        }
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={t(attaching ? 'clipboard.addTag' : 'clipboard.filterByTag')}
          sideOffset={8}
          collisionPadding={12}
          align="start"
          className={cn(dropdownSurfaceClass, 'z-[80] w-72 max-w-[calc(100vw-1.5rem)]')}
          onOpenAutoFocus={event => {
            event.preventDefault()
            input.current?.focus()
          }}
          onKeyDown={event => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-slate-200/70 px-3 dark:border-white/10">
            <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={input}
              value={query}
              role="combobox"
              aria-label={t(attaching ? 'clipboard.findOrCreateTag' : 'clipboard.searchTags')}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={options.length ? `${id}-option-${active}` : undefined}
              disabled={busy}
              placeholder={t(attaching ? 'clipboard.tagPlaceholder' : 'clipboard.searchTags')}
              className="min-w-0 flex-1 bg-transparent py-3 text-xs outline-none placeholder:text-slate-400 disabled:opacity-50"
              onChange={event => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
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
          {loading && (
            <p role="status" className="px-3 py-2 text-xs text-slate-500">
              {t('clipboard.loadingTags')}
            </p>
          )}
          {loadError && (
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
          {actionError && (
            <p role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {t('clipboard.tagActionError')}
            </p>
          )}
          {onDelete && selected && (
            <div className="border-t border-slate-200/70 p-2 dark:border-white/10">
              {confirmDelete ? (
                <div className="space-y-2 p-1">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {t('clipboard.deleteTagConfirm', { name: selected.name })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      isLoading={busy}
                      onClick={() => void run(() => onDelete(selected.id), true)}
                    >
                      {t('clipboard.deleteTag')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start text-slate-500"
                  leftIcon={<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('clipboard.deleteTag')}
                </Button>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
