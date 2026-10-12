import { describe, expect, it, vi } from 'vitest'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import type { NativeAgentBridge } from './native'
import { fixtureContext } from './fixtures/context'
import type { ChatProvider } from './providers'
import { createRecallAdapter, transportFailure } from './adapter'
import { fixtureBridge } from './fixtures/bridge'
import { createRustFetch } from './transport'
import { fitContext, fitStepContext } from './context'
import streams from './fixtures/streams.json'
import { fallbackPolicy } from './planner'

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

it('compacts through the selected provider before continuing the same native tool loop', async () => {
  const context = fixtureContext('ollama')
  context.executionPolicy = fallbackPolicy(12000, 2000)
  const native: NativeAgentBridge = {
    begin: request => Promise.resolve({ ...context, runId: request.runId }),
    finish: vi.fn(async () => {}),
    verifyTools: vi.fn(async () => {}),
    tool: vi.fn(async () => ({ evidence: 'verified-evidence' })),
  }
  const { commands, requests } = fixtureBridge('ollama')
  const summaries: Record<string, unknown>[] = []
  const adapter = createRecallAdapter({
    configuration: () => ({
      presetId: 'preset',
      filters: null,
      attachments: [],
      webEnabled: false,
    }),
    bridge: native,
    transport: id => {
      const transport = createRustFetch(id, commands)
      return async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (body['stream'] !== true) {
          summaries.push(body)
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: { role: 'assistant', content: 'Preserved earlier goal.' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 100, completion_tokens: 10 },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        }
        return transport(url, init)
      }
    },
  })
  const input = runOptions()
  input.messages = [
    question('a'.repeat(4500)),
    {
      ...question('b'.repeat(4500)),
      role: 'assistant',
      status: { type: 'complete', reason: 'stop' },
    } as ThreadMessage,
    ...input.messages,
  ]
  const updates = adapter.run(input)
  if (!('next' in updates)) throw new Error('Expected streaming adapter')
  const states: string[] = []
  let last: ChatModelRunResult | undefined
  for await (const update of updates) {
    last = update
    states.push(JSON.stringify(update.metadata?.custom?.['contextStatus']))
  }
  expect(summaries).toHaveLength(1)
  expect(summaries[0]?.['tools']).toBeUndefined()
  expect(summaries[0]?.['model']).toBe('fixture-model')
  expect(requests).toHaveLength(2)
  expect(requests[0]?.body).toContain('Preserved earlier goal')
  expect(native.tool).toHaveBeenCalledTimes(1)
  expect(states.some(state => state?.includes('compacting'))).toBe(true)
  expect(last?.status?.type).toBe('complete')
  expect(last?.metadata?.custom?.['summaryInputTokens']).toBe(100)
})
describe('Native Recall agent', () => {
  it.each<ChatProvider>(['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'])(
    '%s shares the native tool adapter in one streamed loop',
    async provider => {
      const context = fixtureContext(provider)
      if (provider === 'openai') context.preset.modelId = 'gpt-5'
      context.reasoning =
        provider === 'openrouter'
          ? { kind: 'budget', tokens: 1024 }
          : provider === 'ollama'
            ? { kind: 'thinking', enabled: true }
            : { kind: 'effort', value: 'high' }
      context.attachments = [
        {
          apiVersion: 1,
          clip: {
            id: 'attached',
            revision: 'r1',
            capturedAt: 1,
            sourceAppId: null,
            sourceAppName: null,
            favorite: false,
            pinned: false,
            tags: [],
            representations: [],
            ocrStatus: 'unavailable',
          },
          representationId: null,
          kind: 'captured',
          text: 'Attached evidence',
          textFingerprint: 'hash',
          totalBytes: 17,
          nextCursor: null,
          warnings: [],
        },
      ]
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
      expect(last?.metadata?.custom?.['citations']).toEqual([
        { number: 1, clipId: 'attached', revision: 'r1' },
      ])
      expect(checkpoint).toHaveBeenLastCalledWith(expect.any(String), last, true)
      expect(native.tool).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'search_clips', {
        query: 'fixture',
        limit: 3,
      })
      expect(native.finish).toHaveBeenCalledOnce()
      expect(requests).toHaveLength(2)
      const requestBody: unknown = JSON.parse(requests[0]?.body ?? '{}')
      expect(requestBody).toMatchObject(
        {
          openai: { reasoning: { effort: 'high', summary: 'auto' } },
          anthropic: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } },
          gemini: {
            generationConfig: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } },
          },
          openrouter: { reasoning: { max_tokens: 1024 } },
          ollama: { reasoning_effort: 'low' },
        }[provider]
      )
      expect(requests[1]?.body).toContain('verified-evidence')
      expect(checkpoint.mock.calls.length).toBeLessThanOrEqual(2)
    }
  )
  it('streams provider reasoning as a separate persisted part, retaining tool activity and the answer', async () => {
    const context = fixtureContext('ollama')
    const bridge: NativeAgentBridge = {
      begin: request => Promise.resolve({ ...context, runId: request.runId }),
      finish: vi.fn(async () => {}),
      verifyTools: vi.fn(async () => {}),
      tool: vi.fn(() => Promise.resolve({ items: [] })),
    }
    const { commands } = fixtureBridge('ollama', (records, phase) =>
      phase === 'text'
        ? [
            {
              id: 'fixture',
              model: 'fixture-model',
              created: 1,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: 'Inspect the matching source.' },
                  finish_reason: null,
                },
              ],
            },
            ...records,
          ]
        : records
    )
    const checkpoint = vi.fn(async () => {})
    const adapter = createRecallAdapter({
      configuration: () => ({
        presetId: 'preset',
        filters: null,
        attachments: [],
        webEnabled: false,
      }),
      bridge,
      transport: id => createRustFetch(id, commands),
      onCheckpoint: checkpoint,
    })
    const updates = adapter.run(runOptions())
    if (!('next' in updates)) throw new Error('Expected streaming adapter')
    let last: ChatModelRunResult | undefined
    for await (const result of updates) last = result
    expect(last?.content).toContainEqual({
      type: 'reasoning',
      text: 'Inspect the matching source.',
    })
    expect(last?.content?.some(part => part.type === 'tool-call')).toBe(true)
    expect(last?.content).toContainEqual({ type: 'text', text: 'Recall verified' })
    expect(checkpoint).toHaveBeenLastCalledWith(expect.any(String), last, true)
  })
  it('marks structured Rust tool failures as failed in the displayed and persisted message', async () => {
    const context = fixtureContext('ollama')
    const native = {
      begin: vi.fn<NativeAgentBridge['begin']>(request =>
        Promise.resolve({ ...context, runId: request.runId })
      ),
      finish: vi.fn(async () => {}),
      verifyTools: vi.fn(async () => {}),
      tool: vi
        .fn<NativeAgentBridge['tool']>()
        .mockRejectedValue({ code: 'invalid_parameters', message: 'private host content' }),
    }
    const { commands } = fixtureBridge('ollama')
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
    if (!('next' in updates)) throw new Error('Expected stream')
    let last: ChatModelRunResult | undefined
    for await (const update of updates) last = update
    const call = last?.content?.find(part => part.type === 'tool-call')
    expect(call).toMatchObject({ isError: true, result: { error: 'invalid_parameters' } })
    expect(JSON.stringify(checkpoint.mock.calls)).not.toContain('private host content')
    expect(JSON.stringify(checkpoint.mock.calls)).toContain('"isError":true')
  })
  it('isolates the capability probe and restores the user task after a verified round trip', async () => {
    const context = fixtureContext('ollama')
    context.preset.capabilities.tools = null
    context.tools.push({
      name: 'get_clipboard_status',
      description: 'Status',
      inputSchemaJson: JSON.stringify({ type: 'object', properties: {} }),
    })
    const native = {
      begin: vi.fn<NativeAgentBridge['begin']>(request =>
        Promise.resolve({ ...context, runId: request.runId })
      ),
      finish: vi.fn(async () => {}),
      tool: vi.fn<NativeAgentBridge['tool']>((_id, name) =>
        Promise.resolve(name === 'get_clipboard_status' ? { apiVersion: 1 } : { evidence: 'found' })
      ),
      verifyTools: vi.fn(async () => {}),
    }
    const status = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_status',
                  type: 'function',
                  function: { name: 'get_clipboard_status', arguments: '{}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]
    const records = [status, streams.ollama.tool, streams.ollama.text]
    const requests: string[] = []
    const transport = vi.fn<typeof fetch>((_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON request')
      requests.push(init.body)
      return Promise.resolve(
        new Response(
          records[requests.length - 1]!.map(record => `data: ${JSON.stringify(record)}\n\n`).join(
            ''
          ),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      )
    })
    const adapter = createRecallAdapter({
      configuration: () => ({
        presetId: 'preset',
        filters: null,
        attachments: [],
        webEnabled: false,
      }),
      bridge: native,
      transport: () => transport,
    })
    const updates = adapter.run(runOptions())
    if (!('next' in updates)) throw new Error('Expected stream')
    let last: ChatModelRunResult | undefined
    for await (const update of updates) last = update
    expect(last?.status).toEqual({ type: 'complete', reason: 'stop' })
    expect(last?.metadata?.custom?.['toolsAvailable']).toBe(true)
    expect(native.verifyTools).toHaveBeenCalledExactlyOnceWith(expect.any(String), true)
    expect(requests).toHaveLength(3)
    expect(requests[0]).not.toContain('Find a relevant clip')
    expect(requests[0]).toContain('Verify clipboard tool support')
    expect(requests[1]).toContain('Find a relevant clip')
    expect(requests[1]).toContain('call_status')
    expect(requests[1]).not.toContain('Verify clipboard tool support')
    expect(native.tool).toHaveBeenNthCalledWith(1, expect.any(String), 'get_clipboard_status', {})
    expect(native.tool).toHaveBeenNthCalledWith(2, expect.any(String), 'search_clips', {
      query: 'fixture',
      limit: 3,
    })
  })
  it('retries a rejected unknown-capability probe as ordinary chat without tools or actions', async () => {
    const context = fixtureContext('ollama')
    context.preset.capabilities.tools = null
    context.tools.push({
      name: 'get_clipboard_status',
      description: 'Status',
      inputSchemaJson: JSON.stringify({ type: 'object', properties: {} }),
    })
    const native = {
      begin: vi.fn<NativeAgentBridge['begin']>(request =>
        Promise.resolve({ ...context, runId: request.runId })
      ),
      finish: vi.fn(() => Promise.resolve()),
      tool: vi.fn(),
      verifyTools: vi.fn(),
    }
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Recall transport: provider_rejected'))
      .mockResolvedValueOnce(
        new Response(
          streams.ollama.text.map(record => 'data: ' + JSON.stringify(record) + '\n\n').join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      )
    const adapter = createRecallAdapter({
      configuration: () => ({
        presetId: 'preset',
        filters: null,
        attachments: [],
        webEnabled: false,
      }),
      bridge: native,
      transport: () => transport,
    })
    const updates = adapter.run(runOptions())
    if (!('next' in updates)) throw new Error('Expected stream')
    let last: ChatModelRunResult | undefined
    for await (const update of updates) last = update
    expect(last?.status).toEqual({ type: 'complete', reason: 'stop' })
    expect(last?.metadata?.custom).toMatchObject({ toolsAvailable: false, toolsUnavailable: true })
    expect(native.tool).not.toHaveBeenCalled()
    expect(native.verifyTools).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(2)
    const encoded = transport.mock.calls[1]?.[1]?.body
    if (typeof encoded !== 'string') throw new Error('Expected JSON request')
    const body = JSON.parse(encoded) as { tools?: unknown[] }
    expect(body.tools ?? []).toEqual([])
  })
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

describe('curated Recall failures', () => {
  it('retains nested timeout categories and never copies arbitrary error messages', () => {
    expect(
      transportFailure(
        new Error('wrapper', { cause: new Error('Recall transport: request_timeout') })
      )
    ).toBe('request_timeout')
    expect(transportFailure(new Error('private provider body'))).toBe('run_failed')
    expect(transportFailure(new Error('Recall transport: private contents'))).toBe('run_failed')
  })
})
