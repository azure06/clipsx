import { describe, expect, it } from 'vitest'
import { managedAssetUrl } from './assetUrl'

describe('managedAssetUrl', () => {
  it('uses Wry custom-protocol origins on Windows', () => {
    expect(managedAssetUrl('binary-id', 'windows')).toBe('http://clipsx-asset.localhost/binary-id')
  })

  it.each(['macos', 'linux'] as const)('uses the registered scheme on %s', platform => {
    expect(managedAssetUrl('binary/id', platform)).toBe('clipsx-asset://localhost/binary%2Fid')
  })
})
