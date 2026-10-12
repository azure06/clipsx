import { describe, expect, it, vi } from 'vitest'
import { createClipboardTools } from './tools'
import type { ToolRuntime } from './tools'
import type { NativeAgentBridge } from './native'
import { fixtureContext } from './fixtures/context'

describe('Rust tool callbacks', () => {
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
})
