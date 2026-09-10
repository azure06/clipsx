import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Check, Keyboard, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../shared/components/ui'
import {
  getPlatform,
  getShortcutChips,
  getShortcutFromKeyboardEvent,
  parseAccelerator,
  toAccelerator,
} from '../../../shared/keyboard/shortcuts'
import { loadCommandBindings } from '../../../shared/keyboard/commands'
import { PROFILE_MUTATED_EVENT, SYNC_APPLIED_EVENT } from '../../../shared/sync/configSync'

type Command = {
  id: string
  labelKey: string
  defaultShortcut: string | null
  effectiveShortcut: string | null
}
const portable = (event: KeyboardEvent) => {
  const value = toAccelerator(getShortcutFromKeyboardEvent(event))
  const prefix = getPlatform() === 'macos' ? 'Cmd+' : 'Ctrl+'
  return value.startsWith(prefix) ? `Primary+${value.slice(prefix.length)}` : value
}
const Chips = ({ value }: { value: string | null }) => {
  const chips = getShortcutChips(value ? parseAccelerator(value) : null)
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {chips.map((chip, index) => (
        <kbd
          key={`${chip}-${index}`}
          className="rounded-md border border-slate-300/80 bg-white/75 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 shadow-sm dark:border-white/15 dark:bg-white/[0.06] dark:text-slate-200"
        >
          {chip}
        </kbd>
      ))}
    </span>
  )
}

export function CommandShortcuts() {
  const { t } = useTranslation()
  const [commands, setCommands] = useState<Command[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<{ id: string; value: string | null } | null>(null)
  const [recording, setRecording] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    const [values, catalog] = await Promise.all([
      loadCommandBindings(),
      invoke<Command[]>('get_command_catalog'),
    ])
    setOverrides(values)
    setCommands(catalog)
  }
  useEffect(() => {
    const reload = () => void load().catch(() => setError(t('commands.loadFailed')))
    reload()
    window.addEventListener(SYNC_APPLIED_EVENT, reload)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, reload)
  }, [t])
  const save = async (id: string, value: string | null) => {
    setBusy(id)
    setError(null)
    try {
      await invoke('set_command_shortcut', { commandId: id, accelerator: value })
      await load()
      setDraft(null)
      setRecording(null)
      window.dispatchEvent(new Event(PROFILE_MUTATED_EVENT))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/55 dark:border-white/10 dark:bg-black/10">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-200/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:border-white/10">
        <span>{t('commands.action')}</span>
        <span>{t('commands.binding')}</span>
      </div>
      <div className="divide-y divide-slate-200/70 dark:divide-white/10">
        {commands.map(command => {
          const custom = overrides[command.id] != null,
            editing = draft?.id === command.id,
            value = editing ? draft.value : command.effectiveShortcut
          const number = command.id.startsWith('core.quick_slot_')
            ? command.id.slice('core.quick_slot_'.length)
            : undefined
          const label = t(command.labelKey as 'commands.title', { number })
          return (
            <div
              key={command.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(14rem,auto)] items-center gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {custom ? t('commands.custom') : t('commands.default')}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  aria-label={t('commands.record', { action: label })}
                  aria-pressed={recording === command.id}
                  onClick={() => {
                    setDraft({ id: command.id, value })
                    setRecording(command.id)
                    setError(null)
                  }}
                  onKeyDown={event => {
                    if (recording !== command.id) return
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setRecording(null)
                      setDraft(null)
                      return
                    }
                    if (event.key === 'Tab') {
                      setRecording(null)
                      return
                    }
                    event.preventDefault()
                    if (getShortcutFromKeyboardEvent(event.nativeEvent).key) {
                      setDraft({ id: command.id, value: portable(event.nativeEvent) })
                      setRecording(null)
                    }
                  }}
                  className={`flex min-h-9 min-w-36 items-center justify-center rounded-lg border px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500/50 ${recording === command.id ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-slate-200 bg-white/70 hover:border-violet-300 dark:border-white/10 dark:bg-white/[0.04]'}`}
                >
                  {recording === command.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <Keyboard className="h-3.5 w-3.5" />
                      {t('commands.pressKeys')}
                    </span>
                  ) : (
                    <Chips value={value} />
                  )}
                </button>
                {editing && recording !== command.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy === command.id || !draft.value}
                      onClick={() => void save(command.id, draft.value)}
                      leftIcon={<Check className="h-3.5 w-3.5" />}
                    >
                      {t('common.save')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft(null)}
                      aria-label={t('common.cancel')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : custom ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === command.id}
                    onClick={() => void save(command.id, null)}
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                  >
                    {t('commands.reset')}
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {error && (
        <p
          role="alert"
          className="border-t border-red-200 bg-red-50/70 px-4 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  )
}
