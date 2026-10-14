import type { AssistantRunContext, ClipReadResult, ClipSearchResult } from '../contracts.generated'
import type { NativeAgentBridge } from './native'
import { utf8Size } from './estimator'

export interface InitialRetrieval {
  state: 'ready' | 'empty' | 'unavailable' | 'budget'
  sources: ClipReadResult[]
  searches: number
  incomplete: boolean
}

/** Host-initiated evidence preparation, never a fabricated model tool call. */
export async function retrieveInitialEvidence(
  context: AssistantRunContext,
  query: string,
  budget: number,
  bridge: Pick<NativeAgentBridge, 'tool'>,
  signal: AbortSignal
): Promise<InitialRetrieval> {
  const result: InitialRetrieval = { state: 'empty', sources: [], searches: 0, incomplete: false }
  if (budget < 1024) return { ...result, state: 'budget' }
  let remaining = budget
  try {
    signal.throwIfAborted()
    const search = async (mode: 'keyword' | 'hybrid') => {
      result.searches++
      const found = (await bridge.tool(context.runId, 'search_clips', {
        query,
        mode,
        filters: context.filters,
        limit: 3,
      })) as ClipSearchResult
      signal.throwIfAborted()
      result.incomplete ||= !found.exhaustive || found.warnings.length > 0
      return found
    }
    let found = await search('keyword')
    if (!found.items.length && context.status.semanticReady) found = await search('hybrid')
    const attached = new Set(context.attachments.map(source => source.clip.id))
    for (const candidate of found.items.slice(0, 3)) {
      signal.throwIfAborted()
      if (attached.has(candidate.clip.id)) continue
      if (remaining < 1024) {
        result.incomplete = true
        break
      }
      try {
        const read = async (kind: 'captured' | 'ocr') =>
          (await bridge.tool(context.runId, 'read_clip', {
            clipId: candidate.clip.id,
            kind,
            pageBytes: Math.min(2048, remaining - 768),
          })) as ClipReadResult
        let source = await read('captured')
        signal.throwIfAborted()
        if (!source.text && candidate.clip.ocrStatus === 'completed') source = await read('ocr')
        signal.throwIfAborted()
        // Include serialization/citation overhead; never shorten text or invent cursors.
        const size = utf8Size(JSON.stringify(source)) + 256
        if (!source.text || size > remaining) {
          result.incomplete = true
          continue
        }
        remaining -= size
        result.sources.push(source)
        attached.add(source.clip.id)
        result.incomplete ||= Boolean(source.nextCursor) || source.warnings.length > 0
      } catch {
        signal.throwIfAborted()
        result.incomplete = true
      }
    }
    result.state = result.sources.length ? 'ready' : 'empty'
  } catch {
    signal.throwIfAborted()
    result.state = 'unavailable'
    result.incomplete = true
  }
  return result
}
