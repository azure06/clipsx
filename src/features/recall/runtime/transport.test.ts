import { describe, expect, it, vi } from 'vitest'
import { createRustFetch } from './transport'
import type { BridgeCommands } from './transport'
import { createFixtureAdapter, FIXTURE_IMAGE } from './fixtures/adapter'
import { fixtureBridge } from './fixtures/bridge'
import type { ChatProvider } from './providers'

describe('Recall runtime gate', () => {
  it('acknowledges a chunk only after its consumer requests it', async () => {
    let receive: Parameters<BridgeCommands['start']>[1] | undefined
    const commands: BridgeCommands = {
      start: vi.fn<BridgeCommands['start']>((_, callback) => {
        receive = callback
        callback({ type: 'headers', status: 200, headers: {} })
        callback({ type: 'chunk', sequence: 1, bytes: [65] })
        return Promise.resolve()
      }),
      acknowledge: vi.fn<BridgeCommands['acknowledge']>(() => {
        receive?.({ type: 'terminal', code: null })
        return Promise.resolve()
      }),
      cancel: vi.fn(() => Promise.resolve()),
    }
    const response = await createRustFetch('fixture-run', commands)(
      'https://fixture.invalid/v1/responses',
      { method: 'POST', body: '{}' }
    )
    expect(commands.acknowledge).not.toHaveBeenCalled()
    expect(await response.text()).toBe('A')
    expect(commands.acknowledge).toHaveBeenCalledOnce()
  })

  it('propagates a terminal failure after headers to the response reader', async () => {
    let receive: Parameters<BridgeCommands['start']>[1] | undefined
    const commands: BridgeCommands = {
      start: (_, callback) => {
        receive = callback
        callback({ type: 'headers', status: 200, headers: {} })
        return Promise.resolve()
      },
      acknowledge: vi.fn(),
      cancel: vi.fn(),
    }
    const response = await createRustFetch('fixture-run', commands)(
      'https://fixture.invalid/v1/responses',
      { method: 'POST', body: '{}' }
    )
    const reading = response.text()
    receive?.({ type: 'terminal', code: 'provider_timeout' })
    await expect(reading).rejects.toThrow('Recall transport: provider_timeout')
  })

  it.each<ChatProvider>(['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'])(
    '%s streams an image request and a tool round trip through the Rust-fetch contract',
    async provider => {
      const { commands, requests } = fixtureBridge(provider)
      const search = vi.fn(() => Promise.resolve({ evidence: 'verified-evidence' }))
      const adapter = createFixtureAdapter(
        { id: provider, provider, baseUrl: `https://fixture.invalid/${provider}/v1` },
        createRustFetch('fixture-run', commands),
        search
      )
      const updates = adapter.run({
        messages: [],
        abortSignal: new AbortController().signal,
        runConfig: {},
        context: { tools: {}, config: {} },
        unstable_getMessage: () => {
          throw new Error('Fixture has no pending UI message')
        },
      })
      if (!('next' in updates)) throw new Error('Expected streaming adapter')
      const texts: string[] = []
      for await (const update of updates) {
        if ('content' in update && update.content)
          texts.push(update.content.map(part => (part.type === 'text' ? part.text : '')).join(''))
      }
      expect(texts).toEqual(['Recall ', 'Recall verified'])
      expect(search).toHaveBeenCalledTimes(1)
      expect(requests).toHaveLength(2)
      expect(requests[0]?.body).toContain(FIXTURE_IMAGE)
      expect(requests[1]?.body).toContain('verified-evidence')
      expect(requests.every(request => !request.body.includes('host-private-key'))).toBe(true)
    }
  )

  it('cancels before the start acknowledgement without leaving a native request running', async () => {
    let release: (() => void) | undefined
    const commands: BridgeCommands = {
      start: vi.fn(
        () =>
          new Promise<void>(resolve => {
            release = resolve
          })
      ),
      acknowledge: vi.fn(),
      cancel: vi.fn(() => Promise.resolve()),
    }
    const controller = new AbortController()
    const response = createRustFetch('fixture-run', commands)(
      'https://fixture.invalid/v1/responses',
      { method: 'POST', body: '{}', signal: controller.signal }
    )
    await vi.waitFor(() => expect(commands.start).toHaveBeenCalledOnce())
    controller.abort()
    await expect(response).rejects.toMatchObject({ name: 'AbortError' })
    release?.()
    await vi.waitFor(() => expect(commands.cancel).toHaveBeenCalledOnce())
  })
})
