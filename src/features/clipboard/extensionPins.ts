import type { PinnedOperation } from './ExtensionOperationIcon'

export const retainInstalledPins = (
  pins: PinnedOperation[],
  installedPackageIds: ReadonlySet<string>,
  savedSetupIds?: ReadonlySet<string>
) =>
  pins.filter(
    pin =>
      installedPackageIds.has(pin.packageId) &&
      (!pin.id.startsWith('saved:') || !savedSetupIds || savedSetupIds.has(pin.id.slice(6)))
  )
