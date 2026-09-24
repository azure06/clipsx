import { getPlatform, type Platform } from '../keyboard/shortcuts'

const CUSTOM_ASSET_HOST = 'clipsx-asset.localhost'
const ARTIFACT_ASSET_HOST = 'clipsx-artifact.localhost'

export const artifactFileUrl = (fileId: string, platform: Platform = getPlatform()): string => {
  const encodedId = encodeURIComponent(fileId)
  return platform === 'windows'
    ? `http://${ARTIFACT_ASSET_HOST}/${encodedId}`
    : `clipsx-artifact://localhost/${encodedId}`
}

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
