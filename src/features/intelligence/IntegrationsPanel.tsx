import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  Copy,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Button, Input, Select, Switch } from '../../shared/components/ui'
import { copyLiteralText } from '../../shared/clipboardOutput'
import type {
  ClipboardActivity,
  McpGrant,
  McpGrantSecret,
  McpIntegrationStatus,
} from '../recall/contracts.generated'
import { ModelSettingsPanel } from './ModelSettingsPanel'

const surface =
  'rounded-2xl border border-slate-200/70 bg-white/55 dark:border-white/10 dark:bg-white/[.025]'
type Template = 'codex' | 'claude' | 'other'

function CopyText({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        onClick={() => {
          setFailed(false)
          void copyLiteralText(value)
            .then(() => setCopied(true))
            .catch(() => setFailed(true))
        }}
      >
        {t(copied ? 'mcpWorkspace.copied' : 'desktopUi.copy')}
      </Button>
      {failed && (
        <p role="alert" className="text-xs text-red-600">
          {t('mcpWorkspace.copyFailed')}
        </p>
      )}
    </div>
  )
}

function SetupInstructions({
  endpoint,
  template,
  onTemplate,
}: {
  endpoint: string
  template: Template
  onTemplate: (value: Template) => void
}) {
  const { t } = useTranslation()
  const command =
    template === 'codex'
      ? `codex mcp add clipsx --url ${endpoint} --bearer-token-env-var CLIPSX_MCP_TOKEN`
      : JSON.stringify(
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
    <section className={`${surface} space-y-3 p-4`} aria-label={t('mcp.setup')}>
      <Select
        label={t('mcpWorkspace.assistantApp')}
        value={template}
        onChange={onTemplate}
        options={[
          { value: 'codex', label: 'Codex' },
          { value: 'claude', label: 'Claude Code' },
          { value: 'other', label: t('mcpWorkspace.other') },
        ]}
      />
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('mcp.setupHint')}</p>
      {template !== 'other' ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold">
              {t(template === 'codex' ? 'mcp.codex' : 'mcp.claude')}
            </h4>
            <CopyText key={command} value={command} label={t('mcpWorkspace.copySetup')} />
          </div>
          <pre className="max-h-64 overflow-auto rounded-xl bg-slate-100/80 p-3 text-xs dark:bg-slate-950/40">
            {command}
          </pre>
        </>
      ) : (
        <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <p>{t('mcp.generic')}</p>
          <code className="block break-all rounded-xl bg-slate-100/80 p-3 dark:bg-slate-950/40">
            {endpoint}
          </code>
        </div>
      )}
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('mcp.localOnly')}</p>
    </section>
  )
}

export const IntegrationsPanel = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<McpIntegrationStatus | null>(null)
  const [grants, setGrants] = useState<McpGrant[]>([])
  const [activity, setActivity] = useState<ClipboardActivity[]>([])
  const [view, setView] = useState('overview')
  const [template, setTemplate] = useState<Template>('codex')
  const [port, setPort] = useState('39389')
  const [name, setName] = useState('')
  const [canWrite, setCanWrite] = useState(false)
  const [secret, setSecret] = useState<McpGrantSecret | null>(null)
  const [testToken, setTestToken] = useState('')
  const [testResult, setTestResult] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState(false)
  const refresh = useCallback(async () => {
    const [next, clients, actions] = await Promise.all([
      invoke<McpIntegrationStatus>('mcp_integration_status'),
      invoke<McpGrant[]>('mcp_list_grants'),
      invoke<ClipboardActivity[]>('assistant_action_activity'),
    ])
    setStatus(next)
    setGrants(clients)
    setActivity(actions)
    return next
  }, [])
  useEffect(() => {
    void refresh()
      .then(next => setPort(String(next.configuration.port)))
      .catch(() => setError(true))
  }, [refresh])
  const perform = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(false)
    setTestResult(null)
    try {
      await operation()
      await refresh()
    } catch {
      setError(true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const navigate = (next: string) => {
    setView(next)
    setSecret(null)
    setTestToken('')
    setTestResult(null)
    setError(false)
    if (next === 'add') {
      setName('')
      setCanWrite(false)
      setTemplate('codex')
    } else if (next !== 'guide') setTemplate('other')
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
      setView(result.grant.id)
      setName('')
      setTestToken('')
    })
  const validPort = /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
  const endpoint = status?.endpoint ?? 'http://127.0.0.1:39389/mcp'
  const selected = grants.find(grant => grant.id === view)
  const activeGrants = grants.filter(grant => !grant.revoked)
  const mcpActivity = activity.filter(action => action.actorId.startsWith('mcp:'))
  const readTools = [
    'get_clipboard_status',
    'list_clipboard_filters',
    'search_clips',
    'read_clip',
    'read_clip_image',
  ]
  const writeTools = ['create_clip', 'organize_clips', 'undo_clipboard_action']

  return (
    <div role="tabpanel" aria-label={t('mcp.integrations')} className="space-y-4 text-sm">
      {view !== 'overview' && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
          onClick={() => navigate('overview')}
        >
          {t('mcpWorkspace.back')}
        </Button>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-300"
        >
          {t('mcp.operationFailed')}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void perform(refresh)}>
            {t('mcp.refresh')}
          </Button>
        </div>
      )}
      {view === 'overview' && (
        <>
          <header className="relative overflow-hidden rounded-2xl border border-violet-300/40 bg-linear-to-br from-violet-500/12 via-fuchsia-500/5 to-white/35 p-5 dark:border-violet-400/15 dark:to-white/[.02]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 ring-1 ring-violet-500/15 dark:text-violet-300">
                  <Plug className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t('mcpWorkspace.title')}
                  </h2>
                  <p className="mt-1 max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {t('mcp.description')}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<BookOpen className="h-3.5 w-3.5" />}
                onClick={() => navigate('guide')}
              >
                {t('mcpWorkspace.guide')}
              </Button>
            </div>
            <section
              aria-label={t('mcpWorkspace.server')}
              className="mt-5 space-y-3 rounded-2xl border border-slate-200/60 bg-slate-100/30 p-4 dark:border-white/10 dark:bg-slate-100/5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-2 w-2 rounded-full ${status?.state === 'running' ? 'bg-emerald-500' : status?.state === 'failed' ? 'bg-amber-500' : 'bg-slate-400'}`}
                  />
                  <span role="status" className="text-xs font-semibold">
                    {status
                      ? t(`mcp.state.${status.state as 'running' | 'disabled' | 'failed'}`)
                      : t('mcp.loading')}
                  </span>
                </div>
                <Switch
                  size="sm"
                  label={t('mcp.enabled')}
                  checked={status?.configuration.enabled ?? false}
                  disabled={busy || !status}
                  onChange={enabled =>
                    void perform(() =>
                      invoke('mcp_configure', {
                        configuration: { enabled, port: status!.configuration.port },
                      })
                    )
                  }
                />
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/50 px-3 py-1.5 dark:border-white/10 dark:bg-slate-950/20">
                <code
                  className="min-w-0 break-all text-xs text-slate-600 dark:text-slate-300"
                  aria-label={t('mcp.endpoint')}
                >
                  {endpoint}
                </code>
                <CopyText key={endpoint} value={endpoint} label={t('mcpWorkspace.copyEndpoint')} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('mcpWorkspace.localHint')}
              </p>
              {status?.diagnostic === 'port_unavailable' && (
                <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
                  {t('mcp.portUnavailable')}
                </p>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-medium text-slate-500 focus-visible:outline-violet-500">
                  {t('modelsWorkspace.advanced')}
                </summary>
                <div className="mt-3 flex flex-wrap items-end gap-2">
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
              </details>
            </section>
          </header>
          <section
            className={`${surface} overflow-hidden`}
            aria-label={t('mcpWorkspace.assistants')}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-white/10">
              <div>
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t('mcpWorkspace.assistants')}
                </h3>
                <p className="mt-1 text-xs text-slate-500">{t('mcpWorkspace.assistantsHint')}</p>
              </div>
              <Button
                size="sm"
                disabled={busy || !status}
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => navigate('add')}
              >
                {t('mcpWorkspace.add')}
              </Button>
            </div>
            {!activeGrants.length && (
              <div className="flex items-start gap-3 p-5">
                <Bot className="mt-0.5 h-5 w-5 shrink-0 text-violet-400" />
                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    {t('mcpWorkspace.emptyTitle')}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {t('mcpWorkspace.emptyDescription')}
                  </p>
                </div>
              </div>
            )}
            <ul className="divide-y divide-slate-200/60 dark:divide-white/5">
              {activeGrants.map(grant => (
                <li key={grant.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {grant.name}
                    </p>
                    <span className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-white/5 dark:text-slate-400">
                      {t(grant.canWrite ? 'mcpWorkspace.readOrganize' : 'mcp.readOnly')}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                    aria-label={t('mcpWorkspace.manageNamed', { name: grant.name })}
                    onClick={() => navigate(grant.id)}
                  >
                    {t('modelsWorkspace.manage')}
                  </Button>
                </li>
              ))}
            </ul>
            {grants.some(grant => grant.revoked) && (
              <details className="border-t border-slate-200/70 px-4 py-3 dark:border-white/10">
                <summary className="cursor-pointer text-xs text-slate-500">
                  {t('mcpWorkspace.revokedAccess')}
                </summary>
                <ul className="mt-2 space-y-2">
                  {grants
                    .filter(grant => grant.revoked)
                    .map(grant => (
                      <li
                        key={grant.id}
                        className="flex items-center justify-between gap-2 text-xs text-slate-500"
                      >
                        <span className="break-words">{grant.name}</span>
                        <span>{t('mcp.revoked')}</span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </section>
          <details className={`${surface} p-4`}>
            <summary className="cursor-pointer text-xs font-semibold text-slate-700 focus-visible:outline-violet-500 dark:text-slate-200">
              {t('mcpWorkspace.tools')}
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[false, true].map(write => (
                <div key={String(write)} className="space-y-2">
                  <p className="flex items-center gap-2 text-xs font-medium">
                    <ShieldCheck className="h-4 w-4 text-violet-500" />
                    {t(write ? 'mcpWorkspace.readOrganize' : 'mcp.readOnly')}
                  </p>
                  <p className="text-xs leading-5 text-slate-500">
                    {t(write ? 'mcpWorkspace.writeHelp' : 'mcpWorkspace.readHelp')}
                  </p>
                  <ul className="space-y-1">
                    {(write ? writeTools : readTools).map(tool => (
                      <li key={tool} className="text-[11px] text-slate-500">
                        <code>{tool}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{t('mcpWorkspace.safetyHint')}</p>
          </details>
          <details className={`${surface} p-4`}>
            <summary className="cursor-pointer text-xs font-semibold text-slate-700 focus-visible:outline-violet-500 dark:text-slate-200">
              {t('mcpWorkspace.activity')}
            </summary>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">{t('mcpWorkspace.activityHint')}</p>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => void perform(refresh)}
              >
                {t('mcp.refresh')}
              </Button>
            </div>
            {!mcpActivity.length && (
              <p className="mt-3 text-xs text-slate-500">{t('mcpWorkspace.noActivity')}</p>
            )}
            <ul className="mt-3 divide-y divide-slate-200/60 dark:divide-white/5">
              {mcpActivity.map(action => (
                <li
                  key={action.actionId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                >
                  <span>
                    {grants.find(grant => `mcp:${grant.id}` === action.actorId)?.name ??
                      t('mcpWorkspace.unknownAssistant')}{' '}
                    · {t(`mcp.action.${action.operation as 'create' | 'organize' | 'undo'}`)}
                  </span>
                  <time
                    className="text-slate-500"
                    dateTime={new Date(action.createdAt).toISOString()}
                  >
                    {new Date(action.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {view === 'guide' && (
        <ModelSettingsPanel
          title={t('mcpWorkspace.guide')}
          description={t('mcp.description')}
          icon={<BookOpen className="h-4 w-4" />}
          onClose={() => navigate('overview')}
        >
          <SetupInstructions endpoint={endpoint} template={template} onTemplate={setTemplate} />
        </ModelSettingsPanel>
      )}
      {view === 'add' && (
        <ModelSettingsPanel
          title={t('mcpWorkspace.add')}
          description={t('mcpWorkspace.addDescription')}
          icon={<Bot className="h-4 w-4" />}
          onClose={() => navigate('overview')}
        >
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault()
              if (!busy && name.trim()) void issue()
            }}
          >
            <fieldset className="space-y-4" disabled={busy}>
              <Select
                label={t('mcpWorkspace.assistantApp')}
                value={template}
                onChange={value => {
                  setTemplate(value)
                  if (!name || name === 'Codex' || name === 'Claude Code')
                    setName(value === 'other' ? '' : value === 'codex' ? 'Codex' : 'Claude Code')
                }}
                options={[
                  { value: 'codex', label: 'Codex' },
                  { value: 'claude', label: 'Claude Code' },
                  { value: 'other', label: t('mcpWorkspace.other') },
                ]}
              />
              <Input
                autoFocus
                required
                label={t('mcp.clientName')}
                value={name}
                onChange={setName}
                maxLength={128}
              />
              <div className={`${surface} space-y-3 p-4`}>
                <Switch
                  label={t('mcp.allowWrites')}
                  checked={canWrite}
                  onChange={setCanWrite}
                  disabled={busy}
                />
                <p className="text-xs leading-5 text-slate-500">
                  {t(canWrite ? 'mcpWorkspace.writeHelp' : 'mcpWorkspace.readHelp')}
                </p>
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => navigate('overview')}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                size="sm"
                isLoading={busy}
                disabled={!name.trim()}
                leftIcon={<KeyRound className="h-3.5 w-3.5" />}
              >
                {t('mcp.createGrant')}
              </Button>
            </div>
          </form>
        </ModelSettingsPanel>
      )}
      {selected && (
        <ModelSettingsPanel
          title={selected.name}
          description={t(
            selected.revoked
              ? 'mcp.revoked'
              : selected.canWrite
                ? 'mcpWorkspace.readOrganize'
                : 'mcp.readOnly'
          )}
          icon={<Bot className="h-4 w-4" />}
          onClose={() => navigate('overview')}
        >
          {!selected.revoked && (
            <>
              {secret?.grant.id === selected.id && (
                <section className="space-y-3 rounded-2xl border border-violet-300/50 bg-violet-500/5 p-4 dark:border-violet-400/20">
                  <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                    {t('mcp.showOnce')}
                  </p>
                  <Input
                    label={t('mcp.tokenFor', { name: selected.name })}
                    value={secret.token}
                    onChange={() => undefined}
                    readOnly
                    autoComplete="off"
                  />
                  <div className="flex gap-2">
                    <CopyText
                      key={secret.token}
                      value={secret.token}
                      label={t('mcpWorkspace.copyToken')}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
                      {t('mcp.dismiss')}
                    </Button>
                  </div>
                </section>
              )}
              <SetupInstructions endpoint={endpoint} template={template} onTemplate={setTemplate} />
              <section
                className={`${surface} space-y-3 p-4`}
                aria-label={t('mcpWorkspace.testAccess')}
              >
                <h4 className="text-xs font-semibold">{t('mcpWorkspace.testAccess')}</h4>
                <p className="text-xs leading-5 text-slate-500">{t('mcpWorkspace.testHelp')}</p>
                <Input
                  type="password"
                  label={t('mcp.testToken')}
                  value={testToken}
                  onChange={value => {
                    setTestToken(value)
                    setTestResult(null)
                  }}
                  autoComplete="off"
                  maxLength={128}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || status?.state !== 'running' || (!testToken && !secret)}
                  onClick={() =>
                    void perform(async () => {
                      const count = await invoke<number>('mcp_test_access', {
                        token: testToken || secret?.token,
                      })
                      setTestToken('')
                      setTestResult(count)
                    })
                  }
                >
                  {t('mcpWorkspace.testAccess')}
                </Button>
                {status?.state !== 'running' && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('mcpWorkspace.enableToTest')}
                  </p>
                )}
                {testResult !== null && (
                  <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
                    {t('mcpWorkspace.testPassed', { count: testResult })}
                  </p>
                )}
              </section>
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200/70 pt-4 dark:border-white/10">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void issue(selected)}
                >
                  {t('mcp.rotate')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 dark:text-red-400"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await invoke('mcp_revoke_grant', { id: selected.id })
                      setSecret(null)
                      setTestToken('')
                    })
                  }
                >
                  {t('mcp.revoke')}
                </Button>
              </div>
              <p className="text-xs text-slate-500">{t('mcpWorkspace.revokeHint')}</p>
            </>
          )}
        </ModelSettingsPanel>
      )}
    </div>
  )
}
