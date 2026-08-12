import { describe, expect, it } from 'vitest'
import { createTauriAuthCspConfig, getSupabaseConnectOrigin } from './tauri-auth-csp.mjs'

describe('Tauri authentication CSP generation', () => {
  it('includes the exact Supabase origin and the V2 asset protocols', () => {
    const config = createTauriAuthCspConfig('https://project-ref.supabase.co')
    const csp = config.app.security.csp

    expect(getSupabaseConnectOrigin('https://project-ref.supabase.co')).toBe(
      'https://project-ref.supabase.co'
    )
    expect(csp).toContain('connect-src')
    expect(csp).toContain('https://project-ref.supabase.co')
    expect(csp).toContain('clipsx-asset:')
    expect(csp).not.toContain('https://*.supabase.co')
  })

  it.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321'])(
    'accepts a local loopback Supabase origin: %s',
    origin => {
      expect(getSupabaseConnectOrigin(origin)).toBe(origin)
    }
  )

  it.each([
    undefined,
    'not a URL',
    'http://supabase.example.com',
    'ftp://project-ref.supabase.co',
    'https://project-ref.supabase.co/rest/v1',
  ])('rejects an unsafe Supabase URL: %s', origin => {
    expect(() => getSupabaseConnectOrigin(origin)).toThrow()
  })
})
