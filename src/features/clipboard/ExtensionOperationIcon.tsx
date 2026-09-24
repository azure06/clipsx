import { ExtensionIcon } from './ClipActionsToolbar'

export type PinnedOperation = {
  id: string
  packageId: string
  label: string
  kind: 'action' | 'transformer'
  icon: string | null
  iconSvg: string | null
  iconSvgDark: string | null
  iconScale: number
}

export const ExtensionOperationIcon = ({ operation }: { operation: PinnedOperation }) => {
  if (operation.icon || operation.iconSvg) {
    return <ExtensionIcon name={operation.icon} light={operation.iconSvg} dark={operation.iconSvgDark} scale={operation.iconScale} />
  }
  const words = operation.label.match(/[\p{L}\p{N}]+/gu) ?? []
  const monogram = words.length > 1
    ? words.slice(0, 2).map(word => word[0]).join('')
    : operation.label.slice(0, 2)
  return <span aria-hidden="true" className="font-mono text-[10px] font-bold tracking-tight">{monogram.toUpperCase()}</span>
}
