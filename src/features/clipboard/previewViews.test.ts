import { describe, it, expect } from 'vitest'
import { view } from './previewFixtures.test-utils'
import { defaultPreferenceScope, isInspectionView, viewChoiceLabel } from './previewViews'
describe('presentation and source identities', () => {
  it('keeps HTML and RTF source choices distinguishable', () => {
    const html = view({ purpose: 'source', presentationKind: 'source' }),
      rtf = view({
        sourceId: 'rtf',
        mimeType: 'text/rtf',
        purpose: 'source',
        presentationKind: 'source',
      })
    expect(viewChoiceLabel(html, [html, rtf], { source: 'Source' })).toContain('HTML')
    expect(viewChoiceLabel(rtf, [html, rtf], { source: 'Source' })).toContain('RTF')
    expect(isInspectionView(html)).toBe(true)
  })
  it('preserves extension-authored display labels and chooses the most specific preference scope', () => {
    const custom = view({
      rendererId: 'example.pretty/view',
      label: 'Spreadsheet preview',
      facetId: 'core.data.table',
    })
    expect(viewChoiceLabel(custom, [custom], { html: 'Formatted HTML' })).toBe(
      'Spreadsheet preview'
    )
    expect(defaultPreferenceScope(custom)).toBe('facet')
    expect(defaultPreferenceScope(view())).toBe('mime')
  })
})
