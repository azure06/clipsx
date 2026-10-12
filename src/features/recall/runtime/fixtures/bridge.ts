import { vi } from 'vitest'
import type { BridgeCommands, BridgeRequest } from '../transport'
import type { ChatProvider } from '../providers'
import streams from './streams.json'

export function fixtureBridge(
  provider: ChatProvider,
  transform?: (records: readonly unknown[], phase: 'tool' | 'text') => readonly unknown[]
) {
  const requests: BridgeRequest[] = []
  const waits = new Map<string, () => void>()
  let cancelled = false
  const commands: BridgeCommands = {
    start: vi.fn<BridgeCommands['start']>((request, receive) => {
      requests.push(request)
      const phase = requests.length === 1 ? 'tool' : 'text'
      const fixture = streams[provider][phase]
      const records = transform?.(fixture, phase) ?? fixture
      receive({ type: 'headers', status: 200, headers: { 'content-type': 'text/event-stream' } })
      void (async () => {
        let sequence = 0
        for (const record of records) {
          const bytes = new TextEncoder().encode(`data: ${JSON.stringify(record)}\n\n`)
          // Split inside JSON and UTF-8 to exercise streaming parser boundaries.
          for (let offset = 0; offset < bytes.length; offset += 13) {
            if (cancelled) return
            await new Promise<void>(resolve => {
              waits.set(request.requestId, resolve)
              receive({
                type: 'chunk',
                sequence: ++sequence,
                bytes: [...bytes.slice(offset, offset + 13)],
              })
            })
          }
        }
        receive({ type: 'terminal', code: null })
      })()
      return Promise.resolve()
    }),
    acknowledge: vi.fn<BridgeCommands['acknowledge']>(requestId => {
      waits.get(requestId)?.()
      return Promise.resolve()
    }),
    cancel: vi.fn<BridgeCommands['cancel']>(requestId => {
      cancelled = true
      waits.get(requestId)?.()
      return Promise.resolve()
    }),
  }
  return { commands, requests }
}
