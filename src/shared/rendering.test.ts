import { describe, expect, it } from 'vitest'
import { clipsxAssetUrl } from './rendering'

describe('clipsx asset URLs', () => {
  it('uses the Windows custom-protocol origin', () => {
    expect(clipsxAssetUrl('file-id', 'Windows')).toBe('http://clipsx-asset.localhost/file-id')
  })

  it('uses the native scheme elsewhere and escapes IDs', () => {
    expect(clipsxAssetUrl('file/id', 'Macintosh')).toBe('clipsx-asset://localhost/file%2Fid')
  })
})
