import type { TransformerConfiguration } from '../../extensions/parameters'
export type UpdateMode = 'inherit' | 'enabled' | 'disabled'

export type ExtensionSummary = {
  packageId: string
  version: string
  displayName: string
  description: string
  iconSvg: string | null
  iconSvgDark: string | null
  source: 'registry' | 'developer'
  enabled: boolean
  status: 'ready' | 'quarantined' | 'incompatible'
  httpOrigins: string[]
  externalNavigationOrigins: string[]
  credentialLabels: string[]
  providers: string[]
  checksum: string | null
  settings: ExtensionSetting[]
}

export type ExtensionSetting = {
  id: string
  label: string
  kind: 'boolean' | 'string' | 'number'
  default: unknown
}

export type RegistryPackage = {
  packageId: string
  version: string
  apiVersion: string
  displayName: string
  description: string
  releaseUrl: string
  sha256: string
  contributions: string[]
  httpOrigins: string[]
  externalNavigationOrigins: string[]
  credentialLabels: string[]
  providers: string[]
  publisher?: { id: string; displayName: string; verified: boolean } | null
  categories: string[]
  tags: string[]
  publishedAt?: string | null
  updatedAt?: string | null
  archiveSizeBytes?: number | null
  license?: string | null
  homepageUrl?: string | null
  repositoryUrl?: string | null
  documentationUrl?: string | null
  iconAssets?: {
    light: { url: string; sha256: string; dataUrl?: string | null }
    dark: { url: string; sha256: string; dataUrl?: string | null }
  } | null
  permissionFingerprint?: string | null
  portableSettings: Array<{ settingId: string; valueKind: 'boolean' | 'number' }>
}

export type CatalogEntry = {
  package: RegistryPackage
  installed: ExtensionSummary | null
  update: RegistryPackage | null
  autoUpdateEligible: boolean
  revoked: boolean
}

export type ExtensionCatalog = {
  packages: CatalogEntry[]
  registry: {
    schemaVersion: number | null
    cached: boolean
    lastSuccessfulCheckAt: number | null
    error: string | null
  }
}

export type ExtensionAction = {
  id: string
  packageId: string
  label: string
  placements: string[]
  available: boolean
  unavailableReason: string | null
  shortcut: string | null
}

export type PackageDetail = {
  installed: ExtensionSummary | null
  package: RegistryPackage | null
  actions: ExtensionAction[]
  activations: Array<{
    id: string
    event: 'clip_created'
    transformerId: string
    matchers?: Array<{ mimeTypes?: string[] }>
  }>
  transformers: TransformerConfiguration[]
  automationConsentRequired: boolean
  automationPermissions: {
    sourceApplication: boolean
    providers: string[]
    packageState: boolean
    http: Array<{ origin: string }>
    externalWrites: Array<{ origin: string }>
  }
  settings: Record<string, unknown>
  credentials: Array<{ id: string; label: string; configured: boolean }>
  update: RegistryPackage | null
  autoUpdateMode: UpdateMode
  autoUpdateEligible: boolean
  grantsRevokedOnUpdate: boolean
  diagnostics: string[]
  revoked: boolean
}

export type CoreUtility = { id: string; kind: string; label: string; version: string }
