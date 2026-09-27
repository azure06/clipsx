import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTransformState, type TransformControls } from './useTransformState'
import type { ClipPresentation } from '../../shared/types/v2'

function rejectIpc(error: unknown): Promise<never> {
  // Tauri rejects serialized host errors, rather than JavaScript Error instances.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  return Promise.reject(error)
}

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock('../../shared/hooks/useTheme', () => ({ useTheme: () => ({ appliedTheme: 'light' }) }))

describe('interactive action failure presentation', () => {
  it('uses the same safe reason as jobs and never renders a raw IPC body', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_transformer_contributions') return Promise.resolve([])
      if (command === 'list_context_actions')
        return Promise.resolve([
          {
            id: 'example/action',
            packageId: 'example',
            label: 'Example',
            available: true,
            execution: 'local',
            effects: [],
            shortcut: null,
          },
        ])
      if (command === 'run_context_action')
        return rejectIpc({
          code: 'input_limit',
          recovery: 'stop',
          message: 'private clipboard credential',
        })
      return rejectIpc('private provider body')
    })
    const controls = vi.fn<(value: TransformControls | null) => void>()
    const notify = vi.fn<(event: Event) => void>()
    window.addEventListener('clipsx-extension-action-notification', notify)
    const mounted = renderHook(() =>
      useTransformState({
        clipId: 'clip',
        sourceId: 'source',
        basePresentation: {
          activeView: { presentationKind: 'text', facetId: null },
        } as ClipPresentation,
        onControls: controls,
      })
    )
    try {
      await waitFor(() => expect(controls.mock.lastCall?.[0]?.actions).toHaveLength(1))
      await act(async () => {
        await controls.mock.lastCall?.[0]?.runAction('example/action')
      })
      const detail = (notify.mock.lastCall?.[0] as CustomEvent<{ message: string; code: string }>)
        .detail
      expect(detail.message).toContain('supported request size')
      expect(detail.message).not.toContain('credential')
      expect(detail.code).toBe('input_limit')
      invokeMock.mockImplementation((command: string) =>
        command === 'run_context_action' ? rejectIpc('private provider body') : Promise.resolve([])
      )
      await act(async () => {
        await controls.mock.lastCall?.[0]?.runAction('example/action')
      })
      expect(
        (notify.mock.lastCall?.[0] as CustomEvent<{ message: string; code: string }>).detail.message
      ).toBe('The operation failed for an unknown reason.')
    } finally {
      mounted.unmount()
      window.removeEventListener('clipsx-extension-action-notification', notify)
    }
  })
})
