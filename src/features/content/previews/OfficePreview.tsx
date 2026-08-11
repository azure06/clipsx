import type { Content } from '../types'
import { useState, useMemo } from 'react'
import { FileText, Image as ImageIcon, Table } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getOfficeHtmlTab } from '../office'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

type OfficePreviewProps = {
  readonly content: Content
}

export const OfficePreview = ({ content }: OfficePreviewProps) => {
  const { t } = useTranslation()
  const [selectedTab, setSelectedTab] = useState<'html' | 'text' | 'svg' | 'image' | null>(null)

  const { svg } = content.metadata
  const imagePath = content.clip.imagePath
  const htmlContent = content.clip.contentHtml

  // Convert Tauri file paths to URLs
  const imageUrl = useMemo(() => (imagePath ? convertFileSrc(imagePath) : null), [imagePath])
  const svgUrl = useMemo(() => (svg ? convertFileSrc(svg) : null), [svg])

  const hasSvg = !!svg
  const hasImage = !!imagePath
  const htmlTab = getOfficeHtmlTab(content.metadata, htmlContent)
  const hasHtml = htmlTab.isAvailable

  // Determine default tab
  const defaultTab =
    htmlTab.preferHtml && hasHtml ? 'html' : hasImage ? 'image' : hasSvg ? 'svg' : 'text'

  // Use default tab if selected tab content is not available
  const activeTab =
    (selectedTab === 'html' && hasHtml) ||
    (selectedTab === 'svg' && hasSvg) ||
    (selectedTab === 'image' && hasImage) ||
    selectedTab === 'text'
      ? selectedTab
      : defaultTab

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="flex gap-2 px-4 py-2 bg-slate-100/40 dark:bg-slate-100/2 border-b border-slate-200/80 dark:border-gray-100/10">
        {hasHtml && (
          <TabButton
            icon={<Table className="w-4 h-4" />}
            label={htmlTab.label === 'Table' ? t('preview.table') : t('preview.formatted')}
            active={activeTab === 'html'}
            onClick={() => setSelectedTab('html')}
          />
        )}

        <TabButton
          icon={<FileText className="w-4 h-4" />}
          label={t('preview.plainText')}
          active={activeTab === 'text'}
          onClick={() => setSelectedTab('text')}
        />

        {hasSvg && (
          <TabButton
            icon={<ImageIcon className="w-4 h-4" />}
            label="SVG"
            active={activeTab === 'svg'}
            onClick={() => setSelectedTab('svg')}
          />
        )}

        {hasImage && (
          <TabButton
            icon={<ImageIcon className="w-4 h-4" />}
            label={t('preview.image')}
            active={activeTab === 'image'}
            onClick={() => setSelectedTab('image')}
          />
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {activeTab === 'html' && hasHtml && htmlContent && <HTMLTab html={htmlContent} />}
        {activeTab === 'text' && (
          <TextTab content={content} emptyLabel={t('preview.noTextContent')} />
        )}
        {activeTab === 'svg' && hasSvg && svgUrl && <SVGTab svgUrl={svgUrl} />}
        {activeTab === 'image' && hasImage && imageUrl && <ImageTab imageUrl={imageUrl} />}
      </div>
    </div>
  )
}

// Tab Button Component
type TabButtonProps = {
  readonly icon: React.ReactNode
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
}

const TabButton = ({ icon, label, active, onClick }: TabButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      active
        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
        : 'text-gray-600 hover:text-gray-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:bg-slate-100/5'
    }`}
  >
    {icon}
    {label}
  </button>
)

// HTML Tab
const HTMLTab = ({ html }: { html: string }) => (
  <div className="p-4 bg-slate-100/80 dark:bg-slate-100 text-black min-h-full">
    <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
  </div>
)

// Text Tab
const TextTab = ({ content, emptyLabel }: { content: Content; emptyLabel: string }) => (
  <div className="p-4">
    <pre
      className={`whitespace-pre-wrap font-mono text-sm leading-relaxed ${previewTheme.textSecondary}`}
    >
      {content.text || emptyLabel}
    </pre>
  </div>
)

// SVG Tab
const SVGTab = ({ svgUrl }: { svgUrl: string }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-slate-200/80 dark:border-white/10 flex justify-between items-center">
        <span className={`text-xs ${previewTheme.textMuted}`}>{t('preview.svgImage')}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100/40 dark:bg-slate-100/2">
        <img
          src={svgUrl}
          className="max-w-full max-h-full object-contain"
          alt={t('preview.svgPreview')}
        />
      </div>
    </div>
  )
}

// Image Tab
const ImageTab = ({ imageUrl }: { imageUrl: string }) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center p-8 bg-slate-100/40 dark:bg-slate-100/2">
      <img
        src={imageUrl}
        alt={t('preview.officeContent')}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
      />
    </div>
  )
}
