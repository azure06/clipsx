import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { PreviewTransformMenu } from './PreviewTransformMenu'
import { previewTransforms } from './transformMenu'
import { transformer, view } from './previewFixtures.test-utils'
import type { SavedSetup } from '../extensions/parameters'
const state = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: state.toast }) }))
const props = () => ({
  clipId: 'clip-1',
  transformers: [transformer()],
  views: [view()],
  onRunStarted: vi.fn(() => 7),
  onQueued: vi.fn(),
  onConfigure: vi.fn(),
})
beforeEach(() => {
  vi.clearAllMocks()
  state.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === 'list_extension_transform_setups'
        ? []
        : command === 'issue_extension_transformer_invocation'
          ? { token: 'native-token' }
          : { jobId: 'new-job' }
    )
  )
})
it('runs a complete older extension setup with one click, using its assessed source and without copying', async () => {
  const user = userEvent.setup(),
    p = props()
  p.transformers[0]!.setups[0]!.copyAs = undefined
  render(<PreviewTransformMenu {...p} />)
  await user.click(screen.getByRole('button', { name: 'Transform' }))
  await user.click(screen.getByRole('menuitem', { name: /Table to CSV/ }))
  await waitFor(() => expect(p.onQueued).toHaveBeenCalledWith('new-job', 7))
  expect(
    state.invoke.mock.calls.find(
      ([command]) => command === 'enqueue_extension_transform'
    )?.[1] as unknown
  ).toMatchObject({
    request: {
      clipId: 'clip-1',
      sourceId: 'html',
      parameters: { operation: 'csv' },
      setupId: null,
      invocationToken: null,
      defaultView: 'result_only',
    },
  })
  expect(state.invoke.mock.calls.some(([command]) => command === 'execute_clipboard_output')).toBe(
    false
  )
  expect(p.onConfigure).not.toHaveBeenCalled()
})
it('opens the exact setup for missing parameters or consent', async () => {
  const user = userEvent.setup(),
    p = props()
  p.transformers[0]!.consentRequired = true
  render(<PreviewTransformMenu {...p} />)
  await user.click(screen.getByRole('button', { name: 'Transform' }))
  await user.click(screen.getByRole('menuitem', { name: /Table to CSV/ }))
  expect(p.onConfigure).toHaveBeenCalledWith('setup:example.data/convert:csv')
  expect(p.onQueued).not.toHaveBeenCalled()
  expect(
    state.invoke.mock.calls.some(([command]) => command === 'enqueue_extension_transform')
  ).toBe(false)
})
it('obtains a native invocation token for a ready capability-backed transformation', async () => {
  const user = userEvent.setup(),
    p = props()
  p.transformers[0]!.execution = 'capability_backed'
  render(<PreviewTransformMenu {...p} />)
  await user.click(screen.getByRole('button', { name: 'Transform' }))
  await user.click(screen.getByRole('menuitem', { name: /Table to CSV/ }))
  await waitFor(() => expect(p.onQueued).toHaveBeenCalled())
  expect(state.invoke).toHaveBeenCalledWith('issue_extension_transformer_invocation', {
    transformerId: 'example.data/convert',
    clipId: 'clip-1',
    sourceId: 'html',
  })
  expect(
    state.invoke.mock.calls.find(
      ([command]) => command === 'enqueue_extension_transform'
    )?.[1] as unknown
  ).toMatchObject({
    request: { invocationToken: 'native-token' },
  })
})
it('does not navigate or enqueue after leaving during invocation setup', async () => {
  let resolve: ((value: { token: string }) => void) | undefined
  state.invoke.mockImplementation((command: string) =>
    command === 'list_extension_transform_setups'
      ? Promise.resolve([])
      : new Promise(r => {
          resolve = r
        })
  )
  const user = userEvent.setup(),
    p = props()
  p.transformers[0]!.execution = 'capability_backed'
  const mounted = render(<PreviewTransformMenu {...p} />)
  await user.click(screen.getByRole('button', { name: 'Transform' }))
  await user.click(screen.getByRole('menuitem', { name: /Table to CSV/ }))
  mounted.unmount()
  await act(async () => {
    resolve?.({ token: 'late-token' })
    await Promise.resolve()
  })
  expect(p.onQueued).not.toHaveBeenCalled()
  expect(
    state.invoke.mock.calls.some(([command]) => command === 'enqueue_extension_transform')
  ).toBe(false)
})
it('reports enqueue failures without a result callback and allows retry', async () => {
  state.invoke.mockImplementation((command: string) =>
    command === 'list_extension_transform_setups'
      ? Promise.resolve([])
      : Promise.reject(new Error('failed'))
  )
  const user = userEvent.setup(),
    p = props()
  render(<PreviewTransformMenu {...p} />)
  await user.click(screen.getByRole('button', { name: 'Transform' }))
  await user.click(screen.getByRole('menuitem', { name: /Table to CSV/ }))
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  )
  expect(p.onQueued).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Transform' })).toBeEnabled()
})
it('uses saved setup identity and excludes hidden candidates while disabling unavailable ones', () => {
  const item = transformer()
  item.setupAvailability['csv'] = { state: 'hidden', reason: null }
  item.customAvailability = { state: 'disabled', reason: 'provider_unavailable' }
  item.setupAvailability['saved:mine'] = {
    state: 'ready',
    reason: null,
    sourceId: 'alternate-source',
  }
  const saved: SavedSetup = {
    id: 'mine',
    packageId: item.packageId,
    transformerId: item.id,
    label: 'My CSV',
    parameters: { operation: 'csv' },
    defaultView: 'compare',
    revision: 1,
    available: true,
  }
  const entries = previewTransforms([item], [saved])
  expect(entries.some(entry => entry.id.endsWith(':csv'))).toBe(false)
  expect(entries.find(entry => entry.id === 'saved:mine')).toMatchObject({
    setupId: 'mine',
    sourceId: 'alternate-source',
    configure: false,
    disabled: false,
  })
  expect(entries.find(entry => entry.id.startsWith('custom:'))?.disabled).toBe(true)
})

it('routes incomplete fixed setups to configuration rather than enqueueing invalid parameters', () => {
  const item = transformer()
  item.setups[0]!.parameters = {}
  expect(previewTransforms([item], []).find(entry => entry.id.endsWith(':csv'))?.configure).toBe(
    true
  )
})

it('separates ready runs from choices that need configuration', async () => {
  const user = userEvent.setup(),
    p = props()
  render(<PreviewTransformMenu {...p} />)
  await user.click(screen.getByRole('button', { name: 'Transform' }))
  const ready = screen.getByRole('group', { name: 'Run now' }),
    configure = screen.getByRole('group', { name: 'Configure' })
  expect(within(ready).getByRole('menuitem', { name: /Table to CSV/ })).toBeVisible()
  expect(within(configure).getByRole('menuitem', { name: /Custom transformation/ })).toBeVisible()
  expect(ready.compareDocumentPosition(configure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
