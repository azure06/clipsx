import { describe, expect, it } from 'vitest'

import { validateProductionEnvironment } from './production-env.mjs'

const valid = {
  VITE_SUPABASE_URL: 'https://project-ref.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  VITE_SUPABASE_AUTH_PROVIDER: 'google',
  VITE_NEXT_PUBLIC_SITE_URL: 'https://clipsx.app',
}

describe('production environment validation', () => {
  it('accepts explicit HTTPS production origins', () => {
    expect(validateProductionEnvironment(valid)).toEqual({
      supabaseUrl: 'https://project-ref.supabase.co',
      websiteOrigin: 'https://clipsx.app',
      provider: 'google',
    })
  })

  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])(
    'rejects a loopback Supabase origin: %s',
    supabaseUrl => {
      expect(() =>
        validateProductionEnvironment({ ...valid, VITE_SUPABASE_URL: supabaseUrl })
      ).toThrow(/non-loopback HTTPS origin/)
    }
  )

  it('rejects a Supabase secret key', () => {
    expect(() =>
      validateProductionEnvironment({
        ...valid,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_embed_this',
      })
    ).toThrow(/must never contain/)
  })

  it('requires the reviewed production provider', () => {
    expect(() =>
      validateProductionEnvironment({ ...valid, VITE_SUPABASE_AUTH_PROVIDER: 'github' })
    ).toThrow(/must be google/)
  })
})
