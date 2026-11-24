import { invoke, Resource } from '@tauri-apps/api/core'

// Shared typing cadence. Retrieval and eligibility remain owned by the Rust search service.
export const KEYWORD_DELAY_MS = 75
export const SEMANTIC_DELAY_MS = 250

export async function searchWhileCurrent<T>(
  command: 'search_clips' | 'assistant_search_clips',
  request: object,
  signal: AbortSignal
): Promise<T> {
  signal.throwIfAborted()
  const resource = new Resource(await invoke<number>('prepare_interactive_search'))
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= resource.close().catch(() => undefined)
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    signal.throwIfAborted()
    return await invoke<T>(command, { request, cancellationId: resource.rid })
  } finally {
    signal.removeEventListener('abort', close)
    close()
  }
}
