import { describe, expect, it, vi } from 'vitest'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import type { NativeAgentBridge } from './native'
import { fixtureContext } from './fixtures/context'
import type { ChatProvider } from './providers'
import { createRecallAdapter } from './adapter'
import { fixtureBridge } from './fixtures/bridge'
import { createRustFetch } from './transport'
import { fitContext, fitStepContext } from './context'

function question(text: string): ThreadMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: new Date(),
    attachments: [],
    metadata: { custom: {} },
  }
}
function runOptions(controller = new AbortController()): ChatModelRunOptions {
  return {
    messages: [question('Find a relevant clip')],
    abortSignal: controller.signal,
    runConfig: {},
    context: { tools: {}, config: {} },
    unstable_getMessage: () => {
      throw new Error('No pending message')
    },
  }
}
describe('Native Recall agent', () => {
  it.each<ChatProvider>(['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'])(
    '%s shares the native tool adapter in one streamed loop',
    async provider => {
      const context = fixtureContext(provider)
      const native = {
        begin: vi.fn<NativeAgentBridge['begin']>(request =>
          Promise.resolve({ ...context, runId: request.runId })
        ),
        finish: vi.fn(async () => {}),
        tool: vi.fn<NativeAgentBridge['tool']>(() =>
          Promise.resolve({ evidence: 'verified-evidence' })
        ),
        verifyTools: vi.fn(async () => {}),
      }
      const { commands, requests } = fixtureBridge(provider)
      const checkpoint = vi.fn(async () => {})
      const adapter = createRecallAdapter({
        configuration: () => ({
          presetId: 'preset',
          filters: null,
          attachments: [],
          webEnabled: false,
        }),
        bridge: native,
        transport: id => createRustFetch(id, commands),
        onCheckpoint: checkpoint,
      })
      const updates = adapter.run(runOptions())
      if (!('next' in updates)) throw new Error('Expected streaming adapter')
      let last: ChatModelRunResult | undefined
      for await (const update of updates) last = update
      expect(
        last?.content
          ?.filter(p => p.type === 'text')
          .map(p => p.text)
          .join('')
      ).toBe('Recall verified')
      expect(last?.status).toEqual({ type: 'complete', reason: 'stop' })
      expect(native.tool).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'search_clips', {
        query: 'fixture',
      })
      expect(native.finish).toHaveBeenCalledOnce()
      expect(requests).toHaveLength(2)
      expect(requests[1]?.body).toContain('verified-evidence')
      expect(checkpoint.mock.calls.length).toBeLessThanOrEqual(2)
    }
  )
  it('stops before contacting a provider when already cancelled', async () => {
    const native = { begin: vi.fn(), finish: vi.fn(), tool: vi.fn(), verifyTools: vi.fn() }
    const controller = new AbortController()
    controller.abort()
    const adapter = createRecallAdapter({
      configuration: () => ({
        presetId: 'preset',
        filters: null,
        attachments: [],
        webEnabled: false,
      }),
      bridge: native,
    })
    const updates = adapter.run(runOptions(controller))
    if (!('next' in updates)) throw new Error('Expected stream')
    for await (const update of updates)
      expect(update.status).toEqual({ type: 'incomplete', reason: 'cancelled' })
    expect(native.begin).not.toHaveBeenCalled()
  })
  it('preserves the latest question while omitting older context across model switches', () => {
    const context = fixtureContext()
    context.preset.contextLimit = 4096
    const fitted = fitContext([question('古い'.repeat(2000)), question('Latest question')], context)
    expect(fitted.omitted).toBe(true)
    expect(fitted.messages).toEqual([{ role: 'user', content: 'Latest question' }])
    const latest = fitted.messages[0]!
    const bounded = fitStepContext(
      [{ role: 'user', content: 'x'.repeat(4096) }, latest],
      latest,
      context
    )
    expect(bounded.omitted).toBe(true)
    expect(bounded.messages).toEqual([latest])
    expect(() =>
      fitStepContext([latest, { role: 'assistant', content: 'x'.repeat(4096) }], latest, context)
    ).toThrow('context_limit')
  })
})
