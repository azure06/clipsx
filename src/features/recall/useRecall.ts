import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecallEvent, RecallEvidence } from '../../shared/types/v2'

export type RecallScope = {
  scope: 'all' | 'favorites' | 'pinned'
  tagId: string | null
  representationFamilies: string[]
  facetIds: string[]
  enabledSourceIds: string[]
  label: string
}

export type RecallTurn = {
  requestId: string
  question: string
  answer: string
  sources: RecallEvidence[]
  stage: string
  status: 'running' | 'complete' | 'incomplete' | 'no_evidence' | 'error'
  error: string | null
  providerId: string | null
  model: string | null
  executionLocation: 'local' | 'remote' | null
  completionReason: string | null
  excludedCount: number
  degradedRetrieval: boolean
  contextReduced: boolean
  invalidated: boolean
}

const newId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const emptyTurn = (requestId: string, question: string): RecallTurn => ({
  requestId,
  question,
  answer: '',
  sources: [],
  stage: 'finding_evidence',
  status: 'running',
  error: null,
  providerId: null,
  model: null,
  executionLocation: null,
  completionReason: null,
  excludedCount: 0,
  degradedRetrieval: false,
  contextReduced: false,
  invalidated: false,
})

export function useRecall() {
  const [turns, setTurns] = useState<RecallTurn[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [scope, setScope] = useState<RecallScope | null>(null)
  const [expired, setExpired] = useState(false)
  const sessionIdRef = useRef(newId())
  const scopeRef = useRef<RecallScope | null>(null)
  const expiryRef = useRef<number | undefined>(undefined)

  const touchExpiry = useCallback(() => {
    window.clearTimeout(expiryRef.current)
    expiryRef.current = window.setTimeout(
      () => {
        const sessionId = sessionIdRef.current
        void invoke('clear_recall_session', { sessionId }).catch(() => undefined)
        setTurns([])
        setActiveRequestId(null)
        setExpired(true)
      },
      30 * 60 * 1000
    )
  }, [])

  useEffect(() => {
    const unlisten = listen<string>('clip-deleted', event => {
      setTurns(current =>
        current.map(turn =>
          turn.sources.some(source => source.clipId === event.payload)
            ? { ...turn, invalidated: true }
            : turn
        )
      )
    })
    return () => {
      window.clearTimeout(expiryRef.current)
      void unlisten.then(dispose => dispose())
    }
  }, [])

  const updateTurn = useCallback((requestId: string, update: (turn: RecallTurn) => RecallTurn) => {
    setTurns(current => current.map(turn => (turn.requestId === requestId ? update(turn) : turn)))
  }, [])

  const start = useCallback(
    async (
      question: string,
      nextScope: RecallScope,
      options: { newThread?: boolean; sourceClipIds?: string[] } = {}
    ) => {
      const trimmed = question.trim()
      if (!trimmed || activeRequestId) return
      let sessionId = sessionIdRef.current
      if (options.newThread) {
        void invoke('clear_recall_session', { sessionId }).catch(() => undefined)
        sessionId = newId()
        sessionIdRef.current = sessionId
        scopeRef.current = nextScope
        setScope(nextScope)
        setTurns([])
      } else if (!scopeRef.current) {
        scopeRef.current = nextScope
        setScope(nextScope)
      }
      setExpired(false)
      touchExpiry()
      const requestId = newId()
      setActiveRequestId(requestId)
      setTurns(current => [...current, emptyTurn(requestId, trimmed)].slice(-10))
      const onEvent = new Channel<RecallEvent>()
      let terminal = false
      const retrievalWatchdog = window.setTimeout(() => {
        if (terminal) return
        terminal = true
        void invoke('cancel_recall_turn', { requestId }).catch(() => undefined)
        updateTurn(requestId, turn => ({
          ...turn,
          status: 'error',
          error:
            'Finding clips took too long. Recall stopped; retry to use keyword retrieval if Meaning Search is unavailable.',
        }))
        setActiveRequestId(current => (current === requestId ? null : current))
      }, 12_000)
      onEvent.onmessage = event => {
        if (event.requestId !== requestId || terminal) return
        touchExpiry()
        switch (event.type) {
          case 'stage':
            updateTurn(requestId, turn => ({ ...turn, stage: event.stage }))
            break
          case 'sources':
            window.clearTimeout(retrievalWatchdog)
            updateTurn(requestId, turn => ({
              ...turn,
              sources: event.sources,
              excludedCount: event.excludedCount,
              degradedRetrieval: event.degradedRetrieval,
              contextReduced: event.contextReduced,
            }))
            break
          case 'delta':
            updateTurn(requestId, turn => ({ ...turn, answer: turn.answer + event.text }))
            break
          case 'completed':
            terminal = true
            window.clearTimeout(retrievalWatchdog)
            updateTurn(requestId, turn => ({
              ...turn,
              answer: event.answer,
              status: 'complete',
              providerId: event.providerId,
              model: event.model,
              executionLocation: event.executionLocation,
              completionReason: event.completionReason,
            }))
            setActiveRequestId(current => (current === requestId ? null : current))
            break
          case 'no_evidence':
            terminal = true
            window.clearTimeout(retrievalWatchdog)
            updateTurn(requestId, turn => ({
              ...turn,
              status: 'no_evidence',
              error: event.message,
              degradedRetrieval: event.degradedRetrieval,
            }))
            setActiveRequestId(current => (current === requestId ? null : current))
            break
          case 'cancelled':
            terminal = true
            window.clearTimeout(retrievalWatchdog)
            updateTurn(requestId, turn => ({ ...turn, status: 'incomplete' }))
            setActiveRequestId(current => (current === requestId ? null : current))
            break
          case 'error':
            terminal = true
            window.clearTimeout(retrievalWatchdog)
            updateTurn(requestId, turn => ({ ...turn, status: 'error', error: event.message }))
            setActiveRequestId(current => (current === requestId ? null : current))
            break
        }
      }
      try {
        await invoke('start_recall_turn', {
          request: {
            requestId,
            sessionId,
            question: trimmed,
            scope: nextScope.scope,
            tagId: nextScope.tagId,
            representationFamilies: nextScope.representationFamilies,
            facetIds: nextScope.facetIds,
            enabledSourceIds: nextScope.enabledSourceIds,
            sourceClipIds: options.sourceClipIds ?? null,
          },
          onEvent,
        })
      } catch (error) {
        terminal = true
        window.clearTimeout(retrievalWatchdog)
        updateTurn(requestId, turn => ({ ...turn, status: 'error', error: String(error) }))
        setActiveRequestId(current => (current === requestId ? null : current))
      }
    },
    [activeRequestId, touchExpiry, updateTurn]
  )

  const cancel = useCallback(async () => {
    if (!activeRequestId) return
    await invoke('cancel_recall_turn', { requestId: activeRequestId }).catch(() => undefined)
  }, [activeRequestId])

  const clear = useCallback(() => {
    const sessionId = sessionIdRef.current
    void invoke('clear_recall_session', { sessionId }).catch(() => undefined)
    sessionIdRef.current = newId()
    scopeRef.current = null
    setScope(null)
    setTurns([])
    setActiveRequestId(null)
    setExpired(false)
  }, [])

  return {
    turns,
    activeRequestId,
    isRunning: activeRequestId !== null,
    scope,
    expired,
    startRoot: (question: string, nextScope: RecallScope, sourceClipIds?: string[]) =>
      start(question, nextScope, { newThread: true, sourceClipIds }),
    followUp: (question: string) =>
      scopeRef.current ? start(question, scopeRef.current) : Promise.resolve(),
    rerunWithSources: (question: string, sourceClipIds: string[]) =>
      scopeRef.current
        ? start(question, scopeRef.current, { newThread: true, sourceClipIds })
        : Promise.resolve(),
    searchAll: (question: string) => {
      const current = scopeRef.current
      return current
        ? start(
            question,
            { ...current, scope: 'all', tagId: null, label: 'All history' },
            { newThread: true }
          )
        : Promise.resolve()
    },
    cancel,
    clear,
  }
}
