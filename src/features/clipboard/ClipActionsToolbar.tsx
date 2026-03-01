import { useActionRegistry } from '../content'
import type { Content, SmartAction, ActionContext } from '../content'
import * as Tooltip from '@radix-ui/react-tooltip'

interface ClipActionsToolbarProps {
  content: Content
  context?: ActionContext
}

export const ClipActionsToolbar = ({ content, context }: ClipActionsToolbarProps) => {
  const { getActionGroups } = useActionRegistry(context)

  if (!content) return null

  // Get grouped actions
  const { standard, smart, meta } = getActionGroups(content)

  const hasAnyActions = standard.length > 0 || smart.length > 0 || meta.length > 0
  if (!hasAnyActions) return null

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {/* Standard Actions */}
        {standard.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}

        {/* Separator if we have smart actions */}
        {standard.length > 0 && smart.length > 0 && (
          <div className="w-px h-3 bg-slate-100/10 mx-1" />
        )}

        {/* Smart Actions */}
        {smart.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}

        {/* Separator if we have meta actions */}
        {(standard.length > 0 || smart.length > 0) && meta.length > 0 && (
          <div className="w-px h-3 bg-slate-100/10 mx-1" />
        )}

        {/* Meta Actions */}
        {meta.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}
      </div>
    </Tooltip.Provider>
  )
}

const ActionIconButton = ({ action, content }: { action: SmartAction; content: Content }) => {
  const isActive = action.isActive?.(content)

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          onClick={() => void action.execute(content)}
          className={`p-1.5 rounded-md transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${
            isActive
              ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
              : 'text-gray-400 hover:text-white hover:bg-slate-100/10'
          }`}
        >
          <div className="w-4 h-4">{action.icon}</div>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-100 px-2 py-1 text-[10px] bg-slate-900 border border-white/10 text-white rounded shadow-lg animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
        >
          {action.label}
          {action.shortcut && <span className="ml-1.5 text-gray-500">{action.shortcut}</span>}
          <Tooltip.Arrow className="fill-gray-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
