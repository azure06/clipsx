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
  userId: string | null
  error: string | null
  initialize: () => Promise<void>
  signIn: () => Promise<void>
  completeCallback: (url: string) => Promise<boolean>
  signOut: () => Promise<void>
}

const signedOutState = { status: 'signed_out' as const, email: null, userId: null, error: null }
const genericError = 'Account sign-in could not be completed. Please try again.'
const authErrorMessage = (error: unknown) => {
  if (!import.meta.env.DEV) return genericError
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return `Authentication failed (${typeof error}).`
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: isSupabaseConfigured() ? 'loading' : 'unconfigured',
  email: null,
  userId: null,
  error: null,

  initialize: async () => {
    if (!isSupabaseConfigured()) {
      set({ status: 'unconfigured', email: null, userId: null, error: null })
      return
    }

    set({ status: 'loading', error: null })
    try {
      const session = await restoreSupabaseSession()
      set(
        session
          ? {
              status: 'signed_in',
              email: session.user.email ?? session.user.id,
              userId: session.user.id,
              error: null,
            }
          : signedOutState
      )
    } catch (error) {
      set({ ...signedOutState, status: 'error', error: authErrorMessage(error) })
    }
  },

  signIn: async () => {
    if (!isSupabaseConfigured() || get().status === 'signing_in') return

    set({ status: 'signing_in', error: null })
    try {
      await startSupabaseLogin()
    } catch (error) {
      set({ ...signedOutState, status: 'error', error: authErrorMessage(error) })
    }
  },

  completeCallback: async url => {
    if (!isSupabaseConfigured()) return false

    set({ status: 'signing_in', error: null })
    try {
      const session = await completeSupabaseCallback(url)
      set({
        status: 'signed_in',
        email: session.user.email ?? session.user.id,
        userId: session.user.id,
        error: null,
      })
      return true
    } catch (error) {
      set({ ...signedOutState, status: 'error', error: authErrorMessage(error) })
      return false
    }
  },

  signOut: async () => {
    if (!isSupabaseConfigured()) return

    try {
      await signOutSupabase()
      set(signedOutState)
    } catch (error) {
      set({ status: 'error', error: authErrorMessage(error) })
    }
  },
}))
