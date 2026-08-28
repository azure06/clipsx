import { describe, expect, it } from 'vitest'
import { managedAssetUrl, transformImageUrl } from './assetUrl'

describe('managedAssetUrl', () => {
  it('uses Wry custom-protocol origins on Windows', () => {
    expect(managedAssetUrl('binary-id', 'windows')).toBe('http://clipsx-asset.localhost/binary-id')
  })

  it.each(['macos', 'linux'] as const)('uses the registered scheme on %s', platform => {
    expect(managedAssetUrl('binary/id', platform)).toBe('clipsx-asset://localhost/binary%2Fid')
  })
})

describe('transformImageUrl', () => {
  it('addresses one expiring output on Windows', () => {
    expect(transformImageUrl('result-id', 2, 'windows')).toBe(
      'http://clipsx-transform.localhost/result-id/2'
    )
  })

  it('uses the registered scheme on macOS and Linux', () => {
    expect(transformImageUrl('result-id', 0, 'linux')).toBe(
      'clipsx-transform://localhost/result-id/0'
    )
  })
})
