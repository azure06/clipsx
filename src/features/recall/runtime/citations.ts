/** References belong to one answer and identify a verified clip revision. */
export interface ClipboardCitation {
  number: number
  clipId: string
  revision: string
}

export class CitationRegistry {
  private entries: ClipboardCitation[] = []

  register(clipId: string, revision: string): ClipboardCitation {
    const existing = this.entries.find(c => c.clipId === clipId && c.revision === revision)
    if (existing) return existing
    const citation = { number: this.entries.length + 1, clipId, revision }
    this.entries.push(citation)
    return citation
  }

  snapshot(): ClipboardCitation[] {
    return this.entries.map(citation => ({ ...citation }))
  }
}

/** Saved message metadata is data, never an executable link target. */
export function readCitations(value: unknown): ClipboardCitation[] {
  if (!Array.isArray(value)) return []
  const numbers = new Set<number>()
  return value.filter((item: unknown): item is ClipboardCitation => {
    if (!item || typeof item !== 'object') return false
    const c = item as Partial<ClipboardCitation>
    if (
      !Number.isSafeInteger(c.number) ||
      !c.number ||
      c.number < 1 ||
      typeof c.clipId !== 'string' ||
      !c.clipId ||
      typeof c.revision !== 'string' ||
      !c.revision ||
      numbers.has(c.number)
    )
      return false
    numbers.add(c.number)
    return true
  })
}
