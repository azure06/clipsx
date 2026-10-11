import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { FileJson, ShieldCheck, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Switch } from '../../shared/components/ui'
import type {
  AiConfiguration,
  AiConfigurationState,
  AiSelections,
} from '../recall/contracts.generated'
import { ModelSettingsDialog } from './ModelSettingsDialog'
import { providerNames } from './modelConfiguration'

const selectionKeys: Array<keyof AiSelections> = [
  'defaultChat',
  'activeEmbedding',
  'extensionGeneration',
  'defaultDecision',
  'webSearch',
]
const labelKeys: Record<keyof AiSelections, string> = {
  defaultChat: 'modelsWorkspace.recall',
  activeEmbedding: 'aiConfig.activeEmbedding',
  extensionGeneration: 'modelsWorkspace.extensionGeneration',
  defaultDecision: 'modelsWorkspace.decision',
  webSearch: 'aiConfig.webConnection',
}

export function ConfigurationTransfer({
  mode,
  current,
  state,
  busy,
  error,
  perform,
  onClose,
  onImported,
}: {
  mode: 'import' | 'export'
  current: AiConfiguration
  state: AiConfigurationState
  busy: boolean
  error: string | null
  perform: (work: () => Promise<unknown>) => Promise<boolean>
  onClose: () => void
  onImported: () => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(current.connections.map(c => c.id))
  const [includeAssignments, setIncludeAssignments] = useState(mode === 'export')
  const [incoming, setIncoming] = useState<AiConfiguration | null>(null)
  const [preview, setPreview] = useState<AiConfiguration | null>(null)
  const [fileName, setFileName] = useState('')
  const changed = <T extends { id: string }>(before: T[], after: T[]) =>
    after.filter(
      item => JSON.stringify(before.find(v => v.id === item.id)) !== JSON.stringify(item)
    )
  const connections = preview ? changed(current.connections, preview.connections) : []
  const presets = preview ? changed(current.presets, preview.presets) : []
  const assignmentChanges = preview
    ? selectionKeys.filter(
        key => (current.selections[key] ?? null) !== (preview.selections[key] ?? null)
      )
    : []
  const assignmentName = (document: AiConfiguration, key: keyof AiSelections) =>
    document.presets.find(p => p.id === document.selections[key])?.name ??
    document.connections.find(c => c.id === document.selections[key])?.name ??
    t('aiConfig.none')
  const prepare = async (document: AiConfiguration, assignments: boolean) => {
    // Rust validates the complete file, including selections the user may choose not to apply.
    const validated = await invoke<AiConfiguration>('ai_configuration_preview', {
      configuration: document,
    })
    const effective = {
      ...document,
      version: 2,
      selections: assignments ? validated.selections : current.selections,
    }
    setPreview(
      await invoke<AiConfiguration>('ai_configuration_preview', { configuration: effective })
    )
    return document
  }
  return (
    <ModelSettingsDialog
      title={t(mode === 'import' ? 'modelsWorkspace.importTitle' : 'modelsWorkspace.exportTitle')}
      description={t('modelsWorkspace.transferHelp')}
      busy={busy}
      onClose={onClose}
    >
      <div className="space-y-4">
        {mode === 'export' ? (
          <>
            <div className="space-y-1 rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
              {current.connections.map(c => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg p-2 text-xs hover:bg-violet-500/5"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    disabled={busy}
                    className="accent-violet-500"
                    onChange={event =>
                      setSelected(
                        event.target.checked
                          ? [...selected, c.id]
                          : selected.filter(id => id !== c.id)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                    {c.name}
                  </span>
                  <span className="text-[10px] text-slate-400">{providerNames[c.provider]}</span>
                </label>
              ))}
            </div>
            <Switch
              label={t('modelsWorkspace.includeAssignments')}
              checked={includeAssignments}
              disabled={busy}
              onChange={setIncludeAssignments}
            />
            <p className="text-xs leading-5 text-slate-500">
              {t('modelsWorkspace.exportAssignmentsHelp')}
            </p>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              onClick={() =>
                void perform(async () => {
                  const path = await open({
                    multiple: false,
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                  })
                  if (!path) return
                  setIncoming(null)
                  setPreview(null)
                  setFileName('')
                  if ((await stat(path)).size > 1024 * 1024) throw new Error('input_limit')
                  const text = await readTextFile(path)
                  if (new TextEncoder().encode(text).length > 1024 * 1024)
                    throw new Error('input_limit')
                  const document = JSON.parse(text) as AiConfiguration
                  await prepare(document, includeAssignments)
                  setIncoming(document)
                  setFileName(path.split(/[\\/]/).at(-1) ?? '')
                })
              }
            >
              {t('modelsWorkspace.chooseFile')}
            </Button>
            {fileName && (
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <FileJson className="h-4 w-4 text-violet-500" />
                {fileName}
              </p>
            )}
            {incoming && (
              <Switch
                label={t('modelsWorkspace.applyAssignments')}
                checked={includeAssignments}
                disabled={busy}
                onChange={value =>
                  void perform(async () => {
                    await prepare(incoming, value)
                    setIncludeAssignments(value)
                  })
                }
              />
            )}
            {preview && (
              <div className="space-y-3 rounded-xl border border-slate-200/70 bg-white/50 p-4 text-xs dark:border-white/10 dark:bg-white/[.025]">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200">
                  {t('modelsWorkspace.previewTitle')}
                </h3>
                <p className="text-slate-500">
                  {t('modelsWorkspace.previewCounts', {
                    connections: connections.length,
                    models: presets.length,
                  })}
                </p>
                {connections.map(c => (
                  <div key={c.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-700 dark:text-slate-200">
                        {c.name}{' '}
                        <span className="font-normal text-slate-400">
                          ·{' '}
                          {t(
                            current.connections.some(v => v.id === c.id)
                              ? 'modelsWorkspace.update'
                              : 'modelsWorkspace.add'
                          )}
                        </span>
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">
                        {c.baseUrl}
                      </p>
                    </div>
                    {c.provider !== 'ollama' &&
                      !state.connectionStates.some(
                        v => v.connectionId === c.id && v.credentialConfigured
                      ) && (
                        <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-300">
                          {t('modelsWorkspace.needsCredential')}
                        </span>
                      )}
                  </div>
                ))}
                {presets.map(p => (
                  <p key={p.id} className="break-all text-slate-500">
                    {p.name}{' '}
                    <span className="font-mono text-[10px] text-slate-400">· {p.modelId}</span>
                  </p>
                ))}
                <div className="border-t border-slate-200/70 pt-3 dark:border-white/10">
                  <p className="font-medium text-slate-600 dark:text-slate-300">
                    {t(
                      assignmentChanges.length
                        ? 'modelsWorkspace.assignmentChanges'
                        : 'modelsWorkspace.assignmentsUnchanged'
                    )}
                  </p>
                  {assignmentChanges.map(key => (
                    <p key={key} className="mt-1 text-slate-500">
                      {t(labelKeys[key], { defaultValue: labelKeys[key] })}:{' '}
                      {assignmentName(current, key)} → {assignmentName(preview, key)}
                    </p>
                  ))}
                </div>
                <p className="text-[10px] leading-4 text-slate-400">
                  {t('modelsWorkspace.mergeHelp')}
                </p>
              </div>
            )}
          </>
        )}
        <p className="flex items-start gap-2 text-[10px] leading-4 text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('modelsWorkspace.transferPrivacy')}
        </p>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-4 dark:border-white/10">
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {mode === 'export' ? (
            <Button
              size="sm"
              isLoading={busy}
              disabled={!selected.length}
              onClick={() =>
                void perform(async () => {
                  const document = await invoke<AiConfiguration>('ai_configuration_export')
                  const connections = document.connections.filter(c => selected.includes(c.id))
                  const presets = document.presets.filter(p => selected.includes(p.connectionId))
                  const selections = Object.fromEntries(
                    selectionKeys.map(key => [
                      key,
                      includeAssignments &&
                      (key === 'webSearch' ? connections : presets).some(
                        v => v.id === document.selections[key]
                      )
                        ? document.selections[key]
                        : null,
                    ])
                  ) as AiSelections
                  const path = await save({
                    defaultPath: 'clipsx-models.json',
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                  })
                  if (!path) return
                  await writeTextFile(
                    path,
                    JSON.stringify(
                      { ...document, version: 2, connections, presets, selections },
                      null,
                      2
                    )
                  )
                  onClose()
                })
              }
            >
              {t('modelsWorkspace.saveFile')}
            </Button>
          ) : (
            <Button
              size="sm"
              isLoading={busy}
              disabled={!incoming || !preview}
              onClick={() =>
                void (async () => {
                  if (!incoming || !preview) return
                  if (
                    await perform(async () => {
                      const latest = await invoke<AiConfiguration>('ai_configuration_export')
                      await invoke('ai_configuration_import', {
                        configuration: {
                          ...incoming,
                          version: 2,
                          selections: includeAssignments ? preview.selections : latest.selections,
                        },
                      })
                    })
                  )
                    onImported()
                })()
              }
            >
              {t('modelsWorkspace.confirmImport')}
            </Button>
          )}
        </div>
      </div>
    </ModelSettingsDialog>
  )
}
