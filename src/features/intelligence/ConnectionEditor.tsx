import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import type { AiConnection } from '../recall/contracts.generated'
import { endpoints, providerNames } from './modelConfiguration'
import { ModelSettingsPanel } from './ModelSettingsPanel'
import { ProviderIcon } from './ProviderIcon'
import { connectionFailureMessage } from './connectionFailure'

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
  const [connection, updateConnection] = useState(initial)
  const [credential, updateCredential] = useState('')
  const [testing, setTesting] = useState(false)
  const testingRef = useRef(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const setConnection = (value: AiConnection) => {
    updateConnection(value)
    setTestResult(null)
    setTestError(null)
  }
  const setCredential = (value: string) => {
    updateCredential(value)
    setTestResult(null)
    setTestError(null)
  }
  const pending = busy || testing
  const draft = () => ({
    ...connection,
    name: connection.name.trim(),
    baseUrl: connection.baseUrl.trim(),
  })
  const testConnection = async () => {
    if (testingRef.current || busy) return
    testingRef.current = true
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const count = await invoke<number>('ai_test_connection', {
        connection: draft(),
        credential: credential || null,
      })
      setTestResult(t('modelsWorkspace.connectionTestPassed', { count }))
    } catch (failure) {
      setTestError(connectionFailureMessage(failure, t))
    } finally {
      testingRef.current = false
      setTesting(false)
    }
  }
  return (
    <ModelSettingsPanel
      icon={<ProviderIcon provider={connection.provider} />}
      title={t(saved ? 'modelsWorkspace.editProvider' : 'modelsWorkspace.addProvider')}
      description={t('modelsWorkspace.connectionDescription')}
      onClose={onClose}
      busy={pending}
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          if (!pending) void onSave(draft(), credential)
        }}
      >
        <fieldset disabled={pending} className="space-y-4">
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
              disabled={saved || pending}
              options={Object.entries(providerNames).map(([value, label]) => ({
                value: value as AiConnection['provider'],
                label,
              }))}
              onChange={provider => {
                setCredential('')
                setConnection({
                  ...connection,
                  provider,
                  baseUrl: endpoints[provider],
                  options: { organization: null, project: null },
                })
              }}
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
            maxLength={8192}
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
        {testResult && (
          <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
            {testResult}
          </p>
        )}
        {testError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {testError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200/70 pt-4 dark:border-white/10">
          {connection.provider !== 'tavily' && (
            <Button
              variant="outline"
              size="sm"
              isLoading={testing}
              disabled={busy || !connection.name.trim() || !connection.baseUrl.trim()}
              onClick={() => void testConnection()}
            >
              {t('modelsWorkspace.testConnection')}
            </Button>
          )}
          {credentialConfigured && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTestResult(null)
                setTestError(null)
                void onRemoveCredential()
              }}
            >
              {t('aiConfig.removeCredential')}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            isLoading={busy}
            disabled={testing || !connection.name.trim() || !connection.baseUrl.trim()}
          >
            {t('aiConfig.saveConnection')}
          </Button>
        </div>
      </form>
    </ModelSettingsPanel>
  )
}
