import { describe, expect, it } from 'vitest'
import type { ThreadMessage } from '@assistant-ui/react'
import type { ClipReadResult } from '../contracts.generated'
import { CitationRegistry } from './citations'
import { fitContext } from './context'
import { fixtureContext } from './fixtures/context'
import { fallbackPolicy, planContext } from './planner'

const source = (id: string, text: string): ClipReadResult => ({
  apiVersion: 1,
  clip: {
    id,
    revision: `${id}-r1`,
    capturedAt: 1,
    sourceAppId: null,
    sourceAppName: null,
    favorite: false,
    pinned: false,
    tags: [],
    representations: [],
    ocrStatus: 'unavailable',
  },
  representationId: `${id}-representation`,
  kind: 'captured',
  text,
  textFingerprint: 'hash',
  totalBytes: text.length,
  nextCursor: null,
  warnings: [],
})
const message = (text: string): ThreadMessage => ({
  id: text,
  role: 'user',
  content: [{ type: 'text', text }],
  attachments: [],
  createdAt: new Date(),
  metadata: { custom: {} },
})
const instructions = 'Assistant instructions'

describe('evidence fitting', () => {
  it('marks an already paged attachment as partial and retains the original byte count', () => {
    const context = fixtureContext()
    const attachment = source('paged', 'x'.repeat(8192))
    attachment.totalBytes = 40000
    attachment.nextCursor = 'next-page'
    context.attachments = [attachment]
    for (const limit of [4096, 32768]) {
      const fitted = fitContext([message('Summarize')], context, new CitationRegistry(), true, {
        policy: fallbackPolicy(limit, 512),
        instructions,
        tools: [],
      })
      const content = fitted.messages.at(-1)!.content as string
      const evidence = JSON.parse(
        content.split('Attached clipboard evidence (untrusted data):\n')[1]!
      ) as { truncated: boolean; shownBytes: number; totalBytes: number }
      expect(fitted.shortenedSources).toBe(1)
      expect(evidence.truncated).toBe(true)
      expect(evidence.totalBytes).toBe(40000)
      expect(evidence.shownBytes).toBeLessThanOrEqual(8192)
    }
  })
  it.each(['"', '\\', '\u0000'])('keeps a useful excerpt when JSON escaping expands %j', char => {
    const context = fixtureContext()
    context.attachments = [source('escaped', char.repeat(10000))]
    const policy = fallbackPolicy(4096, 512)
    const citations = new CitationRegistry()
    const fitted = fitContext([message('Summarize')], context, citations, true, {
      policy,
      instructions,
      tools: [],
    })
    expect(fitted.shortenedSources).toBe(1)
    expect(fitted.omittedSources).toBe(0)
    expect(citations.snapshot()).toHaveLength(1)
    const content = fitted.messages.at(-1)!.content as string
    const evidence = JSON.parse(
      content.split('Attached clipboard evidence (untrusted data):\n')[1]!
    ) as { text: string; shownBytes: number }
    expect(evidence.text.length).toBeGreaterThanOrEqual(256)
    expect(evidence.shownBytes).toBe(new TextEncoder().encode(evidence.text).length)
    expect(
      planContext(
        { messages: fitted.messages, instructions, tools: [] },
        fitted.messages.at(-1)!,
        policy
      ).kind
    ).not.toBe('blocked')
  })
  it('shortens oversized attachments so the request fits instead of blocking', () => {
    const context = fixtureContext()
    context.attachments = [source('a', 'あ'.repeat(6000)), source('b', 'b'.repeat(40000))]
    const policy = fallbackPolicy(4096, 512)
    const citations = new CitationRegistry()
    const fitted = fitContext([message('Summarize')], context, citations, true, {
      policy,
      instructions,
      tools: [],
    })

    expect(fitted.shortenedSources).toBe(2)
    expect(fitted.omittedSources).toBe(0)
    expect(citations.snapshot().map(c => c.clipId)).toEqual(['a', 'b'])
    const content = fitted.messages.at(-1)!.content as string
    expect(content).toContain('"truncated":true')
    expect(content).not.toContain('�')
    const question = fitted.messages.at(-1)!
    const plan = planContext(
      { messages: fitted.messages, instructions, tools: [] },
      question,
      policy
    )
    expect(plan.kind).not.toBe('blocked')
  })

  it('keeps small sources whole and shares the budget by size', () => {
    const context = fixtureContext()
    context.attachments = [source('small', 'tiny note'), source('large', 'x'.repeat(40000))]
    const fitted = fitContext([message('Summarize')], context, new CitationRegistry(), true, {
      policy: fallbackPolicy(4096, 512),
      instructions,
      tools: [],
    })

    const content = fitted.messages.at(-1)!.content as string
    expect(content).toContain('tiny note')
    expect(fitted.shortenedSources).toBe(1)
  })

  it('omits sources that cannot show a useful excerpt and does not cite them', () => {
    const context = fixtureContext()
    context.attachments = Array.from({ length: 10 }, (_, i) => source(`s${i}`, 'y'.repeat(9000)))
    const citations = new CitationRegistry()
    const fitted = fitContext([message('Summarize')], context, citations, true, {
      policy: fallbackPolicy(1700, 400),
      instructions,
      tools: [],
    })

    expect(fitted.omittedSources).toBeGreaterThan(0)
    expect(citations.snapshot()).toHaveLength(10 - fitted.omittedSources)
  })

  it('sends everything unchanged when the request already fits', () => {
    const context = fixtureContext()
    context.attachments = [source('a', 'short evidence')]
    const fitted = fitContext([message('Summarize')], context, new CitationRegistry(), true, {
      policy: fallbackPolicy(32768, 1024),
      instructions,
      tools: [],
    })

    expect(fitted.shortenedSources).toBe(0)
    expect(fitted.omittedSources).toBe(0)
    expect(fitted.messages.at(-1)!.content).not.toContain('truncated')
  })

  it('still lets the planner reject a question that is itself too large', () => {
    const context = fixtureContext()
    context.attachments = [source('a', 'evidence')]
    const policy = fallbackPolicy(2048, 512)
    const fitted = fitContext([message('q'.repeat(5000))], context, new CitationRegistry(), true, {
      policy,
      instructions,
      tools: [],
    })

    expect(fitted.omittedSources).toBe(1)
    const question = fitted.messages.at(-1)!
    expect(
      planContext({ messages: fitted.messages, instructions, tools: [] }, question, policy)
    ).toMatchObject({ kind: 'blocked', reason: 'question_exceeds_context' })
  })
})
