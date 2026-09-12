const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const required = (environment, name) => {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required in .env.production.local.`)
  return value
}

const httpsOrigin = (environment, name) => {
  const value = required(environment, name)
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL.`)
  }
  if (
    url.protocol !== 'https:' ||
    loopbackHosts.has(url.hostname) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${name} must be a non-loopback HTTPS origin without a path.`)
  }
  return url.origin
}

const legacyJwtRole = value => {
  if (!value.startsWith('eyJ')) return null
  try {
    const payload = value.split('.')[1]
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role ?? null
  } catch {
    return null
  }
}

export const validateProductionEnvironment = environment => {
  const supabaseUrl = httpsOrigin(environment, 'VITE_SUPABASE_URL')
  const websiteOrigin = httpsOrigin(environment, 'VITE_NEXT_PUBLIC_SITE_URL')
  const publishableKey = required(environment, 'VITE_SUPABASE_PUBLISHABLE_KEY')
  const provider = required(environment, 'VITE_SUPABASE_AUTH_PROVIDER')

  if (publishableKey.startsWith('sb_secret_') || legacyJwtRole(publishableKey) === 'service_role') {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must never contain a secret or service-role key.'
    )
  }
  if (!publishableKey.startsWith('sb_publishable_') && !publishableKey.startsWith('eyJ')) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY is not a recognized publishable or legacy anon key.'
    )
  }
  if (provider !== 'google') {
    throw new Error(
      'VITE_SUPABASE_AUTH_PROVIDER must be google for the current production release.'
    )
  }

  return { supabaseUrl, websiteOrigin, provider }
}
