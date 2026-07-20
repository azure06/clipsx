import { afterEach, describe, expect, it, vi } from 'vitest'

const { createClientMock, openMock, signInWithOAuthMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  openMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: openMock,
}))

import { parseAuthCallbackUrl, startOAuthLogin } from './supabaseAuth'

describe('parseAuthCallbackUrl', () => {
  it('accepts the configured desktop callback and preserves the one-time code', () => {
    expect(parseAuthCallbackUrl('clipsx://auth/callback?code=one-time-code')).toEqual({
      code: 'one-time-code',
    })
  })

  it.each([
    'https://auth/callback?code=code',
    'clipsx://auth/not-callback?code=code',
    'clipsx://other/callback?code=code',
    'clipsx://auth/callback',
    'clipsx://auth/callback?error=access_denied',
    'not a URL',
  ])('rejects malformed, cancelled, or non-ClipsX callbacks: %s', callback => {
    expect(() => parseAuthCallbackUrl(callback)).toThrow()
  })
})

describe('startSupabaseLogin', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens the provider authorization URL with the ClipsX callback URL', async () => {
    const authClient = {
      auth: {
        signInWithOAuth: signInWithOAuthMock.mockResolvedValue({
          data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=github' },
          error: null,
        }),
      },
    }

    await startOAuthLogin(authClient as never, 'github')

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'clipsx://auth/callback', skipBrowserRedirect: true },
    })
    expect(openMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=github'
    )
  })
})
