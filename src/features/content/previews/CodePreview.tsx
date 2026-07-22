import { memo } from 'react'
import { Code2 } from 'lucide-react'
import type { Content } from '../types'
import { useActionRegistry } from '../actions/registry'
import { MetaChip, PreviewLocalMenu } from './PreviewShell'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

type CodePreviewProps = {
  readonly content: Content
}

const CodePreviewComponent = ({ content }: CodePreviewProps) => {
  const { t } = useTranslation()
  const lineCount = content.text.split('\n').length
  const language = content.metadata.language

  const { getPreviewMenuActions } = useActionRegistry()
  const menuActions = getPreviewMenuActions(content)

  return (
    <div className="flex flex-col h-full">
      {/* Compact header */}
      <div
        className={`flex items-center gap-2 px-4 py-2 border-b shrink-0 ${previewTheme.surfaceMuted}`}
      >
        <Code2 size={14} className="text-violet-400 shrink-0" />
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {language && (
            <MetaChip className="bg-violet-500/10 text-violet-400 border-violet-500/20">
              {language}
            </MetaChip>
          )}
          <MetaChip>{t('clipboard.lines', { count: lineCount })}</MetaChip>
          {content.metadata.word_count != null && (
            <MetaChip>{t('preview.words', { count: content.metadata.word_count })}</MetaChip>
          )}
        </div>
        {menuActions.length > 0 && <PreviewLocalMenu actions={menuActions} content={content} />}
      </div>

      {/* Code content */}
      <div className="flex flex-1 relative bg-white/60 dark:bg-black/40">
        {/* Line numbers */}
        <div className="shrink-0 w-10 bg-slate-100/80 dark:bg-black/30 border-r border-slate-200/80 dark:border-white/5 py-4 text-right select-none">
          {Array.from({ length: Math.min(lineCount, 500) }, (_, i) => (
            <div
              key={i}
              className="text-[10px] text-gray-500 dark:text-gray-700 leading-relaxed px-2 font-mono"
            >
              {i + 1}
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-x-auto custom-scrollbar">
          <pre className="p-4 text-sm leading-relaxed">
            <code className="font-mono text-gray-800 dark:text-gray-300">{content.text}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

export const CodePreview = memo(CodePreviewComponent)
