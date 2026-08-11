import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import type { AvailableUpdate, ReleaseInfo, UpdaterStatus } from '../shared/types'

type CheckOptions = {
  readonly silentNoUpdate?: boolean
}

type UpdaterState = {
  currentVersion: string | null
  updaterConfigured: boolean | null
  status: UpdaterStatus
  update: AvailableUpdate | null
  error: string | null
  isInitialized: boolean
  isChecking: boolean
  isDownloading: boolean
  downloadedBytes: number
  totalBytes: number | null
  updateReady: boolean
  initialize: () => Promise<void>
  checkForUpdates: (options?: CheckOptions) => Promise<boolean>
  downloadAndInstallUpdate: () => Promise<boolean>
  restartToApplyUpdate: () => Promise<void>
  dismissUpdate: () => Promise<void>
  clearError: () => void
}

let pendingUpdate: Update | null = null
let initializationPromise: Promise<void> | null = null

const closePendingUpdate = async () => {
  if (!pendingUpdate) return

  try {
    await pendingUpdate.close()
  } catch (error) {
    console.warn('Failed to close pending updater resource:', error)
  } finally {
    pendingUpdate = null
  }
}

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toAvailableUpdate = (update: Update): AvailableUpdate => ({
  currentVersion: update.currentVersion,
  version: update.version,
  date: update.date ?? null,
  body: update.body ?? null,
})

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  currentVersion: null,
  updaterConfigured: null,
  status: 'idle',
  update: null,
  error: null,
  isInitialized: false,
  isChecking: false,
  isDownloading: false,
  downloadedBytes: 0,
  totalBytes: null,
  updateReady: false,

  initialize: async () => {
    if (initializationPromise) {
      await initializationPromise
      return
    }

    initializationPromise = (async () => {
      try {
        const [currentVersion, releaseInfo] = await Promise.all([
          getVersion(),
          invoke<ReleaseInfo>('get_release_info'),
        ])

        set({
          currentVersion,
          updaterConfigured: releaseInfo.updaterConfigured,
          status: releaseInfo.updaterConfigured ? 'idle' : 'unavailable',
          error: null,
        })

        if (releaseInfo.updaterConfigured) {
          await get().checkForUpdates({ silentNoUpdate: true })
        }
      } catch (error) {
        set({
          status: 'error',
          error: toMessage(error),
        })
      } finally {
        set({ isInitialized: true })
      }
    })()

    await initializationPromise
  },

  checkForUpdates: async (options = {}) => {
    const { updaterConfigured } = get()

    if (updaterConfigured === false) {
      set({
        status: 'unavailable',
        error: null,
      })
      return false
    }

    set({
      isChecking: true,
      error: null,
      status: 'checking',
      downloadedBytes: 0,
      totalBytes: null,
      updateReady: false,
    })

    try {
      await closePendingUpdate()
      const update = await check()

      if (!update) {
        set({
          update: null,
          status: options.silentNoUpdate ? 'idle' : 'up-to-date',
        })
        return false
      }

      pendingUpdate = update
      set({
        currentVersion: update.currentVersion,
        update: toAvailableUpdate(update),
        status: 'available',
      })
      return true
    } catch (error) {
      set({
        status: 'error',
        error: toMessage(error),
      })
      return false
    } finally {
      set({ isChecking: false })
    }
  },

  downloadAndInstallUpdate: async () => {
    if (!pendingUpdate) {
      set({
        status: 'error',
        error: 'No downloaded update is available to install yet.',
      })
      return false
    }

    set({
      isDownloading: true,
      status: 'downloading',
      error: null,
      downloadedBytes: 0,
      totalBytes: null,
      updateReady: false,
    })

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          set({
            totalBytes: event.data.contentLength ?? null,
            downloadedBytes: 0,
          })
          return
        }

        if (event.event === 'Progress') {
          set(state => ({
            downloadedBytes: state.downloadedBytes + event.data.chunkLength,
          }))
        }
      })

      await closePendingUpdate()
      set({
        isDownloading: false,
        status: 'downloaded',
        updateReady: true,
      })
      return true
    } catch (error) {
      await closePendingUpdate()
      set({
        isDownloading: false,
        status: 'error',
        error: toMessage(error),
      })
      return false
    }
  },

  restartToApplyUpdate: async () => {
    await invoke('restart_app')
  },

  dismissUpdate: async () => {
    await closePendingUpdate()
    set({
      update: null,
      status: 'idle',
      error: null,
      downloadedBytes: 0,
      totalBytes: null,
      updateReady: false,
    })
  },

  clearError: () => {
    set({ error: null })
  },
}))
