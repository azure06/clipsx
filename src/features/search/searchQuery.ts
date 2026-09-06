export type ParsedSearch = {
  query: string
  representationFamilies: string[]
  facetIds: string[]
}

const searchFilters: Record<string, { representationFamily?: string; facetId?: string }> = {
  text: { representationFamily: 'text' },
  image: { representationFamily: 'image' },
  file: { representationFamily: 'files' },
  files: { representationFamily: 'files' },
  html: { representationFamily: 'html' },
  rtf: { representationFamily: 'rtf' },
  office: { representationFamily: 'office' },
  document: { representationFamily: 'document' },
  pdf: { representationFamily: 'document' },
  json: { facetId: 'core.data.json' },
  csv: { facetId: 'core.data.table' },
  table: { facetId: 'core.data.table' },
  url: { facetId: 'core.link.url' },
  markdown: { facetId: 'core.text.markdown' },
  code: { facetId: 'core.text.code' },
  email: { facetId: 'core.contact.email' },
  color: { facetId: 'core.value.color' },
  math: { facetId: 'core.math.expression' },
  phone: { facetId: 'core.contact.phone' },
  path: { facetId: 'core.file.path' },
  secret: { facetId: 'core.security.secret' },
  date: { facetId: 'core.time.date' },
  timestamp: { facetId: 'core.time.date' },
}

export const parseSearch = (input: string): ParsedSearch => {
  const representationFamilies = new Set<string>()
  const facetIds = new Set<string>()
  const query = input
    .replace(/\/(\w+)/g, (token, name: string) => {
      const filter = searchFilters[name.toLowerCase()]
      if (!filter) return token
      if (filter.representationFamily) representationFamilies.add(filter.representationFamily)
      if (filter.facetId) facetIds.add(filter.facetId)
      return ''
    })
    .trim()
  return { query, representationFamilies: [...representationFamilies], facetIds: [...facetIds] }
}
