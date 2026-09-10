import { describe, expect, it, vi } from 'vitest'
import { diagnostic } from './diagnostics'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

describe('diagnostics', () => {
  it('sends only a fixed event identifier for host-controlled logging', () => {
    diagnostic('auth_supabase_pkce_code_exchange_failed')
    expect(invoke).toHaveBeenCalledWith('write_diagnostic', {
      event: 'auth_supabase_pkce_code_exchange_failed',
    })
  })

  it('does not throw when diagnostic delivery fails', async () => {
    invoke.mockRejectedValueOnce(new Error('unavailable'))
    expect(() => diagnostic('auth_deep_link_callback_received')).not.toThrow()
    await Promise.resolve()
  })
})
