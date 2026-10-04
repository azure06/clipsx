import { validateProductionEnvironment } from '../../production-env.mjs'
import { assert, repository } from '../core/contracts.mjs'
import { command } from '../core/github.mjs'
import { publicEnvironment } from '../core/environment.mjs'

export function configurePublic() {
  const values = publicEnvironment()
  validateProductionEnvironment(values)
  const variables = {
    VITE_SUPABASE_URL: values.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: values.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_NEXT_PUBLIC_SITE_URL: values.VITE_NEXT_PUBLIC_SITE_URL,
    SENTRY_DESKTOP_DSN: values.VITE_SENTRY_DSN,
  }
  assert(variables.SENTRY_DESKTOP_DSN, 'A public desktop Sentry DSN is required')
  if (process.env.WINDOWS_SIGNING_CERT_THUMBPRINT) {
    assert(
      /^[a-fA-F0-9]{40}$/.test(process.env.WINDOWS_SIGNING_CERT_THUMBPRINT),
      'Invalid Windows certificate thumbprint'
    )
    variables.WINDOWS_SIGNING_CERT_THUMBPRINT =
      process.env.WINDOWS_SIGNING_CERT_THUMBPRINT.toUpperCase()
  }
  for (const [name, value] of Object.entries(variables)) {
    command('gh', ['variable', 'set', name, '--repo', repository, '--body', value])
    console.log(`Configured public repository variable ${name}`)
  }
}
