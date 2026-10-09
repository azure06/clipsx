import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button, Input, Switch } from '../../shared/components/ui'
import type {
  ClipboardActivity,
  McpGrant,
  McpGrantSecret,
  McpIntegrationStatus,
} from '../recall/contracts.generated'

export const IntegrationsPanel = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<McpIntegrationStatus | null>(null)
  const [grants, setGrants] = useState<McpGrant[]>([])
  const [activity, setActivity] = useState<ClipboardActivity[]>([])
  const [port, setPort] = useState('39389')
  const [name, setName] = useState('')
  const [canWrite, setCanWrite] = useState(false)
  const [secret, setSecret] = useState<McpGrantSecret | null>(null)
  const [testToken, setTestToken] = useState('')
  const [testResult, setTestResult] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const refresh = useCallback(async () => {
    const [status, grants, activity] = await Promise.all([
      invoke<McpIntegrationStatus>('mcp_integration_status'),
      invoke<McpGrant[]>('mcp_list_grants'),
      invoke<ClipboardActivity[]>('assistant_action_activity'),
    ])
    setStatus(status)
    setGrants(grants)
    setActivity(activity)
    return status
  }, [])
  useEffect(() => {
    void refresh()
      .then(status => setPort(String(status.configuration.port)))
      .catch(() => setError(true))
  }, [refresh])
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await operation()
      await refresh()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const issue = (grant?: McpGrant) =>
    perform(async () => {
      setSecret(null)
      const result = await invoke<McpGrantSecret>('mcp_issue_grant', {
        name: grant?.name ?? name.trim(),
        canWrite: grant?.canWrite ?? canWrite,
        rotateId: grant?.id ?? null,
      })
      setSecret(result)
      setName('')
      setTestResult(null)
    })
  const validPort = /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
  const endpoint = status?.endpoint ?? 'http://127.0.0.1:39389/mcp'
  const codex = `codex mcp add clipsx --url ${endpoint} --bearer-token-env-var CLIPSX_MCP_TOKEN`
  const claude = JSON.stringify(
    {
      mcpServers: {
        clipsx: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: 'Bearer ${CLIPSX_MCP_TOKEN}' },
        },
      },
    },
    null,
    2
  )
  return (
    <div
      role="tabpanel"
      className="space-y-5 rounded-xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-800 dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('mcp.title')}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('mcp.description')}</p>
        </div>
        <Switch
          size="sm"
          label={t('mcp.enabled')}
          checked={status?.configuration.enabled ?? false}
          disabled={busy || !status || !validPort}
          onChange={enabled =>
            void perform(() =>
              invoke('mcp_configure', { configuration: { enabled, port: Number(port) } })
            )
          }
        />
      </div>
      <p role="status">
        {!status
          ? t('mcp.loading')
          : t(`mcp.state.${status.state as 'running' | 'disabled' | 'failed'}`)}
      </p>
      {status?.diagnostic === 'port_unavailable' && (
        <p role="alert" className="text-amber-700 dark:text-amber-300">
          {t('mcp.portUnavailable')}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-red-600 dark:text-red-300"
        >
          {t('mcp.operationFailed')}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void perform(refresh)}>
            {t('mcp.refresh')}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          label={t('mcp.port')}
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={setPort}
          disabled={busy}
          className="w-28"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !status || !validPort}
          onClick={() =>
            void perform(() =>
              invoke('mcp_configure', {
                configuration: {
                  enabled: status?.configuration.enabled ?? false,
                  port: Number(port),
                },
              })
            )
          }
        >
          {t('mcp.apply')}
        </Button>
      </div>
      <Input label={t('mcp.endpoint')} value={endpoint} onChange={() => undefined} readOnly />
      <form
        className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4 dark:border-white/10"
        onSubmit={event => {
          event.preventDefault()
          void issue()
        }}
      >
        <Input
          label={t('mcp.clientName')}
          value={name}
          onChange={setName}
          maxLength={128}
          disabled={busy}
          className="min-w-40 flex-1"
        />
        <Switch
          size="sm"
          label={t('mcp.allowWrites')}
          checked={canWrite}
          onChange={setCanWrite}
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {t('mcp.createGrant')}
        </Button>
      </form>
      {secret && (
        <div className="space-y-2 rounded-lg border border-violet-300 p-3 dark:border-violet-500/40">
          <p className="text-xs">{t('mcp.showOnce')}</p>
          <Input
            label={t('mcp.tokenFor', { name: secret.grant.name })}
            value={secret.token}
            onChange={() => undefined}
            readOnly
            autoComplete="off"
          />
          <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
            {t('mcp.dismiss')}
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        {grants.map(grant => (
          <li
            key={grant.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-white/10"
          >
            <span className="min-w-24 flex-1 break-words font-medium">{grant.name}</span>
            <span className="text-xs text-slate-500">
              {grant.revoked
                ? t('mcp.revoked')
                : grant.canWrite
                  ? t('mcp.readWrite')
                  : t('mcp.readOnly')}
            </span>
            {!grant.revoked && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void issue(grant)}
                >
                  {t('mcp.rotate')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await invoke('mcp_revoke_grant', { id: grant.id })
                      if (secret?.grant.id === grant.id) setSecret(null)
                    })
                  }
                >
                  {t('mcp.revoke')}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-white/10">
        <Input
          type="password"
          label={t('mcp.testToken')}
          value={testToken}
          onChange={value => {
            setTestToken(value)
            setTestResult(null)
          }}
          autoComplete="off"
          disabled={busy}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || status?.state !== 'running' || (!testToken && !secret)}
          onClick={() =>
            void perform(async () => {
              setTestResult(null)
              setTestResult(
                await invoke<number>('mcp_test_access', { token: testToken || secret?.token })
              )
              setTestToken('')
            })
          }
        >
          {t('mcp.testConnection')}
        </Button>
        {testResult !== null && (
          <p role="status" className="text-xs">
            {t('mcp.testPassed', { count: testResult })}
          </p>
        )}
      </div>
      <details>
        <summary className="cursor-pointer font-medium focus-visible:outline-violet-500">
          {t('mcp.setup')}
        </summary>
        <div className="mt-3 space-y-3 text-xs">
          <p>{t('mcp.setupHint')}</p>
          <p className="font-semibold">{t('mcp.codex')}</p>
          <pre className="overflow-auto rounded-lg bg-slate-100 p-3 dark:bg-slate-800">{codex}</pre>
          <p className="font-semibold">{t('mcp.claude')}</p>
          <pre className="overflow-auto rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            {claude}
          </pre>
          <p>{t('mcp.generic')}</p>
          <p>{t('mcp.localOnly')}</p>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-medium focus-visible:outline-violet-500">
          {t('mcp.activity')}
        </summary>
        <ul className="mt-2 space-y-2 text-xs">
          {activity.map(action => (
            <li key={action.actionId} className="flex flex-wrap justify-between gap-2">
              <span>
                {t(`mcp.action.${action.operation as 'create' | 'organize' | 'undo'}`)} ·{' '}
                {action.actorId} · {new Date(action.createdAt).toLocaleString()}
              </span>
              {action.undoAvailable && action.actorId === 'clipsx' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      invoke('assistant_undo_action', {
                        request: { requestId: crypto.randomUUID(), actionId: action.actionId },
                      })
                    )
                  }
                >
                  {t('mcp.undo')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
