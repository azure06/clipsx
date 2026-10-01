import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Sentry from '@sentry/react'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), init: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@sentry/react', () => ({ init: mocks.init, reactErrorHandler: vi.fn() }))

const snapshot = {
  appVersion: '1.2.3',
  release: 'clipsx-desktop@1.2.3+abcdef',
  environment: 'production',
  os: 'windows',
  osVersion: '10.0.26100',
  arch: 'x86_64',
  webviewEngine: 'WebView2',
  webviewVersion: '130.0',
  userAgent: 'Mozilla/5.0 TestWebview/130.0',
  errorReportingEnabled: true,
}

async function load() {
  const telemetry = await import('./telemetry')
  const options = mocks.init.mock.calls[0]?.[0] as Parameters<typeof Sentry.init>[0]
  return {
    telemetry,
    beforeSend: (event: Omit<Sentry.ErrorEvent, 'type'>, hint: Sentry.EventHint) =>
      options.beforeSend!({ ...event, type: undefined }, hint),
  }
}

describe('desktop telemetry boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue(snapshot)
  })

  it('stays disabled before bootstrap and honors saved opt-out', async () => {
    mocks.invoke.mockResolvedValue({ ...snapshot, errorReportingEnabled: false })
    const { telemetry, beforeSend } = await load()
    expect(await beforeSend({ message: 'early failure' }, {})).toBeNull()
    await telemetry.bootstrapTelemetry()
    expect(await beforeSend({ message: 'later failure' }, {})).toBeNull()
  })

  it('enriches events with authoritative metadata and only the UA header', async () => {
    const { telemetry, beforeSend } = await load()
    await telemetry.bootstrapTelemetry()
    expect(mocks.invoke).toHaveBeenCalledWith('bootstrap_telemetry', {
      userAgent: navigator.userAgent,
    })
    const event = await beforeSend(
      {
        message: 'private-content-sentinel',
        exception: { values: [{ type: 'Error', value: 'private-content-sentinel' }] },
        extra: { clipboard: 'private-content-sentinel' },
        request: {
          url: 'https://private-content-sentinel/',
          headers: { Cookie: 'private-content-sentinel' },
          data: 'private-content-sentinel',
        },
        breadcrumbs: [
          { category: 'http', message: 'private-content-sentinel' },
          {
            category: 'clipsx.error',
            message: 'private-content-sentinel',
            data: { content: 'private-content-sentinel' },
          },
        ],
      },
      {}
    )
    expect(event).toMatchObject({
      release: snapshot.release,
      environment: 'production',
      tags: {
        app_version: '1.2.3',
        os: 'windows',
        arch: 'x86_64',
        webview_engine: 'WebView2',
        webview_version: '130.0',
      },
      contexts: {
        os: { name: 'windows', version: snapshot.osVersion },
        webview: { user_agent: snapshot.userAgent },
      },
      request: { headers: { 'User-Agent': snapshot.userAgent } },
    })
    expect(event?.request).toEqual({ headers: { 'User-Agent': snapshot.userAgent } })
    expect(JSON.stringify(event)).not.toContain('private-content-sentinel')
    telemetry.setDesktopErrorReportingEnabled(false)
    expect(await beforeSend({ message: 'failure' }, {})).toBeNull()
    telemetry.setDesktopErrorReportingEnabled(true)
    expect(await beforeSend({ message: 'failure' }, {})).not.toBeNull()
  })

  it('fails closed if bootstrap cannot read the policy', async () => {
    mocks.invoke.mockRejectedValue(new Error('bridge unavailable'))
    const { telemetry, beforeSend } = await load()
    await expect(telemetry.bootstrapTelemetry()).resolves.toBeUndefined()
    telemetry.setDesktopErrorReportingEnabled(true)
    expect(await beforeSend({ message: 'failure' }, {})).toBeNull()
  })

  it.each([false, true])(
    'honors newer settings (%s) when bootstrap resolves late',
    async enabled => {
      let resolve!: (value: typeof snapshot) => void
      mocks.invoke.mockReturnValue(
        new Promise<typeof snapshot>(done => {
          resolve = done
        })
      )
      const { telemetry, beforeSend } = await load()
      const pending = telemetry.bootstrapTelemetry()
      telemetry.setDesktopErrorReportingEnabled(enabled)
      expect(await beforeSend({ message: 'before metadata' }, {})).toBeNull()
      resolve({ ...snapshot, errorReportingEnabled: !enabled })
      await pending
      expect((await beforeSend({ message: 'after metadata' }, {})) !== null).toBe(enabled)
    }
  )

  it('omits unavailable runtime versions', async () => {
    const { osVersion: _os, webviewVersion: _webview, ...partial } = snapshot
    mocks.invoke.mockResolvedValue(partial)
    const { telemetry, beforeSend } = await load()
    await telemetry.bootstrapTelemetry()
    const event = await beforeSend({ message: 'failure' }, {})
    expect(event?.tags).not.toHaveProperty('webview_version')
    expect(event?.contexts?.os).toEqual({ name: 'windows' })
  })
})
