import { normalizeLanguage } from '../../i18n'

const documentationPages = {
  localAi: 'local-ai',
  meaningSearch: 'meaning-search',
  recall: 'recall',
  extensions: 'extensions',
} as const

export type DocumentationGuide = keyof typeof documentationPages

export function getDocumentationUrl(
  guide: DocumentationGuide,
  language: string | undefined,
  anchor?: string
): string {
  const prefix = normalizeLanguage(language) === 'ja' ? '/ja' : ''
  const fragment = anchor ? `#${encodeURIComponent(anchor)}` : ''
  return `https://docs.clipsx.app${prefix}/${documentationPages[guide]}${fragment}`
}
