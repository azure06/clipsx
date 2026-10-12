import type { ClipboardCitation } from '../citations'

/** Strict checks for the probe's plain answer, not a general Markdown renderer. */
export function hasUnsupportedLocalReferences(
  answer: string,
  citations: ClipboardCitation[]
): boolean {
  const numbers = new Set(citations.map(citation => citation.number))
  for (const match of answer.matchAll(/\[(\d+)\]\(\s*(#[^)]*)\)/g)) {
    const number = Number(match[1])
    if (!numbers.has(number) || match[2] !== `#clip-${number}`) return true
  }
  return false
}
