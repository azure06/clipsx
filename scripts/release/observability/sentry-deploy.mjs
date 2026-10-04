// Publication is serialized. Retrying public verification must not add another deploy.
import { assert } from '../core/contracts.mjs'
import { command } from '../core/github.mjs'

const { SENTRY_AUTH_TOKEN: token, SENTRY_ORG: organization, SENTRY_RELEASE: version } = process.env
assert(token && organization && version, 'Sentry deployment credentials are required')
const endpoint = `https://sentry.io/api/0/organizations/${encodeURIComponent(organization)}/releases/${encodeURIComponent(version)}/deploys/`
const response = await fetch(endpoint, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(30_000),
})
assert(response.ok, `Cannot inspect Sentry deployments: HTTP ${response.status}`)
const deployments = await response.json()
assert(Array.isArray(deployments), 'Unexpected Sentry deployment response')
if (!deployments.some(item => item.environment === 'production'))
  command('node', [
    'node_modules/@sentry/cli/bin/sentry-cli',
    'releases',
    'deploys',
    version,
    'new',
    '--env',
    'production',
  ])
else console.log('Production deployment already recorded; retry reused it.')
