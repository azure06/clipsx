import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { createClient, type Provider, type SupportedStorage } from '@supabase/supabase-js'

const CALLBACK_URL = new URL('clipsx://auth/callback')
const AUTH_STORAGE_KEY = 'sb-clipsx-auth-token'
const DEFAULT_WEB_ORIGIN = 'https://clipsx.app'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const DEFAULT_SUPABASE_AUTH_PROVIDER: Provider = 'google'
const configuredProvider = (import.meta.env.VITE_SUPABASE_AUTH_PROVIDER?.trim() ||
  DEFAULT_SUPABASE_AUTH_PROVIDER) as Provider

let client: ReturnType<typeof createClient> | undefined

const credentialVaultStorage: SupportedStorage = {
  getItem: async key => {
    const value = await invoke<string | null>('auth_storage_get', { key })
    if (import.meta.env.DEV) {
      console.info('[AUTH] Secure storage read', { key, found: value !== null })
    }
    return value
  },
  setItem: async (key, value) => {
    await invoke('auth_storage_set', { key, value })
    if (import.meta.env.DEV) console.info('[AUTH] Secure storage write', { key })
  },
  removeItem: async key => {
    await invoke('auth_storage_remove', { key })
    if (import.meta.env.DEV) console.info('[AUTH] Secure storage remove', { key })
  },
}

const getClient = () => {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Account sign-in is not configured for this build.')
  }

  client ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage: credentialVaultStorage,
      storageKey: AUTH_STORAGE_KEY,
    },
  })

  return client
}

export type ParsedAuthCallback = { code: string }

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabasePublishableKey)

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export const getDesktopOAuthRedirectUrl = (configuredOrigin?: string) => {
  const rawOrigin = configuredOrigin?.trim() || DEFAULT_WEB_ORIGIN
  let origin: URL

  try {
    origin = new URL(rawOrigin)
  } catch {
    throw new Error('The ClipsX website origin is not a valid URL.')
  }

  const isHttps = origin.protocol === 'https:'
  const isAllowedLocalHttp = origin.protocol === 'http:' && isLoopbackHost(origin.hostname)
  const isOriginOnly =
    origin.pathname === '/' &&
    !origin.search &&
    !origin.hash &&
    !origin.username &&
    !origin.password

  if (!isOriginOnly || (!isHttps && !isAllowedLocalHttp)) {
    throw new Error(
      'The ClipsX website origin must be HTTPS or a local loopback HTTP origin without a path.'
    )
  }

  return new URL('/auth/desktop/callback', origin.origin).toString()
}

export const parseAuthCallbackUrl = (rawUrl: string): ParsedAuthCallback => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('The sign-in callback was not a valid URL.')
  }

  if (
    url.protocol !== CALLBACK_URL.protocol ||
    url.hostname !== CALLBACK_URL.hostname ||
    url.pathname !== CALLBACK_URL.pathname
  ) {
    throw new Error('The sign-in callback was not intended for ClipsX.')
  }

  if (url.searchParams.has('error')) {
    throw new Error('Sign-in was cancelled or denied by the provider.')
  }

  const code = url.searchParams.get('code')
  if (!code) {
    throw new Error('The sign-in callback did not include an authorization code.')
  }

  return { code }
}

export const startOAuthLogin = async (
  authClient: ReturnType<typeof createClient>,
  provider: Provider
) => {
  const { data, error } = await authClient.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getDesktopOAuthRedirectUrl(import.meta.env.VITE_CLIPSX_WEB_ORIGIN),
      skipBrowserRedirect: true,
    },
  })

  if (error || !data.url) {
    throw new Error('Unable to start browser sign-in. Please try again.')
  }

  await open(data.url)
}

export const startSupabaseLogin = async () => {
  await startOAuthLogin(getClient(), configuredProvider)
}

export const completeSupabaseCallback = async (rawUrl: string) => {
  const { code } = parseAuthCallbackUrl(rawUrl)
  const { data, error } = await getClient().auth.exchangeCodeForSession(code)

  if (error || !data.session) {
    if (import.meta.env.DEV) {
      console.error('[AUTH] Supabase PKCE code exchange failed', {
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? 'Supabase returned no session.',
      })
    }

    throw new Error(error?.message ?? 'Supabase returned no session after the code exchange.')
  }

  return data.session
}

export const restoreSupabaseSession = async () => {
  const {
    data: { session },
    error,
  } = await getClient().auth.getSession()

  if (error) {
    throw new Error('Unable to restore the saved sign-in session.')
  }

  return session
}

export const signOutSupabase = async () => {
  const { error } = await getClient().auth.signOut({ scope: 'local' })
  if (error) {
    throw new Error('Unable to sign out. Please try again.')
  }

  await Promise.all([
    credentialVaultStorage.removeItem(AUTH_STORAGE_KEY),
    credentialVaultStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`),
  ])
}
