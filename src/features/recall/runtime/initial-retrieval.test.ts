import { expect, it, vi } from 'vitest'
import { retrieveInitialEvidence } from './initial-retrieval'
import { fixtureContext } from './fixtures/context'
import type { ClipReadResult, ClipSearchResult } from '../contracts.generated'
import type { NativeAgentBridge } from './native'

const clip = {
  id: 'clip',
  revision: 'r1',
  capturedAt: 1,
  sourceAppId: null,
  sourceAppName: null,
  favorite: false,
  pinned: false,
  tags: [],
  representations: [],
  ocrStatus: 'unavailable',
}
const read: ClipReadResult = {
  apiVersion: 1,
  clip,
  representationId: 'text',
  kind: 'captured',
  text: 'Deployment notes',
  textFingerprint: 'hash',
  totalBytes: 16,
  nextCursor: null,
  warnings: [],
}
const matches: ClipSearchResult = {
  apiVersion: 1,
  items: [{ clip, snippet: 'Deployment', rank: 1, sources: ['keyword'] }],
  exhaustive: true,
  nextCursor: null,
  sourceOutcomes: [],
  warnings: [],
}

it('prepares bounded evidence even without model tools, using frozen filters', async () => {
  const context = fixtureContext()
  context.preset.capabilities.tools = false
  const tool = vi.fn<NativeAgentBridge['tool']>((_run, name) =>
    Promise.resolve(name === 'search_clips' ? matches : read)
  )
  const result = await retrieveInitialEvidence(
    context,
    'Deployment',
    4096,
    { tool },
    new AbortController().signal
  )
  expect(result.sources).toEqual([read])
  expect(result.state).toBe('ready')
  expect(tool.mock.calls.map(call => call[1])).toEqual(['search_clips', 'read_clip'])
  expect(tool.mock.calls[0]?.[2]).toMatchObject({
    query: 'Deployment',
    filters: context.filters,
    limit: 3,
  })
})

it('falls back to hybrid only after no keyword matches and accounts for both searches', async () => {
  const context = fixtureContext()
  context.status.semanticReady = true
  const tool = vi
    .fn<NativeAgentBridge['tool']>()
    .mockResolvedValueOnce({ ...matches, items: [] })
    .mockResolvedValueOnce(matches)
    .mockResolvedValueOnce(read)
  const result = await retrieveInitialEvidence(
    context,
    'Deployment',
    4096,
    { tool },
    new AbortController().signal
  )
  expect(result.searches).toBe(2)
  expect(tool.mock.calls[1]?.[2]).toMatchObject({ mode: 'hybrid' })
})

it('preserves explicit attachments and skips automatic work without budget', async () => {
  const context = fixtureContext()
  context.attachments = [read]
  const tool = vi.fn<NativeAgentBridge['tool']>().mockResolvedValue(matches)
  expect(
    (
      await retrieveInitialEvidence(
        context,
        'Deployment',
        4096,
        { tool },
        new AbortController().signal
      )
    ).sources
  ).toEqual([])
  expect(tool).toHaveBeenCalledTimes(1)
  tool.mockClear()
  expect(
    (
      await retrieveInitialEvidence(
        context,
        'Deployment',
        100,
        { tool },
        new AbortController().signal
      )
    ).state
  ).toBe('budget')
  expect(tool).not.toHaveBeenCalled()
})

it('does not inject oversized results and distinguishes failure from no matches', async () => {
  const tool = vi
    .fn<NativeAgentBridge['tool']>()
    .mockResolvedValueOnce(matches)
    .mockResolvedValueOnce({ ...read, text: '大'.repeat(5000) })
  const context = fixtureContext()
  const result = await retrieveInitialEvidence(
    context,
    'Deployment',
    2048,
    { tool },
    new AbortController().signal
  )
  expect(result.sources).toEqual([])
  expect(result.incomplete).toBe(true)
  tool.mockRejectedValueOnce(new Error('unavailable'))
  expect(
    (
      await retrieveInitialEvidence(
        context,
        'Deployment',
        2048,
        { tool },
        new AbortController().signal
      )
    ).state
  ).toBe('unavailable')
})

it('propagates cancellation instead of continuing to generation', async () => {
  const controller = new AbortController()
  const tool = vi.fn<NativeAgentBridge['tool']>().mockImplementation(() => {
    controller.abort()
    return Promise.resolve(matches)
  })
  await expect(
    retrieveInitialEvidence(fixtureContext(), 'Deployment', 4096, { tool }, controller.signal)
  ).rejects.toThrow()
  expect(tool).toHaveBeenCalledTimes(1)
})

it('injects and cites automatic evidence without sending model tools or fabricating calls', async () => {
  const { createRecallAdapter } = await import('./adapter')
  const { default: streams } = await import('./fixtures/streams.json')
  const context = fixtureContext('ollama')
  context.preset.capabilities.tools = false
  const tool = vi.fn<NativeAgentBridge['tool']>((_run, name) =>
    Promise.resolve(name === 'search_clips' ? matches : read)
  )
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          streams.ollama.text
            .map(
              record =>
                'data: ' +
                JSON.stringify(record).replace('verified', 'verified [1](#clip-1)') +
                '\n\n'
            )
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      )
    )
  const adapter = createRecallAdapter({
    initialRetrieval: () => 'Deployment',
    configuration: () => ({
      presetId: 'preset',
      filters: context.filters,
      attachments: [],
      webEnabled: false,
    }),
    bridge: {
      begin: request => Promise.resolve({ ...context, runId: request.runId }),
      tool,
      finish: vi.fn().mockResolvedValue(undefined),
      verifyTools: vi.fn(),
    },
    transport: () => transport,
  })
  const updates = adapter.run({
    messages: [
      {
        id: 'question',
        role: 'user',
        content: [{ type: 'text', text: 'Deployment' }],
        createdAt: new Date(),
        attachments: [],
        metadata: { custom: {} },
      },
    ],
    abortSignal: new AbortController().signal,
    runConfig: {},
    context: { tools: {}, config: {} },
    unstable_getMessage: () => {
      throw new Error('unused')
    },
  })
  if (!('next' in updates)) throw new Error('Expected stream')
  let last: import('@assistant-ui/react').ChatModelRunResult | undefined
  for await (const update of updates) last = update
  expect(last?.status).toEqual({ type: 'complete', reason: 'stop' })
  expect(last?.metadata?.custom).toMatchObject({
    initialRetrieval: { state: 'ready' },
    citations: [{ number: 1, clipId: 'clip', revision: 'r1' }],
  })
  expect(last?.content?.some(part => part.type === 'tool-call')).toBe(false)
  const encoded = transport.mock.calls[0]?.[1]?.body
  if (typeof encoded !== 'string') throw new Error('Expected JSON request')
  const body = JSON.parse(encoded) as { tools?: unknown[] }
  expect(body.tools ?? []).toEqual([])
  expect(JSON.stringify(body)).toContain('Deployment notes')
  expect(transport).toHaveBeenCalledTimes(1)
})
