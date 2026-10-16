import { describe, expect, it, vi } from 'vitest'
import { createClipboardTools } from './tools'
import type { ToolRuntime } from './tools'
import type { NativeAgentBridge } from './native'
import { fixtureContext } from './fixtures/context'
import { CitationRegistry } from './citations'

describe('Rust tool callbacks', () => {
  it('does not admit oversized read metadata or cite evidence it cannot send', async () => {
    const context = fixtureContext()
    context.tools = [
      { name: 'read_clip', description: 'Read', inputSchemaJson: '{"type":"object"}' },
    ]
    const tool = vi.fn<NativeAgentBridge['tool']>().mockResolvedValue({
      clip: { id: 'a', revision: 'r', representations: [{ description: 'x'.repeat(3000) }] },
      text: 'useful text',
    })
    const state: ToolRuntime = {
      searches: 0,
      images: [],
      imageBytes: 0,
      contextRoom: 2000,
      citations: new CitationRegistry(),
    }
    const tools = createClipboardTools(context, { tool } as unknown as NativeAgentBridge, state)
    expect(
      await tools['read_clip']!.execute!(
        { clipId: 'a' },
        { toolCallId: 'read', messages: [], context: undefined }
      )
    ).toMatchObject({ error: 'context_budget_exhausted' })
    expect(state.citations?.snapshot()).toEqual([])
    expect(state.contextRoom).toBeGreaterThanOrEqual(0)
  })
  it('shares one remaining budget across parallel reads', async () => {
    const context = fixtureContext()
    context.tools = [
      { name: 'read_clip', description: 'Read', inputSchemaJson: '{"type":"object"}' },
    ]
    let finishRead!: (result: unknown) => void
    const result = new Promise<unknown>(resolve => {
      finishRead = resolve
    })
    const tool = vi.fn<NativeAgentBridge['tool']>().mockReturnValue(result)
    const state: ToolRuntime = { searches: 0, images: [], imageBytes: 0, contextRoom: 2000 }
    const tools = createClipboardTools(context, { tool } as unknown as NativeAgentBridge, state)
    const execute = tools['read_clip']!.execute!
    const first: unknown = execute(
      { clipId: 'a' },
      { toolCallId: 'first', messages: [], context: undefined }
    )
    const second: unknown = execute(
      { clipId: 'b' },
      { toolCallId: 'second', messages: [], context: undefined }
    )
    await vi.waitFor(() => expect(tool).toHaveBeenCalled())
    finishRead({ clip: { id: 'a', revision: 'r' }, text: 'x'.repeat(1200) })
    await first
    expect(await second).toMatchObject({ error: 'context_budget_exhausted' })
    expect(tool).toHaveBeenCalledOnce()
    expect(state.contextRoom).toBeGreaterThanOrEqual(0)
  })

  it('refuses image reads before fetching bytes when the remaining context is full', async () => {
    const context = fixtureContext()
    context.tools = [
      { name: 'read_clip_image', description: 'Image', inputSchemaJson: '{"type":"object"}' },
    ]
    const tool = vi.fn<NativeAgentBridge['tool']>()
    const tools = createClipboardTools(context, { tool } as unknown as NativeAgentBridge, {
      searches: 0,
      images: [],
      imageBytes: 0,
      contextRoom: 500,
    })
    expect(
      await tools['read_clip_image']!.execute!(
        { clipId: 'a' },
        { toolCallId: 'image', messages: [], context: undefined }
      )
    ).toMatchObject({ error: 'context_budget_exhausted' })
    expect(tool).not.toHaveBeenCalled()
  })
  it('keeps model-driven Undo available with host-owned idempotency', async () => {
    const context = fixtureContext()
    context.tools = [
      {
        name: 'undo_clipboard_action',
        description: 'Undo',
        inputSchemaJson: JSON.stringify({
          type: 'object',
          properties: { requestId: { type: 'string' }, actionId: { type: 'string' } },
          required: ['requestId', 'actionId'],
        }),
      },
    ]
    const tool = vi.fn<NativeAgentBridge['tool']>().mockResolvedValue({ actionId: 'reversed' })
    const tools = createClipboardTools(context, { tool } as unknown as NativeAgentBridge, {
      searches: 0,
      images: [],
      imageBytes: 0,
    })
    const undo = tools['undo_clipboard_action']!
    expect(undo.description).toContain('only when the user requests reversal')
    expect(JSON.stringify(undo.inputSchema)).not.toContain('"requestId"')
    const args = { actionId: 'saved' }
    const options = { toolCallId: 'undo-request', messages: [], context: undefined }
    expect(await undo.execute!(args, options)).toEqual({ actionId: 'reversed' })
    expect(await undo.execute!(args, options)).toEqual({ actionId: 'reversed' })
    expect(tool).toHaveBeenCalledOnce()
    const call = tool.mock.calls[0]!
    expect(call.slice(0, 2)).toEqual([context.runId, 'undo_clipboard_action'])
    expect(call[2]).toMatchObject({ actionId: 'saved' })
    expect(typeof (call[2] as Record<string, unknown>)['requestId']).toBe('string')
  })
  it('guides a rejected read to a corrected retry and cites only the successful evidence', async () => {
    const context = fixtureContext()
    context.tools = [
      { name: 'read_clip', description: 'Read', inputSchemaJson: '{"type":"object"}' },
    ]
    const bridge = {
      begin: vi.fn(),
      finish: vi.fn(),
      verifyTools: vi.fn(),
      tool: vi
        .fn<NativeAgentBridge['tool']>()
        .mockRejectedValueOnce({ code: 'invalid_parameters', message: 'private clipboard content' })
        .mockResolvedValueOnce({ clip: { id: 'source', revision: 'revision' }, text: 'Evidence' }),
    }
    const tools = createClipboardTools(context, bridge, { searches: 0, images: [], imageBytes: 0 })
    const execute = tools['read_clip']!.execute!
    const rejected: unknown = await execute(
      { clipId: 'source', kind: 'text' },
      { toolCallId: 'bad-read', messages: [], context: undefined }
    )
    expect(rejected).toMatchObject({ error: 'invalid_parameters' })
    expect(rejected).toHaveProperty(
      'message',
      expect.stringContaining('kind must be "captured", "ocr", or "note"')
    )
    expect(JSON.stringify(rejected)).not.toContain('private clipboard content')
    expect(rejected).not.toHaveProperty('citation')
    const corrected: unknown = await execute(
      { clipId: 'source', kind: 'captured' },
      { toolCallId: 'corrected-read', messages: [], context: undefined }
    )
    expect(corrected).toMatchObject({
      citation: { number: 1, clipId: 'source', revision: 'revision' },
    })
    expect(bridge.tool).toHaveBeenCalledTimes(2)
  })
  it('gives schema guidance for rejected arguments without exposing raw host errors', async () => {
    const context = fixtureContext()
    context.tools = [
      { name: 'create_clip', description: 'Save', inputSchemaJson: '{"type":"object"}' },
    ]
    const bridge = {
      begin: vi.fn(),
      finish: vi.fn(),
      verifyTools: vi.fn(),
      tool: vi
        .fn<NativeAgentBridge['tool']>()
        .mockRejectedValue({ code: 'invalid_parameters', message: 'private provider content' }),
    }
    const tools = createClipboardTools(context, bridge, { searches: 0, images: [], imageBytes: 0 })
    const result: unknown = await tools['create_clip']!.execute!(
      { format: 'text/plain' },
      { toolCallId: 'invalid', messages: [], context: undefined }
    )
    expect(result).toMatchObject({
      error: 'invalid_parameters',
    })
    expect(JSON.stringify(result)).toContain('plain_text')
    expect(JSON.stringify(result)).not.toContain('private provider content')
  })
  it('reuses an admitted mutation and rejects changed arguments with the same call ID', async () => {
    const context = fixtureContext()
    context.tools = [
      {
        name: 'create_clip',
        description: 'Save text',
        inputSchemaJson: JSON.stringify({
          type: 'object',
          properties: { requestId: { type: 'string' }, text: { type: 'string' } },
          required: ['requestId', 'text'],
        }),
      },
    ]
    const bridge = {
      begin: vi.fn(),
      finish: vi.fn(),
      verifyTools: vi.fn(),
      tool: vi.fn<NativeAgentBridge['tool']>(() => Promise.resolve({ actionId: 'saved' })),
    }
    const state: ToolRuntime = { searches: 0, images: [], imageBytes: 0 }
    const tools = createClipboardTools(context, bridge, state)
    expect(JSON.stringify(tools['create_clip']!.inputSchema)).toContain('"text"')
    expect(JSON.stringify(tools['create_clip']!.inputSchema)).not.toContain('"requestId"')
    const execute = tools['create_clip']!.execute!
    const options = { toolCallId: 'call1', messages: [], context: undefined }
    expect(await execute({ text: 'hello' }, options)).toEqual({ actionId: 'saved' })
    expect(await execute({ text: 'hello' }, options)).toEqual({ actionId: 'saved' })
    expect(bridge.tool).toHaveBeenCalledOnce()
    expect(bridge.tool.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ text: 'hello' }))
    expect(bridge.tool.mock.calls[0]?.[2]).toHaveProperty('requestId')
    await expect(execute({ text: 'changed' }, options)).rejects.toThrow('tool_call_conflict')
  })
  it('bounds refinement and returns a clear incomplete-retrieval outcome', async () => {
    const bridge = {
      begin: vi.fn(),
      finish: vi.fn(),
      verifyTools: vi.fn(),
      tool: vi.fn<NativeAgentBridge['tool']>(() => Promise.resolve({ items: [] })),
    }
    const tools = createClipboardTools(fixtureContext(), bridge, {
      searches: 0,
      images: [],
      imageBytes: 0,
    })
    const execute = tools['search_clips']!.execute!
    for (let i = 0; i < 3; i++)
      await execute(
        { query: `refinement ${i}` },
        { toolCallId: `call${i}`, messages: [], context: undefined }
      )
    expect(
      await execute({ query: 'fourth' }, { toolCallId: 'call4', messages: [], context: undefined })
    ).toMatchObject({ error: 'search_round_limit' })
    expect(bridge.tool).toHaveBeenCalledTimes(3)
  })
  it('refuses reads and searches once the model context has no room left', async () => {
    const bridge = {
      begin: vi.fn(),
      finish: vi.fn(),
      verifyTools: vi.fn(),
      tool: vi.fn<NativeAgentBridge['tool']>(() => Promise.resolve({ items: [] })),
    }
    const context = fixtureContext()
    context.tools = ['read_clip', 'search_clips'].map(name => ({
      name,
      description: name,
      inputSchemaJson: '{"type":"object"}',
    }))
    const state: ToolRuntime = { searches: 0, images: [], imageBytes: 0, contextRoom: 500 }
    const tools = createClipboardTools(context, bridge, state)
    const options = (toolCallId: string) => ({ toolCallId, messages: [], context: undefined })

    expect(await tools['read_clip']!.execute!({ clipId: 'a' }, options('read'))).toMatchObject({
      error: 'context_budget_exhausted',
    })
    expect(await tools['search_clips']!.execute!({ query: 'a' }, options('search'))).toMatchObject({
      error: 'context_budget_exhausted',
    })
    expect(bridge.tool).not.toHaveBeenCalled()
    expect(state.searches).toBe(0)
  })
  it('clamps page size to the remaining room and spends it', async () => {
    const bridge = {
      begin: vi.fn(),
      finish: vi.fn(),
      verifyTools: vi.fn(),
      tool: vi.fn<NativeAgentBridge['tool']>(() =>
        Promise.resolve({
          clip: { id: 'a', revision: 'r' },
          text: 'x'.repeat(100),
        })
      ),
    }
    const context = fixtureContext()
    context.tools = ['read_clip', 'search_clips'].map(name => ({
      name,
      description: name,
      inputSchemaJson: '{"type":"object"}',
    }))
    const state: ToolRuntime = { searches: 0, images: [], imageBytes: 0, contextRoom: 2000 }
    const tools = createClipboardTools(context, bridge, state)
    await tools['read_clip']!.execute!(
      { clipId: 'a', pageBytes: 8192 },
      { toolCallId: 'page', messages: [], context: undefined }
    )

    expect(bridge.tool.mock.calls[0]?.[2]).toMatchObject({ pageBytes: 1232 })
    expect(state.contextRoom).toBeLessThan(2000 - 100)
  })
})
