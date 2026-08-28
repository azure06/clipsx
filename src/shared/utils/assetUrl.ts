import { getPlatform, type Platform } from '../keyboard/shortcuts'

const CUSTOM_ASSET_HOST = 'clipsx-asset.localhost'
const TRANSFORM_ASSET_HOST = 'clipsx-transform.localhost'

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

export const transformImageUrl = (
  resultId: string,
  outputIndex: number,
  platform: Platform = getPlatform()
): string => {
  const path = `${encodeURIComponent(resultId)}/${outputIndex}`
  return platform === 'windows'
    ? `http://${TRANSFORM_ASSET_HOST}/${path}`
    : `clipsx-transform://localhost/${path}`
}
