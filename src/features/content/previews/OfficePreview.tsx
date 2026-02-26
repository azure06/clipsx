import type { Content } from '../types'
import { useState, useMemo } from 'react'
import { FileText, Image as ImageIcon, Download } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'

type OfficePreviewProps = {
  readonly content: Content
}

export const OfficePreview = ({ content }: OfficePreviewProps) => {
  const [selectedTab, setSelectedTab] = useState<'text' | 'svg' | 'image' | null>(null)

  const { svg, attachment_path } = content.metadata
  const imagePath = content.clip.imagePath

  // Convert Tauri file paths to URLs
  const imageUrl = useMemo(() => (imagePath ? convertFileSrc(imagePath) : null), [imagePath])
  const svgUrl = useMemo(() => (svg ? convertFileSrc(svg) : null), [svg])

  const hasSvg = !!svg
  const hasImage = !!imagePath
  const hasAttachment = !!attachment_path

  // Determine default tab
  const defaultTab = hasImage ? 'image' : hasSvg ? 'svg' : 'text'

  // Use default tab if selected tab content is not available
  const activeTab =
    (selectedTab === 'svg' && hasSvg) ||
    (selectedTab === 'image' && hasImage) ||
    selectedTab === 'text'
      ? selectedTab
      : defaultTab

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="flex gap-2 px-4 py-2 bg-white/[0.02] border-b border-white/10">
        <TabButton
          icon={<FileText className="w-4 h-4" />}
          label="Text"
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
            label="Image"
            active={activeTab === 'image'}
            onClick={() => setSelectedTab('image')}
          />
        )}

        {hasAttachment && (
          <div className="ml-auto">
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-300 bg-white/5 hover:bg-white/10 rounded-md transition-colors"
              onClick={() => {
                if (attachment_path) {
                  // TODO: Implement attachment download
                  console.log('Download attachment:', attachment_path)
                }
              }}
            >
              <Download className="w-3 h-3" />
              Attachment
            </button>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {activeTab === 'text' && <TextTab content={content} />}
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
        : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
    }`}
  >
    {icon}
    {label}
  </button>
)

// Text Tab
const TextTab = ({ content }: { content: Content }) => (
  <div className="p-4">
    <pre className="whitespace-pre-wrap font-mono text-sm text-gray-300 leading-relaxed">
      {content.text || '(No text content)'}
    </pre>
  </div>
)

// SVG Tab
const SVGTab = ({ svgUrl }: { svgUrl: string }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-white/10 flex justify-between items-center">
        <span className="text-xs text-gray-500">SVG Image</span>
      </div>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-white/[0.02]">
        <img src={svgUrl} className="max-w-full max-h-full object-contain" alt="SVG preview" />
      </div>
    </div>
  )
}

// Image Tab
const ImageTab = ({ imageUrl }: { imageUrl: string }) => (
  <div className="flex items-center justify-center p-8 bg-white/[0.02]">
    <img
      src={imageUrl}
      alt="Office content"
      className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
    />
  </div>
)
