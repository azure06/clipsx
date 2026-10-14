import { describe, expect, it, vi } from 'vitest'
import { CitationRegistry, readCitations } from './citations'
import { createClipboardTools } from './tools'
import { fixtureContext } from './fixtures/context'
import { fitContext } from './context'
import type { NativeAgentBridge } from './native'
import type { ClipReadResult } from '../contracts.generated'
import type { ThreadMessage } from '@assistant-ui/react'

const evidence: ClipReadResult = {
  apiVersion: 1,
  clip: {
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
  },
  representationId: 'representation',
  kind: 'captured',
  text: 'Verified source text',
  textFingerprint: 'hash',
  totalBytes: 20,
  nextCursor: null,
  warnings: [],
}
describe('Clipboard citation admission', () => {
  it('does not cite search candidates; read pages share a number until the revision changes', async () => {
    const context = fixtureContext()
    context.tools.push({
      name: 'read_clip',
      description: 'Read',
      inputSchemaJson: '{"type":"object"}',
    })
    const tool = vi
      .fn<NativeAgentBridge['tool']>()
      .mockResolvedValueOnce({ items: [{ clip: evidence.clip, snippet: 'Candidate only' }] })
      .mockResolvedValueOnce(evidence)
      .mockResolvedValueOnce({ ...evidence, kind: 'ocr', text: 'OCR page' })
      .mockResolvedValueOnce({ ...evidence, clip: { ...evidence.clip, revision: 'r2' } })
      .mockResolvedValueOnce({ ...evidence, text: '', warnings: [{ code: 'ocr_pending' }] })
    const citations = new CitationRegistry()
    const tools = createClipboardTools(context, { tool } as unknown as NativeAgentBridge, {
      searches: 0,
      images: [],
      imageBytes: 0,
      citations,
    })
    const execute = async (name: string, id: string): Promise<unknown> => {
      const result: unknown = await tools[name]!.execute!(
        {},
        { toolCallId: id, messages: [], context: undefined }
      )
      return result
    }
    await execute('search_clips', 'search')
    expect(citations.snapshot()).toEqual([])
    expect(await execute('read_clip', 'page1')).toMatchObject({
      citation: { number: 1, clipId: 'clip', revision: 'r1' },
    })
    expect(await execute('read_clip', 'page2')).toMatchObject({ citation: { number: 1 } })
    expect(await execute('read_clip', 'changed')).toMatchObject({
      citation: { number: 2, revision: 'r2' },
    })
    expect(await execute('read_clip', 'pending')).not.toHaveProperty('citation')
    expect(citations.snapshot()).toHaveLength(2)
  })
  it.each([false, true])(
    'does not cite image bytes that cannot reach the model (budget=%s)',
    async limited => {
      const context = fixtureContext()
      context.preset.capabilities.vision = limited
      context.tools = [
        { name: 'read_clip_image', description: 'Image', inputSchemaJson: '{"type":"object"}' },
      ]
      const citations = new CitationRegistry()
      const tools = createClipboardTools(
        context,
        {
          tool: vi.fn().mockResolvedValue({ clipId: 'clip', revision: 'r1', data: 'image' }),
        } as unknown as NativeAgentBridge,
        { searches: 0, images: [], imageBytes: limited ? 6 * 1024 * 1024 : 0, citations }
      )
      const result: unknown = await tools['read_clip_image']!.execute!(
        {},
        { toolCallId: 'image', messages: [], context: undefined }
      )
      expect(result).not.toHaveProperty('data')
      expect(result).not.toHaveProperty('citation')
      expect(citations.snapshot()).toEqual([])
    }
  )
  it('numbers only attached evidence that fits the model context', () => {
    const context = fixtureContext()
    context.preset.contextLimit = context.preset.outputLimit + 1024 + 1024
    context.attachments = [
      { ...evidence, text: 'x'.repeat(2000), clip: { ...evidence.clip, id: 'omitted' } },
      evidence,
    ]
    const question: ThreadMessage = {
      id: 'question',
      role: 'user',
      content: [{ type: 'text', text: 'Summarize this' }],
      attachments: [],
      createdAt: new Date(),
      metadata: { custom: {} },
    }
    const citations = new CitationRegistry()
    const fitted = fitContext([question], context, citations)
    expect(fitted.omitted).toBe(true)
    expect(citations.snapshot()).toEqual([{ number: 1, clipId: 'clip', revision: 'r1' }])
    expect(JSON.stringify(fitted.messages)).toContain('citation')
    expect(JSON.stringify(fitted.messages)).not.toContain('omitted')
  })
  it('rejects malformed and ambiguous saved reference numbers', () => {
    expect(
      readCitations([
        { number: 1, clipId: 'clip', revision: 'r1' },
        { number: 1, clipId: 'other', revision: 'r2' },
        { number: -1, clipId: 'bad', revision: 'r1' },
        null,
      ])
    ).toEqual([{ number: 1, clipId: 'clip', revision: 'r1' }])
  })
})
