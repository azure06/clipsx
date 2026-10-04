import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, encode } from './contracts.mjs'

export function publicEnvironment(env = process.env) {
  return {
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || '',
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    VITE_NEXT_PUBLIC_SITE_URL: env.VITE_NEXT_PUBLIC_SITE_URL || '',
    VITE_SENTRY_DSN: env.SENTRY_DESKTOP_DSN ?? env.VITE_SENTRY_DSN ?? env.SENTRY_DSN ?? '',
  }
}
export function assertPublicEnvironment(candidate, env = process.env) {
  assert(
    encode(publicEnvironment(env)) === encode(candidate.build.publicEnvironment),
    'Production build variables changed; start a new build'
  )
}
export function consumerEnvironment(env = process.env, mode = 'production') {
  const values = publicEnvironment(env)
  return {
    ...values,
    VITE_SENTRY_DSN: mode === 'checks' ? '' : values.VITE_SENTRY_DSN,
    SENTRY_DSN: values.VITE_SENTRY_DSN,
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, value] of Object.entries(consumerEnvironment(process.env, process.argv[2]))) {
    assert(!/[\r\n]/.test(value), `Invalid public environment value: ${name}`)
    appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`)
  }
}
