import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { withContextRecovery } from './recovery'
import { StatusNotifications } from './status-stream'

const params: LanguageModelV4CallOptions = {
  prompt: [
    { role: 'system', content: 'Keep instructions' },
    { role: 'user', content: [{ type: 'text', text: 'old'.repeat(1000) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'Find invoice' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call', toolName: 'create_clip', input: '{}' }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call',
          toolName: 'create_clip',
          output: { type: 'text', value: 'committed action A' },
        },
      ],
    },
  ],
}
const success = () => ({ stream: new ReadableStream({ start: controller => controller.close() }) })

describe('model request overflow recovery', () => {
  it('retries only the rejected request, preserving instructions and current tool outcomes', async () => {
    const doStream = vi
      .fn()
      .mockRejectedValueOnce(new Error('Recall transport: context_overflow'))
      .mockResolvedValue(success())
    const summarize = vi.fn().mockResolvedValue({ role: 'user', content: 'Earlier goal' })
    const onRecovered = vi.fn()
    const model = withContextRecovery(new MockLanguageModelV4({ doStream }), {
      questionText: 'Find invoice',
      summarize,
      onRecovered,
    })
    await model.doStream(params)
    expect(doStream).toHaveBeenCalledTimes(2)
    const retried = doStream.mock.calls[1]?.[0] as LanguageModelV4CallOptions
    expect(retried.prompt[0]).toEqual(params.prompt[0])
    expect(retried.prompt.slice(-3)).toEqual(params.prompt.slice(-3))
    expect(summarize).toHaveBeenCalledOnce()
    expect(onRecovered).toHaveBeenCalledOnce()
  })
  it('does not loop after a second rejection', async () => {
    const doStream = vi.fn().mockRejectedValue(new Error('Recall transport: context_overflow'))
    const model = withContextRecovery(new MockLanguageModelV4({ doStream }), {
      questionText: 'Find invoice',
      summarize: () => Promise.resolve({ role: 'user', content: 'Summary' }),
      onRecovered: vi.fn(),
    })
    await expect(model.doStream(params)).rejects.toThrow('context_overflow')
    expect(doStream).toHaveBeenCalledTimes(2)
  })
  it('never retries an uncertain stream failure after admission', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start: c => c.error(new Error('Recall transport: context_overflow')),
      }),
    })
    const summarize = vi.fn()
    const model = withContextRecovery(new MockLanguageModelV4({ doStream }), {
      questionText: 'Find invoice',
      summarize,
      onRecovered: vi.fn(),
    })
    const result = await model.doStream(params)
    await expect(result.stream.getReader().read()).rejects.toThrow('context_overflow')
    expect(doStream).toHaveBeenCalledOnce()
    expect(summarize).not.toHaveBeenCalled()
  })
})
describe('context status delivery', () => {
  it('wakes the UI while the model iterator is still waiting', async () => {
    let release: (() => void) | undefined
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    async function* source() {
      await waiting
      yield { type: 'text', text: 'answer' }
    }
    const statuses = new StatusNotifications()
    const iterator = statuses.merge(source())
    const first = iterator.next()
    statuses.notify()
    expect((await first).value).toEqual({ type: 'context-status' })
    release?.()
    expect((await iterator.next()).value).toEqual({ type: 'text', text: 'answer' })
    expect((await iterator.next()).done).toBe(true)
  })
})
