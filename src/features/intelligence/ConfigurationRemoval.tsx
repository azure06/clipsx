import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Button } from '../../shared/components/ui'

export type RemovalTarget = { kind: 'connection' | 'preset'; id: string; name: string }

export function ConfigurationRemoval({
  target,
  affectedFeatures,
  modelCount,
  busy,
  onCancel,
  onConfirm,
}: {
  target: RemovalTarget
  affectedFeatures: string[]
  modelCount: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const { t } = useTranslation()
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
  }, [])
  return (
    <section
      role="region"
      aria-labelledby="configuration-removal-title"
      className="space-y-3 rounded-2xl border border-red-300/50 bg-red-500/5 p-5 dark:border-red-400/20"
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <h3
        id="configuration-removal-title"
        className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        <Trash2 className="h-4 w-4 text-red-500" />
        {t('modelsWorkspace.removeTitle', { name: target.name })}
      </h3>
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        {t(
          target.kind === 'connection'
            ? 'modelsWorkspace.removeProviderHelp'
            : 'modelsWorkspace.removeModelHelp',
          { count: modelCount }
        )}
      </p>
      {affectedFeatures.length > 0 && (
        <div className="rounded-xl bg-white/50 p-3 text-xs dark:bg-white/5">
          <p className="font-medium text-slate-700 dark:text-slate-200">
            {t('modelsWorkspace.removeAssignments')}
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-500 dark:text-slate-400">
            {affectedFeatures.map(name => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        {t('modelsWorkspace.removePreservesData')}
      </p>
      <div className="flex justify-end gap-2">
        <Button ref={cancel} size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" variant="destructive" isLoading={busy} onClick={() => void onConfirm()}>
          {t('modelsWorkspace.confirmRemove')}
        </Button>
      </div>
    </section>
  )
}
