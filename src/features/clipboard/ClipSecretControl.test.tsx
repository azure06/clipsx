import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ClipSecretControl } from './ClipSecretControl'
const state = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: state.toast }) }))
const status = { captureHash: 'capture-hash', secret: true, private: false }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  )
  state.invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'get_clip_secret_status' ? status : { ...status, secret: false })
  )
})
afterEach(() => vi.unstubAllGlobals())
it('removes the current secret classification without storing an override', async () => {
  const user = userEvent.setup()
  render(<ClipSecretControl clipId="clip" />)
  await user.click(await screen.findByRole('button', { name: 'Review secret classification' }))
  await user.click(screen.getByRole('menuitem', { name: 'Not a secret…' }))
  await waitFor(() =>
    expect(state.invoke).toHaveBeenCalledWith('clear_clip_secret', {
      clipId: 'clip',
      captureHash: 'capture-hash',
    })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Review secret classification' })
    ).not.toBeInTheDocument()
  )
})
it('does not change classification if confirmation is declined', async () => {
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false)
  )
  const user = userEvent.setup()
  render(<ClipSecretControl clipId="clip" />)
  await user.click(await screen.findByRole('button', { name: 'Review secret classification' }))
  await user.click(screen.getByRole('menuitem', { name: 'Not a secret…' }))
  expect(state.invoke.mock.calls.some(([command]) => command === 'clear_clip_secret')).toBe(false)
})
it('preserves the badge and reports a failed change', async () => {
  state.invoke.mockImplementation((command: string) =>
    command === 'get_clip_secret_status'
      ? Promise.resolve(status)
      : Promise.reject(new Error('failed'))
  )
  const user = userEvent.setup()
  render(<ClipSecretControl clipId="clip" />)
  await user.click(await screen.findByRole('button', { name: 'Review secret classification' }))
  await user.click(screen.getByRole('menuitem', { name: 'Not a secret…' }))
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  )
  expect(screen.getByRole('button', { name: 'Review secret classification' })).toHaveTextContent(
    'Secret'
  )
})
