import { useActionRegistry } from '../content'
import type { Content, SmartAction, ActionContext } from '../content'
import * as Tooltip from '@radix-ui/react-tooltip'

interface ClipActionsToolbarProps {
  content: Content
  context?: ActionContext
}

export const ClipActionsToolbar = ({ content, context }: ClipActionsToolbarProps) => {
  const { getActionsForContent } = useActionRegistry(context)

  if (!content) return null

  // Get top 3 actions for toolbar to keep it minimal
  const actions = getActionsForContent(content).slice(0, 3)

  if (actions.length === 0) return null

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {actions.map(action => (
          <ActionIconButton key={action.id} action={action} content={content} />
        ))}
      </div>
    </Tooltip.Provider>
  )
}

const ActionIconButton = ({ action, content }: { action: SmartAction; content: Content }) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button
        onClick={() => void action.execute(content)}
        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500/50"
      >
        <div className="w-4 h-4">{action.icon}</div>
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        className="z-[100] px-2 py-1 text-[10px] bg-gray-900 border border-white/10 text-white rounded shadow-lg animate-in fade-in-0 zoom-in-95"
        sideOffset={5}
      >
        {action.label}
        {action.shortcut && <span className="ml-1.5 text-gray-500">{action.shortcut}</span>}
        <Tooltip.Arrow className="fill-gray-900" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
)
