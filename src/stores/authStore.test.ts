import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startSupabaseLoginMock } = vi.hoisted(() => ({
  startSupabaseLoginMock: vi.fn(),
}))

vi.mock('../shared/auth/supabaseAuth', () => ({
  completeSupabaseCallback: vi.fn(),
  isSupabaseConfigured: () => true,
  resetSupabaseLocalSignIn: vi.fn(),
  restoreSupabaseSession: vi.fn(),
  signOutSupabase: vi.fn(),
  startSupabaseLogin: startSupabaseLoginMock,
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { useAuthStore } from './authStore'

describe('useAuthStore provider sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      status: 'signed_out',
      email: null,
      userId: null,
      error: null,
      signingInProvider: null,
    })
  })

  it.each(['google', 'github'] as const)(
    'starts %s and exposes its pending state',
    async provider => {
      startSupabaseLoginMock.mockResolvedValue(undefined)

      await useAuthStore.getState().signIn(provider)

      expect(startSupabaseLoginMock).toHaveBeenCalledWith(provider)
      expect(useAuthStore.getState()).toMatchObject({
        status: 'signing_in',
        signingInProvider: provider,
        error: null,
      })
    }
  )

  it('ignores a second provider while a sign-in attempt is active', async () => {
    let release: () => void = () => undefined
    startSupabaseLoginMock.mockImplementation(
      () => new Promise<void>(resolve => (release = resolve))
    )

    const first = useAuthStore.getState().signIn('google')
    await useAuthStore.getState().signIn('github')
    release()
    await first

    expect(startSupabaseLoginMock).toHaveBeenCalledTimes(1)
    expect(startSupabaseLoginMock).toHaveBeenCalledWith('google')
  })

  it('returns to a retryable error state when OAuth startup fails', async () => {
    startSupabaseLoginMock.mockRejectedValue(new Error('provider unavailable'))

    await useAuthStore.getState().signIn('github')

    expect(useAuthStore.getState()).toMatchObject({
      status: 'error',
      signingInProvider: null,
    })
    expect(useAuthStore.getState().error).toBeTruthy()
  })
})
