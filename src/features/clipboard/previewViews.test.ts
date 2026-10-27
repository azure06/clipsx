import { describe, it, expect } from 'vitest'
import { view } from './previewFixtures.test-utils'
import { isInspectionView, viewChoiceLabel, viewPreferenceTarget } from './previewViews'
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
  it('preserves extension-authored display labels', () => {
    const custom = view({
      rendererId: 'example.pretty/view',
      label: 'Spreadsheet preview',
      facetId: 'core.data.table',
    })
    expect(viewChoiceLabel(custom, [custom], { html: 'Formatted HTML' })).toBe(
      'Spreadsheet preview'
    )
  })
})

it('only offers defaults for precisely named content and matches facet source identity', () => {
  const text = view({ mimeType: 'text/plain', facetId: null })
  expect(viewPreferenceTarget(text)).toBeNull()
  expect(viewPreferenceTarget(view({ mimeType: null }))).toBeNull()
  const mermaid = { ...text, facetId: 'example.mermaid', sourceId: 'diagram' }
  const facet = {
    id: 'example.mermaid',
    displayName: 'Mermaid',
    sourceRepresentationId: 'diagram',
    detectorId: 'example.detector',
    detectorVersion: '1',
    payload: null,
  }
  expect(viewPreferenceTarget(mermaid, [facet])).toEqual({ scope: 'facet', name: 'Mermaid' })
  expect(viewPreferenceTarget(mermaid, [{ ...facet, sourceRepresentationId: 'other' }])).toBeNull()
  expect(viewPreferenceTarget(mermaid, [{ ...facet, displayName: 'Text' }])).toBeNull()
  expect(viewPreferenceTarget(view())).toEqual({ scope: 'mime', name: 'HTML' })
  expect(viewPreferenceTarget(view({ purpose: 'source' }))).toBeNull()
})
