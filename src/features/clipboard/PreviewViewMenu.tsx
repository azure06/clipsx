import { Check, ChevronDown, Eye, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../../shared/components/ui'
import { useToast } from '../../shared/contexts/ToastContext'
import type { ViewTabControls } from './V2ViewPanel'
import {
  defaultPreferenceScope,
  isInspectionView,
  sourceLabel,
  viewChoiceLabel,
} from './previewViews'

export function PreviewViewMenu({
  controls,
  onChoose,
}: {
  controls: ViewTabControls
  onChoose: (id: string) => void
}) {
  const { t } = useTranslation(),
    { toast } = useToast()
  const labels: Record<string, string> = {
    html: t('previewWorkspace.formatted'),
    rich_text: t('previewWorkspace.formattedText'),
    text: t('previewWorkspace.plainText'),
    source: t('previewWorkspace.source'),
    json: 'JSON',
    table: t('previewWorkspace.table'),
    image: t('previewWorkspace.image'),
  }
  const active = controls.views.find(view => view.id === controls.activeId)
  const label = (view: (typeof controls.views)[number]) =>
    viewChoiceLabel(view, controls.views, labels)
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
          aria-label={t('previewWorkspace.chooseView')}
          className="max-w-full gap-1.5 text-slate-500"
          leftIcon={<Eye size={13} />}
          rightIcon={<ChevronDown size={12} />}
        >
          <span className="truncate">{active ? label(active) : t('previewWorkspace.view')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 min-w-52 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        {[false, true].map(inspect => (
          <div key={String(inspect)}>
            {controls.views.some(view => isInspectionView(view) === inspect) && (
              <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t(inspect ? 'previewWorkspace.storedSources' : 'previewWorkspace.display')}
              </div>
            )}
            {controls.views
              .filter(view => isInspectionView(view) === inspect)
              .map(view => (
                <DropdownMenuItem
                  key={view.id}
                  onSelect={() => onChoose(view.id)}
                  className="gap-2 px-2 py-2 text-xs"
                >
                  <span className="w-3 shrink-0">
                    {view.id === controls.activeId && <Check size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label(view)}</span>
                </DropdownMenuItem>
              ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        {active && !isInspectionView(active) && !active.id.startsWith('__') && (
          <DropdownMenuItem
            className="px-2 py-2 text-xs"
            onSelect={() => {
              void controls
                .onPreferActive(defaultPreferenceScope(active))
                .then(() =>
                  toast({ title: t('previewWorkspace.preferenceSaved'), type: 'success' })
                )
                .catch(error =>
                  toast({ title: t('common.error'), description: String(error), type: 'error' })
                )
            }}
          >
            {t('previewWorkspace.preferView', {
              type: active.facetId?.split('.').at(-1)?.toUpperCase() ?? sourceLabel(active),
            })}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="gap-2 px-2 py-2 text-xs" onSelect={controls.onShowInspector}>
          <Database size={13} />
          {t('previewWorkspace.inspectFormats')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
