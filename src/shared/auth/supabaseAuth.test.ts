import { afterEach, describe, expect, it, vi } from 'vitest'

const { createClientMock, openMock, signInWithOAuthMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  openMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
}))

const appEnv = import.meta.env as Record<string, string | undefined>
const initialWebOrigin = appEnv['VITE_CLIPSX_WEB_ORIGIN']

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: openMock,
}))

import {
  DEFAULT_SUPABASE_AUTH_PROVIDER,
  getDesktopOAuthRedirectUrl,
  parseAuthCallbackUrl,
  startOAuthLogin,
} from './supabaseAuth'

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
    if (initialWebOrigin === undefined) {
      delete appEnv['VITE_CLIPSX_WEB_ORIGIN']
    } else {
      appEnv['VITE_CLIPSX_WEB_ORIGIN'] = initialWebOrigin
    }
  })

  it('defaults desktop browser sign-in to Google', () => {
    expect(DEFAULT_SUPABASE_AUTH_PROVIDER).toBe('google')
  })

  it('opens the provider authorization URL with the website callback bridge', async () => {
    delete appEnv['VITE_CLIPSX_WEB_ORIGIN']

    const authClient = {
      auth: {
        signInWithOAuth: signInWithOAuthMock.mockResolvedValue({
          data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' },
          error: null,
        }),
      },
    }

    await startOAuthLogin(authClient as never, 'google')

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://clipsx.app/auth/desktop/callback',
        skipBrowserRedirect: true,
      },
    })
    expect(openMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=google'
    )
  })
})

describe('getDesktopOAuthRedirectUrl', () => {
  it.each([
    [undefined, 'https://clipsx.app/auth/desktop/callback'],
    ['https://staging.clipsx.app', 'https://staging.clipsx.app/auth/desktop/callback'],
    ['http://localhost:3000', 'http://localhost:3000/auth/desktop/callback'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000/auth/desktop/callback'],
    ['http://[::1]:3000', 'http://[::1]:3000/auth/desktop/callback'],
  ])('accepts an allowed web origin: %s', (origin, expected) => {
    expect(getDesktopOAuthRedirectUrl(origin)).toBe(expected)
  })

  it.each([
    'not a URL',
    'ftp://clipsx.app',
    'http://clipsx.app',
    'https://clipsx.app/auth/desktop/callback',
    'https://user:password@clipsx.app',
  ])('rejects an unsafe website origin: %s', origin => {
    expect(() => getDesktopOAuthRedirectUrl(origin)).toThrow()
  })
})
