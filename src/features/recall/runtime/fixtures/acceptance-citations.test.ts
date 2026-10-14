import { describe, expect, it } from 'vitest'
import { hasUnsupportedLocalReferences } from './acceptance-citations'

const citations = [{ number: 1, clipId: 'source', revision: 'r1' }]

describe('native acceptance references', () => {
  it.each(['[2](#read_clip)', '[2](#clip-2)', '[1](#clip-2)', '[1](#clip-01)'])(
    'rejects unsupported references even alongside valid evidence: %s',
    invalid => {
      expect(hasUnsupportedLocalReferences(`Evidence [1](#clip-1). ${invalid}`, citations)).toBe(
        true
      )
    }
  )
  it('accepts registered local references and separate web citations', () => {
    expect(
      hasUnsupportedLocalReferences('[1](#clip-1) and [2](https://example.com/source)', citations)
    ).toBe(false)
  })
  it('rejects references when no evidence has been admitted', () => {
    expect(hasUnsupportedLocalReferences('[1](#clip-1)', [])).toBe(true)
  })
})
