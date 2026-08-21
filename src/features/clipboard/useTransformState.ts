import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { executeClipboardOutput } from '../../shared/clipboardOutput'
import type { ClipPresentation, RenderModel } from '../../shared/types/v2'
import { getPlatform, matchShortcut, parseAccelerator } from '../../shared/keyboard/shortcuts'

export type Transformer = { id: string; label: string; version: string }
export type TransformPreview = { resultId: string; model: RenderModel }

export type TransformControls = {
  items: Transformer[]
  actions: ContextAction[]
  run: (id: string) => Promise<void>
  runAction: (id: string) => Promise<void>
  pinAction: (id: string, pinned: boolean) => Promise<void>
}

export type ContextAction = {
  id: string
  packageId: string
  label: string
  icon: string | null
  iconSvg: string | null
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
  const [items, setItems] = useState<Transformer[]>([])
  const [actions, setActions] = useState<ContextAction[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [activeTransformer, setActiveTransformer] = useState<Transformer | null>(null)
  const [preview, setPreview] = useState<TransformPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const presentationKind = basePresentation?.activeView.presentationKind

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
    async (id: string) => {
      const item = items.find(t => t.id === id)
      if (!item) return
      setBusy(item.id)
      setActiveTransformer(item)
      setError(null)
      setPreview(null)
      try {
        const result = await invoke<TransformPreview>('create_transform_preview', {
          clipId,
          transformerId: item.id,
          sourceId,
          parameters: {},
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
    async (id: string) => {
      const action = actions.find(item => item.id === id)
      if (!action || !action.available) return
      setBusy(action.id)
      setActiveTransformer({ id: action.id, label: action.label, version: '2.0.0' })
      setError(null)
      setPreview(null)
      try {
        let invocationToken: string | null = null
        if (action.effects.includes('open_https_url')) {
          if (action.consentRequired) {
            const destinations = action.externalNavigationOrigins.join('\n')
            const approved = window.confirm(
              `${action.label} wants to send this clip's selected content to:\n\n${destinations}\n\nAllow this exact extension release?`
            )
            if (!approved) {
              setActiveTransformer(null)
              return
            }
            await invoke('grant_extension_action_permissions', { actionId: action.id })
          }
          const invocation = await invoke<ActionInvocation>('issue_extension_action_invocation', {
            actionId: action.id,
            clipId,
            sourceId,
            facetId: basePresentation?.activeView.facetId ?? null,
          })
          invocationToken = invocation.token
        }
        const result = await invoke<ContextActionRunResponse>('run_context_action', {
          clipId,
          sourceId,
          facetId: basePresentation?.activeView.facetId ?? null,
          actionId: action.id,
          parameters: {},
          invocationToken,
        })
        if (result.kind === 'notification') {
          window.dispatchEvent(
            new CustomEvent('clipsx-extension-action-notification', { detail: result })
          )
          setActiveTransformer(null)
          return
        }
        if (result.kind === 'open_dialog') {
          const width = Math.min(Math.max(window.innerWidth - 48, 320), 960)
          const height = Math.min(Math.max(window.innerHeight - 96, 240), 720)
          await invoke('open_extension_custom_view', {
            rendererId: action.id,
            clipId,
            sourceId,
            facetId: basePresentation?.activeView.facetId ?? null,
            surface: 'dialog',
            x: Math.max(24, (window.innerWidth - width) / 2),
            y: Math.max(48, (window.innerHeight - height) / 2),
            width,
            height,
          })
          setActiveTransformer(null)
          return
        }
        if (result.kind !== 'output') {
          setActiveTransformer(null)
          return
        }
        setPreview(result.preview)
        if (result.disposition !== 'preview') {
          if (result.disposition === 'save_as_clip') {
            await invoke('save_transform_result', { resultId: result.preview.resultId })
          } else {
            await executeClipboardOutput(result.disposition, {
              kind: 'transformed',
              resultId: result.preview.resultId,
            })
          }
          setPreview(null)
          setActiveTransformer(null)
        }
      } catch (value) {
        setError(String(value))
      } finally {
        setBusy(null)
      }
    },
    [actions, basePresentation?.activeView.facetId, clipId, sourceId]
  )

  const pinAction = useCallback(async (id: string, pinned: boolean) => {
    await invoke('set_extension_action_pinned', { actionId: id, pinned })
    setActions(current =>
      current.map(action => (action.id === id ? { ...action, pinned } : action))
    )
  }, [])

  useEffect(() => {
    onControls?.(
      items.length > 0 || actions.length > 0 ? { items, actions, run, runAction, pinAction } : null
    )
  }, [actions, items, onControls, pinAction, run, runAction])

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
    busy,
    activeTransformer,
    preview,
    error,
    applyResult,
    dismissPreview: () => {
      setPreview(null)
      setActiveTransformer(null)
    },
    dismissError: () => {
      setError(null)
      setActiveTransformer(null)
    },
  }
}
