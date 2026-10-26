import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../shared/components/ui'
import type { TransformControls } from './useTransformState'
export function ContextActionsMenu({ controls }: { controls: TransformControls | null }) {
  const { t } = useTranslation()
  if (!controls?.actions.length) return null
  return (
    <DropdownMenu
      onOpenChange={open =>
        window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open } }))
      }
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          rightIcon={<ChevronDown size={12} />}
          className="gap-1 px-2"
        >
          {t('previewWorkspace.actions')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {controls.actions.map(action => (
          <DropdownMenuItem
            key={action.id}
            className="px-2 py-2 text-xs"
            disabled={!action.available}
            title={action.unavailableReason ?? undefined}
            onSelect={() => void controls.runAction(action.id)}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
