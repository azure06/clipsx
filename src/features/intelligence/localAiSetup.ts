import { Channel, invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type en from '../../i18n/en.json'

export const localAiRoles = ['chat', 'embedding', 'decision'] as const
export type LocalAiRole = (typeof localAiRoles)[number]
export type LocalAiPlan = Record<LocalAiRole, string | null> & { privacy: boolean }
export type LocalAiCandidate = {
  id: string
  purpose: LocalAiRole
  copyKey: keyof typeof en.localAiSetup.models
  downloadBytes: number
}

export type LocalAiStatus = {
  runtime: 'running' | 'stopped' | 'missing'
  installedModels: string[]
  startingChat: string | null
  candidates: LocalAiCandidate[]
}
type Progress = {
  stage: 'downloading' | 'verifying' | 'saving'
  downloadedBytes: number
  model: string | null
}
type Stage = Progress['stage'] | 'checking' | 'waiting'

type LocalAiSetup = {
  open: boolean
  status: LocalAiStatus | null
  stage: Stage | null
  failedStage: Stage | null
  downloadedBytes: number
  model: string | null
  plan: LocalAiPlan | null
  step: number
  result: LocalAiPlan | null
  show: () => void
  close: (reset?: boolean) => void
  check: () => Promise<void>
  connect: (action: 'install' | 'open') => Promise<void>
  select: (role: LocalAiRole, id: string | null) => void
  setPrivacy: (enabled: boolean) => void
  move: (offset: -1 | 1) => void
  setup: () => Promise<void>
}

const probe = () => invoke<LocalAiStatus>('ai_local_setup_probe')
let opener: HTMLElement | null = null

export function localAiDownloads(status: LocalAiStatus, plan: LocalAiPlan) {
  return status.candidates.filter(
    model => plan[model.purpose] === model.id && !status.installedModels.includes(model.id)
  )
}

function startingPlan(status: LocalAiStatus): LocalAiPlan {
  return { chat: status.startingChat, embedding: null, decision: null, privacy: false }
}

export const useLocalAiSetup = create<LocalAiSetup>((set, get) => ({
  open: false,
  status: null,
  stage: null,
  failedStage: null,
  downloadedBytes: 0,
  model: null,
  plan: null,
  step: 0,
  result: null,
  show: () => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    set({ open: true })
    if (!get().stage && !get().result) void get().check()
  },
  close: (reset = false) =>
    set(
      reset || get().result ? { open: false, result: null, plan: null, step: 0 } : { open: false }
    ),
  check: async () => {
    if (get().stage) return
    set({ stage: 'checking', failedStage: null, model: null })
    try {
      const status = await probe()
      set({ status, plan: get().plan ?? startingPlan(status) })
    } catch {
      set({ failedStage: 'checking' })
    } finally {
      set({ stage: null })
    }
  },
  connect: async action => {
    if (get().stage) return
    set({ stage: 'waiting', failedStage: null, model: null })
    try {
      if (action === 'install') {
        await invoke('open_external_url', { url: 'https://ollama.com/download' })
      } else {
        await invoke('ai_local_setup_open')
      }
      const deadline = Date.now() + 120_000
      do {
        const status = await probe()
        set({ status, plan: get().plan ?? startingPlan(status) })
        if (status.runtime === 'running') return
        await new Promise(resolve => setTimeout(resolve, 2000))
      } while (Date.now() < deadline && get().open)
    } catch {
      set({ failedStage: 'waiting' })
    } finally {
      set({ stage: null })
    }
  },
  select: (role, id) => {
    const { plan, stage } = get()
    if (!plan || stage) return
    set({
      plan: { ...plan, [role]: id, privacy: plan.privacy && (role !== 'decision' || !!id) },
      failedStage: null,
    })
  },
  setPrivacy: privacy => {
    const { plan, stage } = get()
    if (!plan?.decision || stage) return
    set({ plan: { ...plan, privacy }, failedStage: null })
  },
  move: offset => {
    if (get().stage) return
    set({
      step: Math.max(0, Math.min(localAiRoles.length, get().step + offset)),
      failedStage: null,
    })
  },
  setup: async () => {
    const { plan, status, stage } = get()
    if (!plan || status?.runtime !== 'running' || stage || !localAiRoles.some(role => plan[role]))
      return
    const downloads = localAiDownloads(status, plan).map(model => model.id)
    set({ stage: 'verifying', failedStage: null, model: null, downloadedBytes: 0 })
    let active = true
    try {
      const progress = new Channel<Progress>(event => {
        if (active) set(event)
      })
      set({
        result: await invoke<LocalAiPlan>('ai_local_setup_finish', { plan, downloads, progress }),
      })
    } catch {
      set({ failedStage: get().stage })
      try {
        set({ status: await probe() })
      } catch {
        // Keep the last status and the user's plan available for a retry.
      }
    } finally {
      active = false
      set({ stage: null })
    }
  },
}))

export function restoreLocalSetupFocus() {
  if (opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus()
  opener = null
}
