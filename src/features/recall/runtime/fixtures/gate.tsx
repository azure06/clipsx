import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } from '@assistant-ui/react'
import type { ChatConnection, ChatProvider } from '../providers'
import { createRustFetch } from '../transport'
import { createFixtureAdapter } from './adapter'

const providers: ChatProvider[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama']
interface ProbeRun {
  connection: ChatConnection
  runId: string
}

function ProviderGate({ run, done }: { run: ProbeRun; done: (passed: boolean) => void }) {
  const adapter = useMemo(
    () =>
      createFixtureAdapter(run.connection, createRustFetch(run.runId), () =>
        invoke('runtime_gate_tool', { runId: run.runId })
      ),
    [run]
  )
  const runtime = useLocalRuntime(adapter)
  const started = useRef(false)
  useEffect(() => {
    const unsubscribe = runtime.thread.subscribe(() => {
      const state = runtime.thread.getState()
      const last = state.messages.at(-1)
      if (last?.role !== 'assistant' || state.isRunning || last.status.type === 'running') return
      const text = last.content.map(part => (part.type === 'text' ? part.text : '')).join('')
      if (started.current) {
        started.current = false
        done(last.status.type === 'complete' && text === 'Recall verified')
      }
    })
    if (!started.current) {
      started.current = true
      runtime.thread.append('Run the fixture.')
    }
    return unsubscribe
  }, [runtime, done])
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root aria-label="Runtime fixture" />
    </AssistantRuntimeProvider>
  )
}

export function Gate() {
  const [run, setRun] = useState<ProbeRun | null>(null)
  const [index, setIndex] = useState(0)
  const results = useRef<Record<string, boolean>>({})
  useEffect(() => {
    let active = true
    const provider = providers[index]
    if (!provider) {
      void (async () => {
        // Stop after headers, while the native server deliberately stalls its body.
        const cancellationRun = await invoke<ProbeRun>('runtime_gate_begin', { provider: 'openai' })
        const controller = new AbortController()
        const response = await createRustFetch(cancellationRun.runId)(
          `${cancellationRun.connection.baseUrl}/responses`,
          {
            method: 'POST',
            body: '{"cancel":true}',
            headers: { 'content-type': 'application/json' },
            signal: controller.signal,
          }
        )
        const reading = response.body!.getReader().read()
        controller.abort()
        try {
          await reading
          results.current['cancellation'] = false
        } catch (error) {
          results.current['cancellation'] =
            error instanceof DOMException && error.name === 'AbortError'
        }
        await invoke('runtime_gate_finish', {
          results: results.current,
          userAgent: navigator.userAgent,
        })
      })().catch(() =>
        invoke('runtime_gate_finish', {
          results: { ...results.current, cancellation: false },
          userAgent: navigator.userAgent,
        })
      )
      return
    }
    void invoke<ProbeRun>('runtime_gate_begin', { provider })
      .then(value => {
        if (active) setRun(value)
      })
      .catch(() => {
        results.current[provider] = false
        setIndex(value => value + 1)
      })
    return () => {
      active = false
    }
  }, [index])
  const done = useMemo(
    () => (passed: boolean) => {
      results.current[providers[index]!] = passed
      setRun(null)
      setIndex(value => value + 1)
    },
    [index]
  )
  return run ? <ProviderGate key={run.runId} run={run} done={done} /> : null
}

createRoot(document.getElementById('root')!).render(<Gate />)
