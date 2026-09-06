import type { Database, Json } from './database.types'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { createClient, type Provider, type SupportedStorage } from '@supabase/supabase-js'

const CALLBACK_URL = new URL('clipsx://auth/callback')
const CALLBACK_BRIDGE_PATH = '/auth/desktop/callback'
const AUTH_STORAGE_KEY = 'sb-clipsx-auth-token'
const getDefaultWebOrigin = () =>
  import.meta.env.VITE_NEXT_PUBLIC_SITE_URL?.trim() ||
  import.meta.env.VITE_CLIPSX_WEB_ORIGIN?.trim() ||
  'https://clipsx.app'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const DEFAULT_SUPABASE_AUTH_PROVIDER: Provider = 'google'
const configuredProvider = (import.meta.env.VITE_SUPABASE_AUTH_PROVIDER?.trim() ||
  DEFAULT_SUPABASE_AUTH_PROVIDER) as Provider

let client: ReturnType<typeof createClient<Database>> | undefined
let rejectPendingCallback = false

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

  client ??= createClient<Database>(supabaseUrl, supabasePublishableKey, {
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
const shouldUseLocalDesktopOAuthCallback = () => import.meta.env.DEV

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

const isCustomSchemeCallbackUrl = (url: URL) =>
  url.protocol === CALLBACK_URL.protocol &&
  url.hostname === CALLBACK_URL.hostname &&
  url.pathname === CALLBACK_URL.pathname

const isLoopbackCallbackUrl = (url: URL) =>
  url.protocol === 'http:' && isLoopbackHost(url.hostname) && url.pathname === CALLBACK_BRIDGE_PATH

const isHostedCallbackUrl = (url: URL) => {
  try {
    const expected = new URL(getDesktopOAuthRedirectUrl())
    return url.origin === expected.origin && url.pathname === expected.pathname
  } catch {
    return false
  }
}

export const getDesktopOAuthRedirectUrl = (configuredOrigin?: string) => {
  const rawOrigin = configuredOrigin?.trim() || getDefaultWebOrigin()
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

  return new URL(CALLBACK_BRIDGE_PATH, origin.origin).toString()
}

export const parseAuthCallbackUrl = (rawUrl: string): ParsedAuthCallback => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('The sign-in callback was not a valid URL.')
  }

  if (!isCustomSchemeCallbackUrl(url) && !isLoopbackCallbackUrl(url) && !isHostedCallbackUrl(url)) {
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
  authClient: ReturnType<typeof createClient<Database>>,
  provider: Provider
) => {
  let redirectTo = getDesktopOAuthRedirectUrl(import.meta.env.VITE_NEXT_PUBLIC_SITE_URL)

  if (shouldUseLocalDesktopOAuthCallback()) {
    try {
      // macOS deep-link handlers are discovered from installed app bundles, so
      // dev/unregistered builds can fail to open `clipsx://...` from the browser.
      // Keep the local loopback callback as a development-only fallback and use
      // the hosted bridge for production builds, where the bundle should be registered.
      redirectTo = await invoke<string>('start_local_auth_callback_listener')
      if (import.meta.env.DEV) {
        console.info('[AUTH] Using local auth callback listener', { redirectTo })
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[AUTH] Falling back to the hosted auth callback bridge', {
          redirectTo,
          error,
        })
      }
    }
  }

  const { data, error } = await authClient.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  })

  if (error || !data.url) {
    throw new Error('Unable to start browser sign-in. Please try again.')
  }

  await open(data.url)
}

export const startSupabaseLogin = async () => {
  rejectPendingCallback = false
  await startOAuthLogin(getClient(), configuredProvider)
}

export const completeSupabaseCallback = async (rawUrl: string) => {
  if (rejectPendingCallback) {
    throw new Error('This sign-in attempt was reset. Please start again.')
  }
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

export const resetSupabaseLocalSignIn = async () => {
  rejectPendingCallback = true
  const currentClient = client
  await currentClient?.auth.stopAutoRefresh()
  try {
    await invoke('auth_storage_reset')
    client = undefined
  } catch (error) {
    await currentClient?.auth.startAutoRefresh()
    throw error
  }
}

export const applySupabaseSyncBatch = async (batch: {
  protocolVersion: number
  generation: number
  deviceId: string
  afterCursor: number
  records: Json[]
}) => {
  const { data, error } = await getClient().rpc('sync_apply_batch', {
    p_protocol_version: batch.protocolVersion,
    p_generation: batch.generation,
    p_device_id: batch.deviceId,
    p_after_cursor: batch.afterCursor,
    p_records: batch.records,
  })
  if (error) throw new Error(error.message)
  return data
}
export const enrollSyncDevice = async (deviceId: string, deviceName: string) => {
  const { data, error } = await getClient().rpc('sync_enroll_device', {
    p_device_id: deviceId,
    p_device_name: deviceName,
  })
  if (error) throw new Error(error.message)
  return data
}
export const listSyncDevices = async () => {
  const { data, error } = await getClient().rpc('sync_list_devices')
  if (error) throw new Error(error.message)
  return data
}
export const revokeSyncDevice = async (deviceId: string) => {
  const { error } = await getClient().rpc('sync_revoke_device', { p_device_id: deviceId })
  if (error) throw new Error(error.message)
}
export const resetSyncProfile = async (generation: number) => {
  const { data, error } = await getClient().rpc('sync_reset_profile', { p_generation: generation })
  if (error) throw new Error(error.message)
  return data
}
export const replaceSyncProfile = async (
  generation: number,
  deviceId: string,
  records: Json[],
  replace: boolean
) => {
  const { data, error } = await getClient().rpc('sync_replace_profile', {
    p_generation: generation,
    p_device_id: deviceId,
    p_records: records,
    p_replace: replace,
  })
  if (error) throw new Error(error.message)
  return data
}
