import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { executeClipboardOutput } from '../../shared/clipboardOutput'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { getPlatform, matchShortcut, parseAccelerator } from '../../shared/keyboard/shortcuts'
import type { ParameterRequest } from './ContributionParametersDialog'
import { schemaHasParameters } from './contributionParameters'
import { useTheme } from '../../shared/hooks/useTheme'

export type Transformer = {
  id: string
  label: string
  version: string
  parameterSchema?: Record<string, unknown>
  execution?: 'local' | 'capability_backed'
  consentRequired?: boolean
  httpOrigins?: string[]
  providers?: string[]
}
export type TransformPreview = {
  resultId: string
  outputs: Array<{ canonicalMimeType: string | null; byteLength: number }>
  model: RenderModel
}

export type TransformControls = {
  items: Transformer[]
  actions: ContextAction[]
  run: (id: string, parameters?: Record<string, unknown>) => Promise<void>
  runAction: (id: string, parameters?: Record<string, unknown>) => Promise<void>
  pinAction: (id: string, pinned: boolean) => Promise<void>
  openPicker: () => void
}

export type ContextAction = {
  id: string
  packageId: string
  sourceId?: string | null
  facetId?: string | null
  label: string
  icon: string | null
  iconSvg: string | null
  iconSvgDark: string | null
  iconScale: number
  placements: Array<'preview_toolbar' | 'action_menu'>
  effects: string[]
  execution: 'local' | 'capability_backed'
  available: boolean
  unavailableReason: string | null
  parameterSchema: Record<string, unknown>
  shortcut: string | null
  pinned: boolean
  consentRequired: boolean
  externalNavigationOrigins: string[]
  httpOrigins: string[]
  providers: string[]
}

// Shared between the toolbar's pinned/preview_toolbar icon buttons and the
// Transform & Actions picker, so an action pinned to the toolbar never also
// appears redundantly in the picker's Actions list.
export const splitExtensionActions = (actions: ContextAction[]) => {
  const toolbarActions = actions
    .filter(action => action.pinned || action.placements.includes('preview_toolbar'))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned))
    .slice(0, 2)
  const directIds = new Set(toolbarActions.map(action => action.id))
  const menuActions = actions.filter(
    action =>
      action.pinned ||
      action.placements.includes('action_menu') ||
      (action.placements.includes('preview_toolbar') && !directIds.has(action.id))
  )
  return { toolbarActions, menuActions }
}

type ActionInvocation = { token: string; expiresAt: number }

type ContextActionRunResponse =
  | {
      kind: 'output'
      preview: TransformPreview
      disposition: 'preview' | 'copy' | 'paste' | 'save_as_clip'
    }
  | { kind: 'open_https_url'; url: string }
  | { kind: 'notification'; level: string; message: string }
  | { kind: 'open_dialog' }
  | { kind: 'native_action' }

export const useTransformState = ({
  clipId,
  sourceId,
  basePresentation,
  onControls,
}: {
  clipId: string
  sourceId: string
  basePresentation: ClipPresentation | null
  onControls?: (controls: TransformControls | null) => void
}) => {
  const { appliedTheme } = useTheme()
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [items, setItems] = useState<Transformer[]>([])
  const [actions, setActions] = useState<ContextAction[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [activeTransformer, setActiveTransformer] = useState<Transformer | null>(null)
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parameterRequest, setParameterRequest] = useState<ParameterRequest | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const presentationKind = basePresentation?.activeView.presentationKind

  // A custom extension detail view is a native child webview that always
  // paints above the DOM, so any host overlay must ask it to hide first —
  // regardless of whether it's the transform/action picker or the parameter
  // request that can follow a selection, and regardless of what triggered it
  // (menu, pinned toolbar button, or keyboard shortcut).
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('clipsx-host-overlay', {
        detail: { open: Boolean(parameterRequest) || pickerOpen },
      })
    )
  }, [parameterRequest, pickerOpen])

  useEffect(() => {
    if (!presentationKind || !sourceId) return
    setPreview(null)
    setError(null)
    setActiveTransformer(null)
    void Promise.all([
      invoke<Transformer[]>('list_transformer_contributions', {
        clipId,
        sourceId,
        presentationKind,
      }),
      invoke<ContextAction[]>('list_context_actions', {
        clipId,
        sourceId,
        facetId: basePresentation?.activeView.facetId ?? null,
      }),
    ])
      .then(([transformers, contextualActions]) => {
        setItems(transformers)
        setActions(contextualActions)
      })
      .catch(() => {
        setItems([])
        setActions([])
      })
  }, [basePresentation?.activeView.facetId, presentationKind, clipId, sourceId])

  const run = useCallback(
    async (id: string, parameters?: Record<string, unknown>) => {
      const item = items.find(t => t.id === id)
      if (!item) return
      if (parameters === undefined && schemaHasParameters(item.parameterSchema)) {
        setParameterRequest({
          kind: 'transformer',
          id,
          label: item.label,
          schema: item.parameterSchema,
        })
        return
      }
      setBusy(item.id)
      setActiveTransformer(item)
      setError(null)
      setPreview(null)
      try {
        let invocationToken: string | null = null
        if (item.execution === 'capability_backed') {
          if (item.consentRequired) {
            const destinations = [
              ...(item.httpOrigins ?? []),
              ...(item.providers ?? []).map(provider => `Host provider: ${provider}`),
            ].join('\n')
            const approved = window.confirm(
              `${item.label} wants to send this clip's selected content to:\n\n${destinations}\n\nAllow this exact extension release?`
            )
            if (!approved) return
            await invoke('grant_extension_transformer_permissions', { transformerId: item.id })
          }
          const invocation = await invoke<ActionInvocation>(
            'issue_extension_transformer_invocation',
            { transformerId: item.id, clipId, sourceId }
          )
          invocationToken = invocation.token
        }
        const result = await invoke<TransformPreview>('create_transform_preview', {
          clipId,
          transformerId: item.id,
          sourceId,
          parameters: parameters ?? {},
          invocationToken,
        })
        setPreview(result)
      } catch (value) {
        setError(String(value))
      } finally {
        setBusy(null)
      }
    },
    [clipId, items, sourceId]
  )

  const runAction = useCallback(
    async (id: string, parameters?: Record<string, unknown>) => {
      const action = actions.find(item => item.id === id)
      if (!action || !action.available) return
      if (parameters === undefined && schemaHasParameters(action.parameterSchema)) {
        setParameterRequest({
          kind: 'action',
          id,
          label: action.label,
          schema: action.parameterSchema,
        })
        return
      }
      const actionSourceId = action.sourceId ?? sourceId
      const actionFacetId =
        action.sourceId === undefined
          ? (basePresentation?.activeView.facetId ?? null)
          : (action.facetId ?? null)
      setBusy(action.id)
      setError(null)
      try {
        let invocationToken: string | null = null
        if (
          action.execution === 'capability_backed' ||
          action.effects.includes('open_https_url') ||
          action.effects.includes('open_dialog') ||
          action.effects.includes('compose_email') ||
          action.effects.includes('dial_phone')
        ) {
          if (action.consentRequired) {
            const destinations = [
              ...action.externalNavigationOrigins,
              ...action.httpOrigins,
              ...action.providers.map(provider => `Host provider: ${provider}`),
            ].join('\n')
            const approved = window.confirm(
              `${action.label} wants to send this clip's selected content to:\n\n${destinations}\n\nAllow this exact extension release?`
            )
            if (!approved) {
              return
            }
            await invoke('grant_extension_action_permissions', { actionId: action.id })
          }
          const invocation = await invoke<ActionInvocation>('issue_extension_action_invocation', {
            actionId: action.id,
            clipId,
            sourceId: actionSourceId,
            facetId: actionFacetId,
          })
          invocationToken = invocation.token
        }
        const result = await invoke<ContextActionRunResponse>('run_context_action', {
          clipId,
          sourceId: actionSourceId,
          facetId: actionFacetId,
          actionId: action.id,
          parameters: parameters ?? {},
          invocationToken,
        })
        if (result.kind === 'notification') {
          window.dispatchEvent(
            new CustomEvent('clipsx-extension-action-notification', { detail: result })
          )
          return
        }
        if (result.kind === 'open_dialog') {
          const width = Math.min(Math.max(window.innerWidth - 48, 320), 960)
          const height = Math.min(Math.max(window.innerHeight - 96, 240), 720)
          await invoke('open_extension_custom_view', {
            rendererId: action.id,
            clipId,
            sourceId: actionSourceId,
            facetId: actionFacetId,
            theme: appliedTheme,
            locale,
            surface: 'dialog',
            x: Math.max(24, (window.innerWidth - width) / 2),
            y: Math.max(48, (window.innerHeight - height) / 2),
            width,
            height,
          })
          return
        }
        if (result.kind !== 'output') {
          return
        }
        if (result.disposition === 'preview') {
          setActiveTransformer({ id: action.id, label: action.label, version: '2.0.0' })
          setPreview(result.preview)
          return
        }
        if (result.disposition === 'save_as_clip') {
          await invoke('save_transform_result', { resultId: result.preview.resultId })
        } else {
          await executeClipboardOutput(result.disposition, {
            kind: 'transformed',
            resultId: result.preview.resultId,
          })
        }
      } catch (value) {
        window.dispatchEvent(
          new CustomEvent('clipsx-extension-action-notification', {
            detail: { level: 'error', message: String(value) },
          })
        )
      } finally {
        setBusy(null)
      }
    },
    [actions, appliedTheme, basePresentation?.activeView.facetId, clipId, locale, sourceId]
  )

  const pinAction = useCallback(async (id: string, pinned: boolean) => {
    await invoke('set_extension_action_pinned', { actionId: id, pinned })
    setActions(current =>
      current.map(action => (action.id === id ? { ...action, pinned } : action))
    )
  }, [])

  const openPicker = useCallback(() => setPickerOpen(true), [])

  useEffect(() => {
    onControls?.(
      items.length > 0 || actions.length > 0
        ? { items, actions, run, runAction, pinAction, openPicker }
        : null
    )
  }, [actions, items, onControls, openPicker, pinAction, run, runAction])

  useEffect(() => {
    const platform = getPlatform()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const action = actions.find(item => {
        if (!item.available || !item.shortcut) return false
        const shortcut = parseAccelerator(item.shortcut, platform)
        return shortcut ? matchShortcut(event, shortcut, platform) : false
      })
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      void runAction(action.id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [actions, runAction])

  const applyResult = async (action: 'copy' | 'save') => {
    if (!preview) return
    if (action === 'save') {
      await invoke('save_transform_result', { resultId: preview.resultId })
    } else {
      await executeClipboardOutput('copy', {
        kind: 'transformed',
        resultId: preview.resultId,
      })
    }
    setPreview(null)
  }

  return {
    items,
    actions,
    run,
    runAction,
    pinAction,
    busy,
    activeTransformer,
    preview,
    error,
    parameterRequest,
    cancelParameterRequest: () => setParameterRequest(null),
    submitParameters: (parameters: Record<string, unknown>) => {
      const request = parameterRequest
      setParameterRequest(null)
      if (!request) return
      void (request.kind === 'action'
        ? runAction(request.id, parameters)
        : run(request.id, parameters))
    },
    applyResult,
    dismissPreview: () => {
      setPreview(null)
      setActiveTransformer(null)
    },
    dismissError: () => {
      setError(null)
      setActiveTransformer(null)
    },
    pickerOpen,
    closePicker: () => setPickerOpen(false),
  }
}
