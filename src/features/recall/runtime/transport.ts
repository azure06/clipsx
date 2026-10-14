import { Channel, invoke } from '@tauri-apps/api/core'

type BridgeEvent =
  | { type: 'headers'; status: number; headers: Record<string, string> }
  | { type: 'chunk'; sequence: number; bytes: number[] }
  | { type: 'terminal'; code: string | null }

export interface BridgeRequest {
  runId: string
  requestId: string
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

export interface BridgeCommands {
  start: (request: BridgeRequest, receive: (event: BridgeEvent) => void) => Promise<void>
  acknowledge: (requestId: string, sequence: number) => Promise<void>
  cancel: (requestId: string) => Promise<void>
}

const tauriCommands: BridgeCommands = {
  start(request, receive) {
    const channel = new Channel<BridgeEvent>()
    channel.onmessage = receive
    return invoke('ai_http_start', { request, channel })
  },
  acknowledge: (requestId, sequence) => invoke('ai_http_acknowledge', { requestId, sequence }),
  cancel: requestId => invoke('ai_http_cancel', { requestId }),
}

/** One queued chunk at most: Rust waits for consumption before sending another. */
export function createRustFetch(
  runId: string,
  commands: BridgeCommands = tauriCommands
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    const requestId = crypto.randomUUID()
    const body = request.method === 'GET' ? '' : await request.text()
    request.signal.throwIfAborted()
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    return new Promise<Response>((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      let pending: { sequence: number; bytes: Uint8Array } | undefined
      let demand = false
      let settled = false
      let terminated = false
      let startComplete = false
      let cancellationRequested = false

      const cleanup = () => request.signal.removeEventListener('abort', abort)
      const fail = (error: Error) => {
        if (terminated) return
        terminated = true
        cleanup()
        if (!settled) reject(error)
        else controller?.error(error)
      }
      const cancelHost = () => {
        cancellationRequested = true
        if (startComplete) void commands.cancel(requestId).catch(() => undefined)
      }
      const abort = () => {
        cancelHost()
        fail(new DOMException('Recall request stopped', 'AbortError'))
      }
      const flush = () => {
        if (!pending || !demand || terminated) return
        const chunk = pending
        pending = undefined
        demand = false
        controller?.enqueue(chunk.bytes)
        void commands.acknowledge(requestId, chunk.sequence).catch(() => {
          cancelHost()
          fail(new Error('Recall transport acknowledgement failed'))
        })
      }
      request.signal.addEventListener('abort', abort, { once: true })
      if (request.signal.aborted) {
        abort()
        return
      }

      void commands
        .start(
          { runId, requestId, url: request.url, method: request.method, headers, body },
          event => {
            if (terminated) return
            switch (event.type) {
              case 'headers': {
                if (settled) {
                  cancelHost()
                  fail(new Error('Invalid Recall transport sequence'))
                  return
                }
                const stream = new ReadableStream<Uint8Array>(
                  {
                    start(value) {
                      controller = value
                    },
                    pull() {
                      demand = true
                      flush()
                    },
                    cancel() {
                      cancelHost()
                      terminated = true
                      cleanup()
                    },
                  },
                  { highWaterMark: 0 }
                )
                settled = true
                resolve(new Response(stream, { status: event.status, headers: event.headers }))
                break
              }
              case 'chunk':
                if (!settled || pending || event.bytes.length > 64 * 1024) {
                  cancelHost()
                  fail(new Error('Invalid Recall transport sequence'))
                  return
                }
                pending = { sequence: event.sequence, bytes: Uint8Array.from(event.bytes) }
                flush()
                break
              case 'terminal':
                if (event.code) fail(new Error(`Recall transport: ${event.code}`))
                else if (!settled || pending)
                  fail(new Error('Incomplete Recall transport response'))
                else {
                  terminated = true
                  cleanup()
                  controller?.close()
                }
            }
          }
        )
        .then(() => {
          startComplete = true
          if (cancellationRequested) void commands.cancel(requestId).catch(() => undefined)
        })
        .catch(() => fail(new Error('Recall transport could not start')))
    })
  }
}
