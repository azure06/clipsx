import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'

export type ExtensionJob = {
  jobId: string
  clipId: string
  sourceId: string
  packageId: string
  transformerId: string
  transformerVersion: string
  displayLabel: string
  defaultView: 'result_only' | 'compare'
  status: 'pending' | 'running' | 'waiting_provider' | 'waiting_write_review' | 'completed' | 'failed' | 'cancelled'
  reasonCode: string | null
  parameters: Record<string, unknown>
  resultControls: Array<'copy' | 'paste' | 'save_as_clip' | 'regenerate'>
  view: { tabs: Array<{ id: string; label: string; layout: 'single' | 'split' | 'stack'; panels: Array<{ source: 'input' } | { source: 'output'; outputId: string }> }> } | null
  completedWrites: number
  outputs: Array<{ ordinal: number; outputId: string; mimeType: string; byteLength: number; hasRenderedView: boolean }>
}

export function useClipExtensionJobs(clipId: string) {
  const [jobs, setJobs] = useState<ExtensionJob[]>([])
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const next = await invoke<ExtensionJob[]>('list_clip_extension_results', { clipId })
      if (current === sequence.current) {
        setJobs(next)
        setError(null)
      }
    } catch (reason) {
      if (current === sequence.current) setError(String(reason))
    }
  }, [clipId])

  useEffect(() => {
    void refresh()
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<{ clipId: string }>('extension-job-updated', event => {
      if (event.payload.clipId === clipId) void refresh()
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      sequence.current += 1
      unlisten?.()
    }
  }, [clipId, refresh])
  return { jobs, error, refresh }
}
