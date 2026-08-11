import { useEffect, useMemo, useRef } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import { Button } from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
import { useUpdaterStore } from '../../stores'
import { useTranslation } from 'react-i18next'

const formatBytes = (bytes: number, locale: string | undefined): string => {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: exponent === 0 ? 0 : 1 }).format(value)} ${units[exponent]}`
}

export const UpdateBanner = () => {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const initialize = useUpdaterStore(state => state.initialize)
  const status = useUpdaterStore(state => state.status)
  const update = useUpdaterStore(state => state.update)
  const error = useUpdaterStore(state => state.error)
  const isDownloading = useUpdaterStore(state => state.isDownloading)
  const downloadedBytes = useUpdaterStore(state => state.downloadedBytes)
  const totalBytes = useUpdaterStore(state => state.totalBytes)
  const downloadAndInstallUpdate = useUpdaterStore(state => state.downloadAndInstallUpdate)
  const restartToApplyUpdate = useUpdaterStore(state => state.restartToApplyUpdate)
  const dismissUpdate = useUpdaterStore(state => state.dismissUpdate)

  const lastAnnouncedVersionRef = useRef<string | null>(null)
  const lastErrorRef = useRef<string | null>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (status !== 'available' || !update) return
    if (lastAnnouncedVersionRef.current === update.version) return

    lastAnnouncedVersionRef.current = update.version
    toast({
      type: 'success',
      title: t('updater.readyToast', { version: update.version }),
      description: t('updater.readyDescription'),
    })
  }, [status, t, toast, update])

  useEffect(() => {
    if (status !== 'error' || !error) return
    if (lastErrorRef.current === error) return

    lastErrorRef.current = error
    toast({
      type: 'error',
      title: t('errors.update'),
      description: t('errors.genericDescription'),
    })
  }, [error, status, t, toast])

  const progressLabel = useMemo(() => {
    if (!isDownloading) return null
    if (!totalBytes || totalBytes <= 0) {
      return t('updater.downloaded', {
        size: formatBytes(downloadedBytes, i18n.resolvedLanguage),
      })
    }

    const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
    return `${percent}% · ${formatBytes(downloadedBytes, i18n.resolvedLanguage)} / ${formatBytes(totalBytes, i18n.resolvedLanguage)}`
  }, [downloadedBytes, i18n.resolvedLanguage, isDownloading, t, totalBytes])

  const downloadPercent = useMemo(() => {
    if (!isDownloading || !totalBytes || totalBytes <= 0) return null
    return Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
  }, [downloadedBytes, isDownloading, totalBytes])

  if (status !== 'available' && status !== 'downloading' && status !== 'downloaded') {
    return null
  }

  return (
    <div className="absolute top-4 right-4 z-20 w-80 max-w-[calc(100vw-2rem)]">
      <div className="rounded-xl overflow-hidden bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/10">
        {/* Accent stripe matching TitleBar */}
        <div className="h-0.5 bg-linear-to-r from-blue-400 to-violet-400 shadow-sm shadow-blue-400/40" />

        <div className="p-4">
          {status !== 'downloaded' && update && (
            <>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-blue-500/10 p-1.5 text-blue-500 dark:text-blue-400 shrink-0">
                  <Download className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                    {t('updater.available', { version: update.version })}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {t('updater.currentVersion', { version: update.currentVersion })}
                  </p>
                  {update.body && (
                    <p className="mt-2 line-clamp-2 text-[11px] text-gray-500 dark:text-gray-500 whitespace-pre-wrap">
                      {update.body}
                    </p>
                  )}
                  {isDownloading && (
                    <div className="mt-2.5">
                      <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-linear-to-r from-blue-400 to-violet-400 transition-all duration-300"
                          style={{
                            width: downloadPercent != null ? `${downloadPercent}%` : '100%',
                          }}
                        />
                      </div>
                      {progressLabel && (
                        <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                          {progressLabel}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => void dismissUpdate()}>
                  {t('common.later')}
                </Button>
                <Button
                  size="sm"
                  isLoading={isDownloading}
                  onClick={() => void downloadAndInstallUpdate()}
                >
                  {isDownloading ? t('updater.installing') : t('updater.installUpdate')}
                </Button>
              </div>
            </>
          )}

          {status === 'downloaded' && (
            <>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-emerald-500/10 p-1.5 text-emerald-500 dark:text-emerald-400 shrink-0">
                  <RotateCcw className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                    {t('updater.ready')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {t('updater.restartDescription')}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => void dismissUpdate()}>
                  {t('common.later')}
                </Button>
                <Button size="sm" onClick={() => void restartToApplyUpdate()}>
                  {t('updater.restartNow')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
