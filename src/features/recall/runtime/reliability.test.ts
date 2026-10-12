import { describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import { estimateRequest } from './estimator'
import { fallbackPolicy, planContext } from './planner'
import { compactConversation } from './compactor'
import { ContextCoordinator } from './coordinator'

const policy = fallbackPolicy(12000, 2000)
const signal = () => new AbortController().signal
const question: ModelMessage = { role: 'user', content: 'Find the invoice' }
const older: ModelMessage[] = [
  { role: 'user', content: 'a'.repeat(4500) },
  { role: 'assistant', content: 'b'.repeat(4500) },
]
const request = (messages: ModelMessage[]) => ({ messages, instructions: 'rules', tools: [] })

describe('request estimation', () => {
  it('accounts for instructions, tools, Japanese text, and bounded image estimates', () => {
    const base = estimateRequest(request([question])).tokens
    expect(
      estimateRequest({ ...request([question]), instructions: 'rules'.repeat(200) }).tokens
    ).toBeGreaterThan(base)
    expect(
      estimateRequest({ ...request([question]), tools: [{ schema: 'x'.repeat(400) }] }).tokens
    ).toBeGreaterThan(base)
    expect(
      estimateRequest(request([{ role: 'user', content: '日本語'.repeat(100) }])).tokens
    ).toBeGreaterThan(900)
    const image = (data: string): ModelMessage => ({
      role: 'user',
      content: [{ type: 'file', data, mediaType: 'image/png' }],
    })
    expect(estimateRequest(request([image('small')]))).toEqual(
      estimateRequest(request([image('x'.repeat(100000))]))
    )
  })
})
describe('pure context planning', () => {
  it('preserves short requests and never mutates the source', () => {
    const messages = [question]
    expect(planContext(request(messages), question, policy).kind).toBe('ready')
    expect(messages).toEqual([question])
  })
  it('reserves upcoming work and compacts completed history', () => {
    const plan = planContext(request([...older, question]), question, policy)
    expect(plan.kind).toBe('compact')
    if (plan.kind === 'compact') {
      expect(plan.older).toEqual(older)
      expect(plan.retained).toEqual([question])
    }
  })
  it('recognizes a cloned question and preserves in-flight tool pairs', () => {
    const calls: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'c', toolName: 'read_clip', input: { clipId: 'a' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c',
            toolName: 'read_clip',
            output: { type: 'text', value: 'evidence' },
          },
        ],
      },
    ]
    const plan = planContext(
      request([...older, structuredClone(question), ...calls]),
      question,
      policy
    )
    expect(plan.kind).toBe('compact')
    if (plan.kind === 'compact') expect(plan.retained.slice(-2)).toEqual(calls)
  })
  it('blocks oversized questions, required images, and current-turn evidence', () => {
    const big: ModelMessage = { role: 'user', content: 'x'.repeat(20000) }
    expect(planContext(request([big]), big, policy)).toMatchObject({
      kind: 'blocked',
      reason: 'question_exceeds_context',
    })
    const image: ModelMessage = {
      role: 'user',
      content: [{ type: 'file', data: 'image', mediaType: 'image/png' }],
    }
    expect(planContext(request([image]), image, fallbackPolicy(4096, 1024)).kind).toBe('blocked')
    expect(
      planContext(
        request([question, { role: 'assistant', content: 'x'.repeat(12000) }]),
        question,
        policy
      ).kind
    ).toBe('blocked')
  })
})
describe('bounded compaction', () => {
  it('passes tools-free bounded input to its injected generator', async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ text: 'Goal: find invoice. Pending: inspect source.', complete: true })
    const result = await compactConversation(older, policy, generate, signal())
    expect(result.content).toContain('Goal: find invoice')
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ maxOutputTokens: 2000 })
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty('tools')
  })
  it.each([
    { text: '', complete: true },
    { text: 'partial', complete: false },
    { text: 'x'.repeat(32769), complete: true },
  ])('rejects invalid summaries', async result => {
    await expect(
      compactConversation(older, policy, () => Promise.resolve(result), signal())
    ).rejects.toThrow('invalid_context_summary')
  })
  it('cancels before generation and rejects an oversized summary request', async () => {
    const abort = new AbortController()
    abort.abort()
    const generate = vi.fn()
    await expect(compactConversation(older, policy, generate, abort.signal)).rejects.toThrow()
    expect(generate).not.toHaveBeenCalled()
    await expect(
      compactConversation(
        [{ role: 'user', content: 'x'.repeat(20000) }],
        policy,
        generate,
        signal()
      )
    ).rejects.toThrow('summary_input_limit')
  })
})
describe('context coordinator', () => {
  const options = () => ({
    policy,
    generate: vi.fn().mockResolvedValue({ text: 'Preserved goal', complete: true }),
    signal: signal(),
    historyIds: ['old-user', 'old-answer', 'question'],
    attribution: { provider: 'ollama', model: 'm' },
  })
  it('reuses branch-validated summaries without generating again', async () => {
    const config = options()
    const load = vi
      .fn()
      .mockResolvedValue({
        inputFingerprint: 'f',
        summary: { text: 'Existing goal', coveredMessageId: 'old-answer' },
      })
    const save = vi.fn()
    const coordinator = new ContextCoordinator({ ...config, persistence: { load, save } })
    const result = await coordinator.prepare(request([...older, question]), question)
    expect(result[0]?.content).toContain('Existing goal')
    expect(config.generate).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledWith('old-answer')
  })
  it('continues a growing transcript using a valid ancestor summary', async () => {
    const config = options()
    const history: ModelMessage[] = [
      ...older,
      { role: 'user', content: 'Later task' },
      { role: 'assistant', content: 'Later answer'.repeat(100) },
      question,
    ]
    const coordinator = new ContextCoordinator({
      ...config,
      historyIds: ['old-user', 'old-answer', 'later-user', 'later-answer', 'question'],
      historyMessages: history,
      persistence: {
        load: () =>
          Promise.resolve({
            inputFingerprint: 'new-fingerprint',
            summary: {
              threadId: 't',
              coveredMessageId: 'old-answer',
              inputFingerprint: 'old-fingerprint',
              text: 'Existing goal',
              provider: 'ollama',
              model: 'm',
              createdAt: 1,
            },
          }),
        save: vi.fn(),
      },
    })
    const result = await coordinator.prepare(request(history), question)
    expect(result[0]?.content).toContain('Existing goal')
    expect(result.some(m => m.content === 'Later task')).toBe(true)
    expect(config.generate).not.toHaveBeenCalled()
  })
  it('saves derived context and preserves the authoritative action ledger', async () => {
    const save = vi.fn()
    const onStatus = vi.fn()
    const coordinator = new ContextCoordinator({
      ...options(),
      onStatus,
      persistence: { load: () => Promise.resolve({ inputFingerprint: 'f', summary: null }), save },
    })
    const ledger: ModelMessage = {
      role: 'user',
      content: 'Recorded operation: action A reversed by B',
    }
    const result = await coordinator.prepare(request([...older, question, ledger]), question)
    expect(result.at(-1)).toEqual(ledger)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ coveredMessageId: 'old-answer', inputFingerprint: 'f' })
    )
    expect(onStatus.mock.calls.map(call => (call[0] as { state: string }).state)).toEqual([
      'compacting',
      'compacted',
    ])
  })
  it('bounds summary calls across normal preparation and overflow recovery', async () => {
    const config = options()
    const coordinator = new ContextCoordinator(config)
    await coordinator.summarize(older)
    await coordinator.summarize(older)
    await expect(coordinator.summarize(older)).rejects.toThrow('context_compaction_failed')
    expect(config.generate).toHaveBeenCalledTimes(2)
  })
  it('stops when failed compaction leaves the request oversized', async () => {
    const coordinator = new ContextCoordinator({
      ...options(),
      generate: () => Promise.reject(new Error('offline')),
    })
    const largeOlder: ModelMessage[] = [...older, { role: 'user', content: 'y'.repeat(2000) }]
    await expect(coordinator.prepare(request([...largeOlder, question]), question)).rejects.toThrow(
      'context_compaction_failed'
    )
  })
})
