import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipPresentation } from '../../shared/types/v2'
import { getPlatform, matchShortcut, parseAccelerator } from '../../shared/keyboard/shortcuts'
import { useTheme } from '../../shared/hooks/useTheme'
import { useClipboardStore } from '../../stores/clipboardStore'

export type Transformer = {
  id: string
  sourceId: string
  packageId: string
  label: string
  icon?: string | null
  iconSvg?: string | null
  iconSvgDark?: string | null
  iconScale?: number
  version: string
  parameterSchema: Record<string, unknown>
  execution: 'local' | 'capability_backed'
  consentRequired: boolean
  httpOrigins: string[]
  providers: string[]
  setups: Array<{ id: string; displayName: string; parameters: Record<string, unknown>; defaultView?: 'result_only' | 'compare' }>
  defaultView: 'result_only' | 'compare'
  resultControls: Array<'copy' | 'paste' | 'save_as_clip' | 'regenerate'>
  providerAvailable: boolean
  setupAvailability: Record<string, { state: 'hidden' | 'disabled' | 'ready'; reason: string | null; sourceId?: string | null }>
  customAvailability: { state: 'hidden' | 'disabled' | 'ready'; reason: string | null; sourceId?: string | null }
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
  consentRequired: boolean
  externalNavigationOrigins: string[]
  httpOrigins: string[]
  providers: string[]
}

export type TransformControls = {
  items: Transformer[]
  actions: ContextAction[]
  runAction: (id: string, parameters?: Record<string, unknown>) => Promise<void>
}

type ActionInvocation = { token: string; expiresAt: number }
type ActionResult =
  | { kind: 'open_https_url'; url: string }
  | { kind: 'notification'; level: string; message: string }
  | { kind: 'open_dialog' }
  | { kind: 'native_action' }

export const useTransformState = ({
  clipId, sourceId, basePresentation, onControls,
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
  const [revision, setRevision] = useState(0)
  const presentationKind = basePresentation?.activeView.presentationKind
  const facetId = basePresentation?.activeView.facetId ?? null

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('clipsx-extension-permissions-changed', refresh)
    let alive = true
    const listeners: Array<() => void> = []
    for (const eventName of ['extension-catalog-updated', 'extensions-changed', 'generation-provider-status-changed']) {
      void listen(eventName, refresh).then(stop => {
        if (alive) listeners.push(stop)
        else stop()
      })
    }
    return () => {
      alive = false
      window.removeEventListener('clipsx-extension-permissions-changed', refresh)
      listeners.forEach(stop => stop())
    }
  }, [])

  useEffect(() => {
    if (!presentationKind || !sourceId) {
      setItems([])
      setActions([])
      return
    }
    let alive = true
    void Promise.all([
      invoke<Transformer[]>('list_transformer_contributions', { clipId, sourceId, presentationKind }),
      invoke<ContextAction[]>('list_context_actions', { clipId, sourceId, facetId }),
    ]).then(([transformers, contextualActions]) => {
      if (alive) { setItems(transformers); setActions(contextualActions) }
    }).catch(() => {
      if (alive) { setItems([]); setActions([]) }
    })
    return () => { alive = false }
  }, [clipId, sourceId, presentationKind, facetId, revision])

  const runAction = useCallback(async (id: string, parameters: Record<string, unknown> = {}) => {
    const action = actions.find(item => item.id === id)
    if (!action?.available) return
    const actionSourceId = action.sourceId ?? sourceId
    const actionFacetId = action.sourceId === undefined ? facetId : (action.facetId ?? null)
    try {
      let invocationToken: string | null = null
      if (action.execution === 'capability_backed' || action.effects.some(effect =>
        ['open_https_url', 'open_dialog', 'compose_email', 'dial_phone'].includes(effect))) {
        if (action.consentRequired) {
          const destinations = [...action.externalNavigationOrigins, ...action.httpOrigins,
            ...action.providers.map(provider => `Host provider: ${provider}`)].join('\n')
          if (!window.confirm(`${action.label} wants to send this clip's selected content to:\n\n${destinations}\n\nAllow this exact extension release?`)) return
          await invoke('grant_extension_action_permissions', { actionId: action.id })
          window.dispatchEvent(new Event('clipsx-extension-permissions-changed'))
        }
        const invocation = await invoke<ActionInvocation>('issue_extension_action_invocation', {
          actionId: action.id, clipId, sourceId: actionSourceId, facetId: actionFacetId,
        })
        invocationToken = invocation.token
      }
      const result = await invoke<ActionResult>('run_context_action', {
        clipId, sourceId: actionSourceId, facetId: actionFacetId,
        actionId: action.id, parameters, invocationToken,
      })
      if (result.kind === 'notification') {
        window.dispatchEvent(new CustomEvent('clipsx-extension-action-notification', { detail: result }))
      } else if (result.kind === 'open_dialog') {
        const width = Math.min(Math.max(window.innerWidth - 48, 320), 960)
        const height = Math.min(Math.max(window.innerHeight - 96, 240), 720)
        await invoke('open_extension_custom_view', {
          rendererId: action.id, clipId, sourceId: actionSourceId, facetId: actionFacetId,
          theme: appliedTheme, locale, surface: 'dialog',
          x: Math.max(24, (window.innerWidth - width) / 2),
          y: Math.max(48, (window.innerHeight - height) / 2), width, height,
        })
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('clipsx-extension-action-notification', {
        detail: { level: 'error', message: String(error) },
      }))
    }
  }, [actions, appliedTheme, clipId, facetId, locale, sourceId])

  useEffect(() => {
    onControls?.(items.length || actions.length ? { items, actions, runAction } : null)
  }, [items, actions, runAction, onControls])
  useEffect(() => () => onControls?.(null), [onControls])

  useEffect(() => {
    const platform = getPlatform()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || useClipboardStore.getState().resultsStale) return
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
}
