import { useActionRegistry } from '../content'
import type { Content, SmartAction } from '../content'

interface ClipActionsProps {
  content: Content | null
}

export const ClipActions = ({ content }: ClipActionsProps) => {
  const { getActionsForContent } = useActionRegistry()

  if (!content) return null

  const actions = getActionsForContent(content)

  if (actions.length === 0) return null

  return (
    <div className="flex flex-col gap-4 animate-slide-up-fade">
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {actions.map((action, index) => (
          <ActionCard key={action.id} action={action} content={content} index={index} />
        ))}
      </div>
    </div>
  )
}

const ActionCard = ({
  action,
  content,
  index,
}: {
  action: SmartAction
  content: Content
  index: number
}) => (
  <button
    onClick={() => void action.execute(content)}
    className="group relative flex flex-col items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/5 p-3 transition-all duration-200 hover:border-white/10 hover:bg-white/10 hover:shadow-lg hover:shadow-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-400 hover:text-gray-100"
    style={{ animationDelay: `${index * 50}ms` }}
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/20 shadow-inner transition-transform group-hover:scale-110 text-gray-400 group-hover:text-blue-400">
      {action.icon}
    </div>
    <span className="text-xs font-medium">{action.label}</span>
    {action.shortcut && (
      <kbd className="absolute right-2 top-2 hidden rounded bg-black/20 px-1 py-0.5 text-[10px] text-gray-500 group-hover:block opacity-0 group-hover:opacity-100 transition-opacity">
        {action.shortcut}
      </kbd>
    )}
  </button>
)
