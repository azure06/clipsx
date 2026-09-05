import { afterEach, describe, expect, it, vi } from 'vitest'

const { createClientMock, invokeMock, openMock, signInWithOAuthMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  invokeMock: vi.fn(),
  openMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
}))

const appEnv = import.meta.env as Record<string, string | undefined>
const initialWebOrigin = appEnv['VITE_NEXT_PUBLIC_SITE_URL']
const initialLegacyWebOrigin = appEnv['VITE_CLIPSX_WEB_ORIGIN']

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: openMock,
}))

import {
  DEFAULT_SUPABASE_AUTH_PROVIDER,
  completeSupabaseCallback,
  getDesktopOAuthRedirectUrl,
  parseAuthCallbackUrl,
  resetSupabaseLocalSignIn,
  restoreSupabaseSession,
  startOAuthLogin,
} from './supabaseAuth'

describe('parseAuthCallbackUrl', () => {
  it('accepts the configured desktop callback and preserves the one-time code', () => {
    expect(parseAuthCallbackUrl('clipsx://auth/callback?code=one-time-code')).toEqual({
      code: 'one-time-code',
    })
  })

  it('accepts a loopback browser callback and preserves the one-time code', () => {
    expect(
      parseAuthCallbackUrl('http://127.0.0.1:43123/auth/desktop/callback?code=one-time-code')
    ).toEqual({
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
    vi.unstubAllEnvs()
    if (initialWebOrigin === undefined) {
      delete appEnv['VITE_NEXT_PUBLIC_SITE_URL']
    } else {
      appEnv['VITE_NEXT_PUBLIC_SITE_URL'] = initialWebOrigin
    }
    if (initialLegacyWebOrigin === undefined) {
      delete appEnv['VITE_CLIPSX_WEB_ORIGIN']
    } else {
      appEnv['VITE_CLIPSX_WEB_ORIGIN'] = initialLegacyWebOrigin
    }
  })

  it('defaults desktop browser sign-in to Google', () => {
    expect(DEFAULT_SUPABASE_AUTH_PROVIDER).toBe('google')
  })

  it('opens the provider authorization URL with a local callback listener when available', async () => {
    vi.stubEnv('DEV', true)
    invokeMock.mockResolvedValue('http://127.0.0.1:43123/auth/desktop/callback')

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
        redirectTo: 'http://127.0.0.1:43123/auth/desktop/callback',
        skipBrowserRedirect: true,
      },
    })
    expect(openMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=google'
    )
  })

  it('falls back to the hosted website callback bridge when the local listener fails', async () => {
    vi.stubEnv('DEV', true)
    invokeMock.mockRejectedValue(new Error('listener unavailable'))
    delete appEnv['VITE_NEXT_PUBLIC_SITE_URL']
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
  })

  it('uses the hosted website callback bridge in production builds', async () => {
    vi.stubEnv('DEV', false)

    const authClient = {
      auth: {
        signInWithOAuth: signInWithOAuthMock.mockResolvedValue({
          data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' },
          error: null,
        }),
      },
    }

    await startOAuthLogin(authClient as never, 'google')

    expect(invokeMock).not.toHaveBeenCalled()
    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: getDesktopOAuthRedirectUrl(import.meta.env.VITE_NEXT_PUBLIC_SITE_URL),
        skipBrowserRedirect: true,
      },
    })
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
    if (origin === undefined) {
      delete appEnv['VITE_NEXT_PUBLIC_SITE_URL']
      delete appEnv['VITE_CLIPSX_WEB_ORIGIN']
    }

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

describe('secure session recovery', () => {
  it('accepts the SDK user key and resets the active client before rejecting its old callback', async () => {
    const stopAutoRefresh = vi.fn()
    const startAutoRefresh = vi.fn()
    const exchangeCodeForSession = vi.fn()
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        stopAutoRefresh,
        startAutoRefresh,
        exchangeCodeForSession,
      },
    })
    invokeMock.mockResolvedValue(undefined)

    await restoreSupabaseSession()
    const options = createClientMock.mock.calls.at(-1)?.[2] as {
      auth: { storage: { setItem: (key: string, value: string) => Promise<void> } }
    }
    await options.auth.storage.setItem('sb-clipsx-auth-token-user', '{"user":{}}')
    expect(invokeMock).toHaveBeenCalledWith('auth_storage_set', {
      key: 'sb-clipsx-auth-token-user',
      value: '{"user":{}}',
    })

    await resetSupabaseLocalSignIn()
    expect(stopAutoRefresh).toHaveBeenCalledOnce()
    expect(invokeMock).toHaveBeenCalledWith('auth_storage_reset')
    await expect(completeSupabaseCallback('clipsx://auth/callback?code=abandoned')).rejects.toThrow(
      'reset'
    )
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(startAutoRefresh).not.toHaveBeenCalled()
  })
})
