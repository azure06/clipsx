import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import { FileCode2 } from 'lucide-react'
import { useTheme } from '../../../shared/hooks/useTheme'
import type { Content } from '../types'
import { useActionRegistry } from '../actions/registry'
import { MetaChip, PreviewHeader } from './PreviewShell'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

type MarkdownPreviewProps = {
  readonly content: Content
}

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & {
  readonly children?: ReactNode
  readonly inline?: boolean
}

type MermaidDiagramProps = {
  readonly chart: string
}

const markdownChildrenToText = (children: ReactNode): string =>
  Array.isArray(children)
    ? children.map(markdownChildrenToText).join('')
    : typeof children === 'string'
      ? children
      : ''

const MermaidDiagram = ({ chart }: MermaidDiagramProps) => {
  const { t } = useTranslation()
  const { appliedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const rawId = useId()
  const [hasError, setHasError] = useState(false)
  const diagramId = useMemo(() => `mermaid-${rawId.replace(/[:]/g, '')}`, [rawId])

  useEffect(() => {
    let isCancelled = false
    const container = containerRef.current

    const renderDiagram = async () => {
      if (!container) return

      setHasError(false)
      container.innerHTML = ''

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: appliedTheme === 'dark' ? 'dark' : 'default',
      })

      try {
        const { svg } = await mermaid.render(diagramId, chart)
        if (!isCancelled) {
          container.innerHTML = svg
        }
      } catch (error) {
        console.error('Failed to render Mermaid diagram:', error)
        if (!isCancelled) {
          setHasError(true)
        }
      }
    }

    void renderDiagram()

    return () => {
      isCancelled = true
      if (container) {
        container.innerHTML = ''
      }
    }
  }, [appliedTheme, chart, diagramId])

  if (hasError) {
    return (
      <div className="rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        {t('preview.unableMermaid')}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/70 px-3 py-3 shadow-sm dark:border-white/10 dark:bg-black/20">
      <div
        ref={containerRef}
        data-testid="mermaid-diagram"
        className="overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full"
      />
    </div>
  )
}

const MarkdownPreviewComponent = ({ content }: MarkdownPreviewProps) => {
  const { t } = useTranslation()
  const { getPreviewMenuActions } = useActionRegistry()
  const menuActions = getPreviewMenuActions(content)
  const lineCount = content.text.split('\n').length
  const wordCount = content.metadata.word_count ?? content.text.split(/\s+/).filter(Boolean).length

  const components = useMemo(
    () => ({
      pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
      h1: ({ children }: ComponentPropsWithoutRef<'h1'>) => (
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-50">
          {children}
        </h1>
      ),
      h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
        <h2 className="mt-6 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-50">
          {children}
        </h2>
      ),
      h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
        <h3 className="mt-5 text-lg font-semibold text-gray-900 dark:text-gray-100">{children}</h3>
      ),
      p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
        <p className="text-sm leading-7 text-gray-800 dark:text-gray-200">{children}</p>
      ),
      ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
        <ul className="list-disc space-y-2 pl-6 text-sm text-gray-800 dark:text-gray-200">
          {children}
        </ul>
      ),
      ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
        <ol className="list-decimal space-y-2 pl-6 text-sm text-gray-800 dark:text-gray-200">
          {children}
        </ol>
      ),
      li: ({ children }: ComponentPropsWithoutRef<'li'>) => <li className="pl-1">{children}</li>,
      blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote className="border-l-4 border-sky-300/80 bg-sky-50/60 px-4 py-2 italic text-gray-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-gray-200">
          {children}
        </blockquote>
      ),
      a: ({ children, href }: ComponentPropsWithoutRef<'a'>) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-sky-700 underline decoration-sky-400/60 underline-offset-4 dark:text-sky-300"
        >
          {children}
        </a>
      ),
      table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
          <table className="min-w-full border-collapse bg-white/70 text-sm dark:bg-black/20">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: ComponentPropsWithoutRef<'thead'>) => (
        <thead className="bg-slate-100/80 dark:bg-white/5">{children}</thead>
      ),
      th: ({ children }: ComponentPropsWithoutRef<'th'>) => (
        <th className="border-b border-slate-200/80 px-3 py-2 text-left font-semibold text-gray-900 dark:border-white/10 dark:text-gray-100">
          {children}
        </th>
      ),
      td: ({ children }: ComponentPropsWithoutRef<'td'>) => (
        <td className="border-t border-slate-200/70 px-3 py-2 text-gray-700 dark:border-white/10 dark:text-gray-200">
          {children}
        </td>
      ),
      code: ({ className, children, inline, ...rest }: MarkdownCodeProps) => {
        const language = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase()
        const code = markdownChildrenToText(children).replace(/\n$/, '')

        if (inline || !language) {
          return (
            <code
              {...rest}
              className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[0.92em] text-fuchsia-700 dark:bg-white/10 dark:text-fuchsia-200"
            >
              {children}
            </code>
          )
        }

        if (language === 'mermaid') {
          return <MermaidDiagram chart={code} />
        }

        return (
          <pre className="overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-sm dark:border-white/10">
            <code {...rest} className={className}>
              {code}
            </code>
          </pre>
        )
      },
    }),
    []
  )

  return (
    <div className="flex h-full flex-col">
      <div className={`shrink-0 border-b px-4 py-3 ${previewTheme.surfaceMuted}`}>
        <PreviewHeader
          icon={<FileCode2 size={15} className="text-cyan-500" />}
          title={t('preview.markdownDocument')}
          meta={
            <>
              <MetaChip className="bg-cyan-500/10 text-cyan-700 border-cyan-500/20 dark:text-cyan-300">
                markdown
              </MetaChip>
              <MetaChip>{t('clipboard.lines', { count: lineCount })}</MetaChip>
              <MetaChip>{t('preview.words', { count: wordCount })}</MetaChip>
            </>
          }
          menuActions={menuActions}
          content={content}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
        <div className="space-y-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content.text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export const MarkdownPreview = memo(MarkdownPreviewComponent)
