import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { createClient, type Provider, type SupportedStorage } from '@supabase/supabase-js'

const CALLBACK_URL = 'clipsx://auth/callback'
const AUTH_STORAGE_KEY = 'sb-clipsx-auth-token'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const configuredProvider = (import.meta.env.VITE_SUPABASE_AUTH_PROVIDER?.trim() ||
  'github') as Provider

let client: ReturnType<typeof createClient> | undefined

const credentialVaultStorage: SupportedStorage = {
  getItem: async key => invoke<string | null>('auth_storage_get', { key }),
  setItem: async (key, value) => {
    await invoke('auth_storage_set', { key, value })
  },
  removeItem: async key => {
    await invoke('auth_storage_remove', { key })
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

export const parseAuthCallbackUrl = (rawUrl: string): ParsedAuthCallback => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('The sign-in callback was not a valid URL.')
  }

  if (url.protocol !== 'clipsx:' || url.hostname !== 'auth' || url.pathname !== '/callback') {
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
      redirectTo: CALLBACK_URL,
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
    throw new Error('This sign-in link is expired or has already been used. Please try again.')
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
