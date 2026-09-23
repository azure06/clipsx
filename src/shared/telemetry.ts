import { invoke } from '@tauri-apps/api/core'
import * as Sentry from '@sentry/react'

export type TelemetryIdentity = {
  id: string
  email: string | null
  username: string | null
  authProvider: 'google' | 'github' | 'email' | 'unknown'
}

let reportingEnabled = true

const sentryEnabled =
  Boolean(import.meta.env['VITE_SENTRY_DSN']) &&
  (import.meta.env.PROD || import.meta.env['VITE_SENTRY_ENABLED'] === 'true')

const sanitizeEvent = <
  T extends Parameters<NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>>[0],
>(
  event: T
): T => {
  delete event.request
  delete event.extra
  if (event.message) event.message = 'A desktop webview failure occurred'
  event.exception?.values?.forEach(value => {
    value.value = 'A desktop webview failure occurred'
  })
  event.breadcrumbs = event.breadcrumbs?.filter(breadcrumb =>
    breadcrumb.category?.startsWith('clipsx.')
  )
  return event
}

Sentry.init({
  dsn: import.meta.env['VITE_SENTRY_DSN'],
  enabled: sentryEnabled,
  release: import.meta.env['VITE_SENTRY_RELEASE'],
  environment: import.meta.env.MODE,
  sendDefaultPii: false,
  enableLogs: false,
  tracesSampleRate: 0,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
    frameContextLines: 5,
  },
  beforeSend: event => (reportingEnabled ? sanitizeEvent(event) : null),
  beforeBreadcrumb: breadcrumb => (breadcrumb.category?.startsWith('clipsx.') ? breadcrumb : null),
  initialScope: {
    tags: { layer: 'webview' },
  },
})

export const reactErrorHandler = Sentry.reactErrorHandler

export function setDesktopErrorReportingEnabled(enabled: boolean): void {
  reportingEnabled = enabled
}

export function addTelemetryBreadcrumb(event: string): void {
  Sentry.addBreadcrumb({ category: `clipsx.${event}`, message: event, level: 'info' })
}

export async function setTelemetryIdentity(identity: TelemetryIdentity | null): Promise<void> {
  if (identity) {
    Sentry.setUser({
      id: identity.id.slice(0, 128),
      email: identity.email?.slice(0, 254),
      username: identity.username?.slice(0, 100),
    })
    Sentry.setTag('auth_provider', identity.authProvider)
  } else {
    Sentry.setUser(null)
    Sentry.setTag('auth_provider', 'signed_out')
  }
  await invoke('set_telemetry_identity', { identity }).catch(() => undefined)
}

export function captureHandledError(code: string): void {
  if (!reportingEnabled) return
  Sentry.withScope(scope => {
    scope.setTag('error_code', code)
    Sentry.captureMessage('A handled desktop failure occurred', 'error')
  })
}

export function captureBoundaryError(error: Error): string | null {
  return reportingEnabled ? Sentry.captureException(error) : null
}
