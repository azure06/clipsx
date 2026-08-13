import { getPlatform, type Platform } from '../keyboard/shortcuts'

const CUSTOM_ASSET_HOST = 'clipsx-asset.localhost'

/**
 * Wry exposes custom protocols through an HTTP origin on Windows. macOS and
 * Linux keep the registered URI scheme.
 */
export const managedAssetUrl = (assetId: string, platform: Platform = getPlatform()): string => {
  const encodedId = encodeURIComponent(assetId)
  return platform === 'windows'
    ? `http://${CUSTOM_ASSET_HOST}/${encodedId}`
    : `clipsx-asset://localhost/${encodedId}`
}
