export const clipsxAssetUrl = (binaryFileId: string, userAgent = navigator.userAgent) =>
  userAgent.includes('Windows')
    ? `http://clipsx-asset.localhost/${encodeURIComponent(binaryFileId)}`
    : `clipsx-asset://localhost/${encodeURIComponent(binaryFileId)}`
