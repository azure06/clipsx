const BASE_CONNECT_SOURCES = ["'self'", 'http://localhost:5173', 'ipc://localhost']

const BASE_CSP = [
  "default-src 'self' http://localhost:5173",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tauri.localhost asset: http://asset.localhost clipsx-asset: http://clipsx-asset.localhost",
  "media-src 'self' data: blob: https://tauri.localhost asset: http://asset.localhost clipsx-asset: http://clipsx-asset.localhost",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
]

const isLoopbackHost = hostname =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export const getSupabaseConnectOrigin = rawUrl => {
  if (!rawUrl?.trim()) {
    throw new Error('VITE_SUPABASE_URL is required to generate the Tauri authentication CSP.')
  }

  let url
  try {
    url = new globalThis.URL(rawUrl.trim())
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid URL.')
  }

  const isOriginOnly =
    url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
  const isHttps = url.protocol === 'https:'
  const isAllowedLocalHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname)

  if (!isOriginOnly || (!isHttps && !isAllowedLocalHttp)) {
    throw new Error(
      'VITE_SUPABASE_URL must be an HTTPS origin or a local loopback HTTP origin without a path.'
    )
  }

  return url.origin
}

export const createTauriAuthCspConfig = supabaseUrl => {
  const connectSources = [...BASE_CONNECT_SOURCES, getSupabaseConnectOrigin(supabaseUrl)]
  const csp = [
    ...BASE_CSP.slice(0, 5),
    `connect-src ${connectSources.join(' ')}`,
    ...BASE_CSP.slice(5),
  ].join('; ')

  return { app: { security: { csp } } }
}
