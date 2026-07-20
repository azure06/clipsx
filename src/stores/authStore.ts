import { create } from 'zustand'

import {
  completeSupabaseCallback,
  isSupabaseConfigured,
  restoreSupabaseSession,
  signOutSupabase,
  startSupabaseLogin,
} from '../shared/auth/supabaseAuth'

export type AuthStatus =
  | 'unconfigured'
  | 'loading'
  | 'signed_out'
  | 'signing_in'
  | 'signed_in'
  | 'error'

type AuthState = {
  status: AuthStatus
  email: string | null
  error: string | null
  initialize: () => Promise<void>
  signIn: () => Promise<void>
  completeCallback: (url: string) => Promise<boolean>
  signOut: () => Promise<void>
}

const signedOutState = { status: 'signed_out' as const, email: null, error: null }
const genericError = 'Account sign-in could not be completed. Please try again.'

export const useAuthStore = create<AuthState>((set, get) => ({
  status: isSupabaseConfigured() ? 'loading' : 'unconfigured',
  email: null,
  error: null,

  initialize: async () => {
    if (!isSupabaseConfigured()) {
      set({ status: 'unconfigured', email: null, error: null })
      return
    }

    set({ status: 'loading', error: null })
    try {
      const session = await restoreSupabaseSession()
      set(
        session
          ? { status: 'signed_in', email: session.user.email ?? session.user.id, error: null }
          : signedOutState
      )
    } catch {
      set({ ...signedOutState, status: 'error', error: genericError })
    }
  },

  signIn: async () => {
    if (!isSupabaseConfigured() || get().status === 'signing_in') return

    set({ status: 'signing_in', error: null })
    try {
      await startSupabaseLogin()
    } catch {
      set({ ...signedOutState, status: 'error', error: genericError })
    }
  },

  completeCallback: async url => {
    if (!isSupabaseConfigured()) return false

    set({ status: 'signing_in', error: null })
    try {
      const session = await completeSupabaseCallback(url)
      set({ status: 'signed_in', email: session.user.email ?? session.user.id, error: null })
      return true
    } catch {
      set({ ...signedOutState, status: 'error', error: genericError })
      return false
    }
  },

  signOut: async () => {
    if (!isSupabaseConfigured()) return

    try {
      await signOutSupabase()
      set(signedOutState)
    } catch {
      set({ status: 'error', error: genericError })
    }
  },
}))
