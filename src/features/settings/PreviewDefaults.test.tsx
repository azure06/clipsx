import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, it, expect, vi } from 'vitest'
import { PreviewDefaults } from './PreviewDefaults'
const mock = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }))
const initial = {
  byFacetId: { 'core.data.table': 'builtin.table' },
  byCapabilityId: {},
  byMimeType: { 'text/html': 'builtin.html' },
}
beforeEach(() => {
  mock.invoke.mockReset()
  mock.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === 'get_renderer_preferences'
        ? structuredClone(initial)
        : command === 'list_renderer_contributions'
          ? [
              { id: 'builtin.table', displayName: 'Table' },
              { id: 'builtin.html', displayName: 'HTML' },
            ]
          : undefined
    )
  )
})
it('shows rule scopes and resets one rule without removing other defaults', async () => {
  const user = userEvent.setup()
  render(<PreviewDefaults />)
  await screen.findByText('Recognized content · highest priority')
  await user.click(screen.getByRole('button', { name: 'Reset default for Table' }))
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith('update_renderer_preferences', {
      preferences: { ...initial, byFacetId: {} },
    })
  )
  expect(screen.getByRole('button', { name: 'Reset default for HTML' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Reset default for Table' })).not.toBeInTheDocument()
})
it('preserves rules after a failed reset and lets the user retry', async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === 'update_renderer_preferences'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(command === 'get_renderer_preferences' ? structuredClone(initial) : [])
  )
  const user = userEvent.setup()
  render(<PreviewDefaults />)
  await screen.findByRole('button', { name: 'Reset default for Table' })
  await user.click(screen.getByRole('button', { name: 'Reset all to automatic' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reset default for Table' })).toBeEnabled()
})
it('clears all overrides and shows automatic selection', async () => {
  const user = userEvent.setup()
  render(<PreviewDefaults />)
  await screen.findByRole('button', { name: 'Reset default for Table' })
  await user.click(screen.getByRole('button', { name: 'Reset all to automatic' }))
  expect(
    await screen.findByText('No saved overrides. ClipsX chooses views automatically.')
  ).toBeVisible()
  expect(mock.invoke).toHaveBeenCalledWith('update_renderer_preferences', {
    preferences: { byFacetId: {}, byCapabilityId: {}, byMimeType: {} },
  })
})
