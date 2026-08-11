import { convertFileSrc } from '@tauri-apps/api/core'
import { memo, useMemo } from 'react'
import type { Content } from '../types'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

export const ImagePreview = memo(({ content }: { content: Content }) => {
  const { t } = useTranslation()
  const clip = content.clip
  const src = useMemo(() => {
    if (clip.imagePath) return clip.imagePath.startsWith('clipsx-asset://') ? clip.imagePath : convertFileSrc(clip.imagePath)
    if (content.metadata.url) return content.metadata.url
    if (content.text.startsWith('data:image')) return content.text
    return null
  }, [clip.imagePath, content.metadata.url, content.text])

  const ocrText = clip.ocrStatus === 'done' ? (clip.ocrText ?? null) : null
  const ocrPending = clip.ocrStatus === 'pending' || clip.ocrStatus === 'running'

  const hasOcrPanel = ocrText !== null || ocrPending || clip.ocrStatus === 'failed'

  if (!src) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-gray-500 text-sm gap-2">
        <span>{t('preview.noImageSource')}</span>
        <span className="text-xs opacity-50 font-mono">{content.text}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Image — shrinks when OCR panel is present */}
      <div
        className={`flex items-center justify-center p-4 ${hasOcrPanel ? 'flex-[0_0_auto] max-h-[60%]' : 'flex-1'}`}
      >
        <img
          src={src}
          alt={t('preview.imagePreview')}
          className="max-w-full max-h-full object-contain rounded shadow-sm bg-white/50 dark:bg-black/20"
          onError={e => {
            console.error('Failed to load image:', src)
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>

      {/* OCR text panel */}
      {hasOcrPanel && (
        <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100/10 dark:border-slate-100/5">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-500 shrink-0 flex items-center gap-2">
            <span>{t('preview.ocrText')}</span>
            {ocrPending && (
              <span className="text-sky-400 animate-pulse normal-case font-normal tracking-normal">
                {clip.ocrStatus === 'running' ? t('preview.running') : t('preview.queued')}
              </span>
            )}
          </div>

          {ocrPending && (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-500 dark:text-gray-600 italic px-4">
              {t('preview.extractingText')}
            </div>
          )}

          {clip.ocrStatus === 'failed' && (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-500 dark:text-gray-600 italic px-4">
              {t('preview.ocrPlatformUnavailable')}
            </div>
          )}

          {ocrText !== null && (
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3">
              {ocrText.trim() === '' ? (
                <p className="text-xs text-gray-500 dark:text-gray-600 italic">
                  {t('preview.noTextInImage')}
                </p>
              ) : (
                <p
                  className={`text-sm leading-relaxed whitespace-pre-wrap break-words font-light font-mono select-text ${previewTheme.textPrimary}`}
                >
                  {ocrText}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
