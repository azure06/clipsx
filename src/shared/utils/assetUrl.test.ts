import { describe, expect, it } from 'vitest'
import { artifactFileUrl, managedAssetUrl } from './assetUrl'

describe('managedAssetUrl', () => {
  it('uses Wry custom-protocol origins on Windows', () => {
    expect(managedAssetUrl('binary-id', 'windows')).toBe('http://clipsx-asset.localhost/binary-id')
  })

  it.each(['macos', 'linux'] as const)('uses the registered scheme on %s', platform => {
    expect(managedAssetUrl('binary/id', platform)).toBe('clipsx-asset://localhost/binary%2Fid')
  })
})

describe('artifactFileUrl', () => {
  it('addresses a durable output on Windows', () => {
    expect(artifactFileUrl('file-id', 'windows')).toBe('http://clipsx-artifact.localhost/file-id')
  })

  it('uses the registered scheme on macOS and Linux', () => {
    expect(artifactFileUrl('file-id', 'linux')).toBe('clipsx-artifact://localhost/file-id')
  })
})
