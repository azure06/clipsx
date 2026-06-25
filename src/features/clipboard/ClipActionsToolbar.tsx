import { useActionRegistry } from '../content'
import type { Content, SmartAction, ActionContext } from '../content'
import * as Tooltip from '@radix-ui/react-tooltip'
import { formatShortcut } from '../../shared/keyboard/shortcuts'
import { previewTheme } from '../content/previews/previewTheme'

interface ClipActionsToolbarProps {
  content: Content
  context?: ActionContext
}

export const ClipActionsToolbar = ({ content, context }: ClipActionsToolbarProps) => {
  const { getActionGroups } = useActionRegistry(context)

  if (!content) return null

  const { standard, smart, meta } = getActionGroups(content)

  const hasAnyActions = standard.length > 0 || smart.length > 0 || meta.length > 0
  if (!hasAnyActions) return null

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {standard.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}

        {standard.length > 0 && smart.length > 0 && (
          <div className="w-px h-3 bg-slate-300/70 dark:bg-slate-100/10 mx-1" />
        )}

        {smart.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}

        {(standard.length > 0 || smart.length > 0) && meta.length > 0 && (
          <div className="w-px h-3 bg-slate-300/70 dark:bg-slate-100/10 mx-1" />
        )}

        {meta.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}
      </div>
    </Tooltip.Provider>
  )
}

const ActionIconButton = ({ action, content }: { action: SmartAction; content: Content }) => {
  const isActive = action.isActive?.(content)
  const shortcutLabel = formatShortcut(action.shortcut)

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          onClick={() => void action.execute(content)}
          className={`p-1.5 rounded-md transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${
            isActive
              ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
              : 'text-gray-500 hover:text-gray-900 hover:bg-slate-200/60 dark:text-gray-400 dark:hover:text-white dark:hover:bg-slate-100/10'
          }`}
        >
          <div className="w-4 h-4">{action.icon}</div>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={`z-100 px-2 py-1 text-[10px] rounded shadow-lg animate-in fade-in-0 zoom-in-95 ${previewTheme.surfaceElevated} ${previewTheme.textPrimary}`}
          sideOffset={5}
        >
          {action.label}
          {shortcutLabel && (
            <span className={`ml-1.5 ${previewTheme.textMuted}`}>{shortcutLabel}</span>
          )}
          <Tooltip.Arrow className="fill-white dark:fill-slate-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
