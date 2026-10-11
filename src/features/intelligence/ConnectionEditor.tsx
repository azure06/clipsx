import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import type { AiConnection } from '../recall/contracts.generated'
import { endpoints, providerNames } from './modelConfiguration'
import { ModelSettingsDialog } from './ModelSettingsDialog'

export function ConnectionEditor({
  initial,
  saved,
  credentialConfigured,
  busy,
  error,
  onSave,
  onRemoveCredential,
  onClose,
}: {
  initial: AiConnection
  saved: boolean
  credentialConfigured: boolean
  busy: boolean
  error: string | null
  onSave: (connection: AiConnection, credential: string) => Promise<void>
  onRemoveCredential: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [connection, setConnection] = useState(initial)
  const [credential, setCredential] = useState('')
  return (
    <ModelSettingsDialog
      title={t(saved ? 'modelsWorkspace.editProvider' : 'modelsWorkspace.addProvider')}
      description={t('modelsWorkspace.connectionDescription')}
      onClose={onClose}
      busy={busy}
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          const value = credential
          setCredential('')
          void onSave(
            { ...connection, name: connection.name.trim(), baseUrl: connection.baseUrl.trim() },
            value
          )
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              required
              autoFocus
              label={t('aiConfig.name')}
              value={connection.name}
              maxLength={128}
              onChange={name => setConnection({ ...connection, name })}
            />
            <Select
              label={t('aiConfig.provider')}
              value={connection.provider}
              disabled={saved}
              options={Object.entries(providerNames).map(([value, label]) => ({
                value: value as AiConnection['provider'],
                label,
              }))}
              onChange={provider =>
                setConnection({
                  ...connection,
                  provider,
                  baseUrl: endpoints[provider],
                  options: { organization: null, project: null },
                })
              }
            />
          </div>
          <Input
            required
            label={t('aiConfig.endpoint')}
            value={connection.baseUrl}
            maxLength={2048}
            onChange={baseUrl => setConnection({ ...connection, baseUrl })}
          />
          <Input
            label={t('aiConfig.credential')}
            type="password"
            autoComplete="new-password"
            value={credential}
            onChange={setCredential}
            helperText={t(
              credentialConfigured ? 'aiConfig.credentialSaved' : 'aiConfig.credentialHelp'
            )}
          />
          {connection.provider === 'openai' && (
            <details className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">
                {t('modelsWorkspace.advanced')}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  label={t('aiConfig.organization')}
                  value={connection.options.organization ?? ''}
                  maxLength={128}
                  onChange={organization =>
                    setConnection({
                      ...connection,
                      options: { ...connection.options, organization: organization || null },
                    })
                  }
                />
                <Input
                  label={t('aiConfig.project')}
                  value={connection.options.project ?? ''}
                  maxLength={128}
                  onChange={project =>
                    setConnection({
                      ...connection,
                      options: { ...connection.options, project: project || null },
                    })
                  }
                />
              </div>
            </details>
          )}
          <Switch
            label={t('aiConfig.enabled')}
            checked={connection.enabled}
            onChange={enabled => setConnection({ ...connection, enabled })}
          />
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200/70 pt-4 dark:border-white/10">
          {credentialConfigured && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void onRemoveCredential()}
            >
              {t('aiConfig.removeCredential')}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            isLoading={busy}
            disabled={!connection.name.trim() || !connection.baseUrl.trim()}
          >
            {t('aiConfig.saveConnection')}
          </Button>
        </div>
      </form>
    </ModelSettingsDialog>
  )
}
