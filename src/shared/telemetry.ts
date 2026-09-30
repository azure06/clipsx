import { invoke } from '@tauri-apps/api/core'
import * as Sentry from '@sentry/react'

export type TelemetryIdentity = {
  id: string
  email: string | null
  username: string | null
  authProvider: 'google' | 'github' | 'email' | 'unknown'
}

let reportingEnabled = false

type RuntimeSnapshot = {
  appVersion: string
  release: string
  environment: string
  os: string
  osVersion?: string
  arch: string
  webviewEngine: string
  webviewVersion?: string
  userAgent: string
  errorReportingEnabled: boolean
}

let runtime: RuntimeSnapshot | null = null

export async function bootstrapTelemetry(): Promise<void> {
  try {
    runtime = await invoke<RuntimeSnapshot>('bootstrap_telemetry', {
      userAgent: navigator.userAgent,
    })
    reportingEnabled = runtime.errorReportingEnabled
  } catch {
    // A missing bridge or unreadable policy must never prevent the app rendering.
    reportingEnabled = false
    runtime = null
  }
}

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
  if (runtime) {
    event.release = runtime.release
    event.environment = runtime.environment
    event.tags = {
      ...event.tags,
      app_version: runtime.appVersion,
      os: runtime.os,
      arch: runtime.arch,
      webview_engine: runtime.webviewEngine,
      ...(runtime.webviewVersion ? { webview_version: runtime.webviewVersion } : {}),
    }
    event.contexts = {
      ...event.contexts,
      os: { name: runtime.os, ...(runtime.osVersion ? { version: runtime.osVersion } : {}) },
      webview: { user_agent: runtime.userAgent },
    }
    if (runtime.userAgent) event.request = { headers: { 'User-Agent': runtime.userAgent } }
  }
  if (event.message) event.message = 'A desktop webview failure occurred'
  event.exception?.values?.forEach(value => {
    value.value = 'A desktop webview failure occurred'
  })
  event.breadcrumbs = event.breadcrumbs
    ?.filter(breadcrumb => breadcrumb.category?.startsWith('clipsx.'))
    .map(breadcrumb => ({
      category: breadcrumb.category,
      message: breadcrumb.category,
      level: breadcrumb.level,
      timestamp: breadcrumb.timestamp,
    }))
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
  reportingEnabled = Boolean(runtime) && enabled
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
