import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Copy, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/ui'
import { copyLiteralText } from '../../shared/clipboardOutput'
import type { ReleaseInfo } from '../../shared/types/updater'
import { SettingsSection } from './components/SettingsPrimitives'

export function AboutAppInfo() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<ReleaseInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const copying = useRef(false)

  useEffect(() => {
    let active = true
    void invoke<ReleaseInfo>('get_release_info').then(
      value => {
        if (active) {
          setInfo(value)
          setLoading(false)
        }
      },
      () => {
        if (active) {
          setFailed(true)
          setLoading(false)
        }
      }
    )
    return () => {
      active = false
    }
  }, [attempt])

  const unavailable = t('about.unavailable')
  const buildType = info
    ? t(info.buildType === 'development' ? 'about.development' : 'about.release')
    : ''
  const modified = info?.modified ? ` (${t('about.modified')})` : ''

  async function copy() {
    if (!info || copying.current) return
    copying.current = true
    setCopyState('copying')
    try {
      await copyLiteralText(
        [
          `ClipsX ${info.version}`,
          `${t('about.commit')}: ${info.commit ?? unavailable}`,
          `${t('about.workingTree')}: ${info.modified === null ? unavailable : t(info.modified ? 'about.modified' : 'about.clean')}`,
          `${t('about.os')}: ${info.os}`,
          `${t('about.architecture')}: ${info.architecture}`,
          `${t('about.buildType')}: ${buildType}`,
        ].join('\n')
      )
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    } finally {
      copying.current = false
    }
  }

  return (
    <SettingsSection
      icon={<Info className="h-4 w-4" />}
      title={t('about.title')}
      description={t('about.description')}
    >
      {loading && (
        <p role="status" className="text-sm text-slate-500">
          {t('about.loading')}
        </p>
      )}
      {failed && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('about.loadFailed')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFailed(false)
              setLoading(true)
              setAttempt(value => value + 1)
            }}
          >
            {t('about.retry')}
          </Button>
        </div>
      )}
      {info && (
        <>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-3 text-sm text-slate-900 dark:text-slate-100">
            {[
              [t('about.version'), info.version],
              [t('about.commit'), `${info.commit?.slice(0, 12) ?? unavailable}${modified}`],
              [t('about.os'), info.os],
              [t('about.architecture'), info.architecture],
              [t('about.buildType'), buildType],
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-slate-500">{label}</dt>
                <dd
                  className="break-all"
                  title={label === t('about.commit') ? (info.commit ?? undefined) : undefined}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Copy className="h-3.5 w-3.5" />}
            isLoading={copyState === 'copying'}
            onClick={() => void copy()}
          >
            {t('about.copy')}
          </Button>
          {copyState === 'copied' && (
            <p role="status" className="text-sm text-slate-500">
              {t('about.copied')}
            </p>
          )}
          {copyState === 'failed' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {t('about.copyFailed')}
            </p>
          )}
        </>
      )}
    </SettingsSection>
  )
}
