import { describe, expect, it } from 'vitest'
import { citationIssues } from './citation-validation'

const sources = [{ number: 1, clipId: 'source', revision: 'r' }]
describe('answer citation validation', () => {
  it.each(['[3](#clip-3)', '[1](#clip-3)', '[1](#read_clip)', '[3]', '[1]'])(
    'rejects %s without guessing its source',
    reference => {
      expect(citationIssues('Fact ' + reference, sources).length).toBeGreaterThan(0)
    }
  )
  it('accepts registered evidence and independent web references', () => {
    expect(citationIssues('Fact [1](#clip-1), web [9](https://example.com).', sources)).toEqual([])
  })
  it('ignores code examples and requires evidence references for a sourced answer', () => {
    expect(citationIssues('Example `[8](#clip-8)`\n```\n[9](#clip-9)\n```', [])).toEqual([])
    expect(citationIssues('Fact with no reference', sources)).toContain('missing_source_reference')
    expect(citationIssues('Ordinary chat', [])).toEqual([])
  })
})
