import type { PinnedOperation } from './ExtensionOperationIcon'

export const retainInstalledPins = (pins: PinnedOperation[], installedPackageIds: ReadonlySet<string>) =>
  pins.filter(pin => installedPackageIds.has(pin.packageId))
