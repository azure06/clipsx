import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { ExtensionSummary, RegistryIndex } from '../../shared/types'

export const ExtensionsSettings = ({ close }: { close: () => void }) => {
  const [installed, setInstalled] = useState<ExtensionSummary[]>([])
  const [registry, setRegistry] = useState<RegistryIndex | null>(null)
  const [developerMode, setDeveloperMode] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    const [extensions, enabled] = await Promise.all([
      invoke<ExtensionSummary[]>('list_extensions'),
      invoke<boolean>('get_extension_developer_mode'),
    ])
    setInstalled(extensions)
    setDeveloperMode(enabled)
  }
  const loadRegistry = async (refresh = false) => {
    try {
      setRegistry(
        await invoke<RegistryIndex>(
          refresh ? 'refresh_extension_registry' : 'get_extension_registry'
        )
      )
    } catch (error) {
      setNotice(String(error))
    }
  }
  useEffect(() => {
    let disposed = false
    void Promise.all([
      invoke<ExtensionSummary[]>('list_extensions'),
      invoke<boolean>('get_extension_developer_mode'),
      invoke<RegistryIndex>('get_extension_registry'),
    ])
      .then(([extensions, enabled, index]) => {
        if (disposed) return
        setInstalled(extensions)
        setDeveloperMode(enabled)
        setRegistry(index)
      })
      .catch(error => !disposed && setNotice(String(error)))
    return () => {
      disposed = true
    }
  }, [])

  const mutate = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await load()
      setNotice('')
    } catch (error) {
      setNotice(String(error))
    }
  }
  const localInstall = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'ClipsX extension', extensions: ['clipsx'] }],
    })
    if (typeof selected === 'string')
      await mutate(() => invoke('install_local_extension', { path: selected }))
  }
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60">
      <section className="panel max-h-[85vh] w-full max-w-2xl overflow-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Extensions</h2>
            <p className="mt-1 text-sm text-slate-400">
              Extensions run in a sandbox and receive no filesystem, network, clipboard, history, or
              provider access.
            </p>
          </div>
          <button className="button" onClick={close}>
            Close
          </button>
        </div>
        {notice && <p className="mt-3 rounded bg-amber-950 p-2 text-sm text-amber-200">{notice}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded bg-slate-800/70 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={developerMode}
              onChange={event =>
                void mutate(() =>
                  invoke('set_extension_developer_mode', { enabled: event.target.checked })
                )
              }
            />
            Developer Mode
          </label>
          {developerMode && (
            <button className="button" onClick={() => void localInstall()}>
              Install local package
            </button>
          )}
          {developerMode && (
            <span className="text-amber-300">
              Local packages still run with the same sandbox and limits.
            </span>
          )}
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Installed</h3>
            <button className="tag" onClick={() => void load()}>
              Refresh
            </button>
          </div>
          {installed.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No extensions installed.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {installed.map(extension => (
                <div key={extension.packageId} className="rounded bg-slate-800 p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <div>
                      <strong>{extension.displayName}</strong>{' '}
                      <span className="text-slate-400">{extension.version}</span>
                      <p className="mt-1 text-slate-400">
                        {extension.description || extension.packageId}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {extension.source} · {extension.status}
                      </p>
                    </div>
                    <div className="flex h-fit gap-2">
                      {extension.status === 'quarantined' && (
                        <button
                          className="tag text-amber-300"
                          onClick={() =>
                            void mutate(() =>
                              invoke('recover_extension', { packageId: extension.packageId })
                            )
                          }
                        >
                          Recover
                        </button>
                      )}
                      <button
                        className="tag"
                        onClick={() =>
                          void mutate(() =>
                            invoke('set_extension_enabled', {
                              packageId: extension.packageId,
                              enabled: !extension.enabled,
                            })
                          )
                        }
                      >
                        {extension.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="tag text-red-300"
                        onClick={() =>
                          void mutate(() =>
                            invoke('uninstall_extension', { packageId: extension.packageId })
                          )
                        }
                      >
                        Uninstall
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Reviewed registry</h3>
            <button className="tag" onClick={() => void loadRegistry(true)}>
              Refresh registry
            </button>
          </div>
          {registry ? (
            <div className="mt-2 space-y-2">
              {registry.packages.map(extension => (
                <div
                  key={`${extension.packageId}/${extension.version}`}
                  className="flex items-center justify-between rounded bg-slate-800 p-3 text-sm"
                >
                  <div>
                    <strong>{extension.displayName}</strong>{' '}
                    <span className="text-slate-400">{extension.version}</span>
                    <p className="mt-1 text-slate-400">
                      {extension.description || extension.packageId}
                    </p>
                  </div>
                  <button
                    className="tag"
                    onClick={() =>
                      void mutate(() =>
                        invoke('install_registry_extension', {
                          packageId: extension.packageId,
                          version: extension.version,
                        })
                      )
                    }
                  >
                    Install
                  </button>
                </div>
              ))}
              {registry.packages.length === 0 && (
                <p className="text-sm text-slate-400">The registry is currently empty.</p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">
              Registry unavailable; installed extensions continue to work.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
