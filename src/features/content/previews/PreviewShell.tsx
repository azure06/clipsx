import { useState, type ReactNode } from 'react'
import { Copy, Check, MoreHorizontal } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { SmartAction, Content } from '../types'
import { useClipboardStore } from '../../../stores/clipboardStore'

// ────────────────────────────────────────────────
// CopyableRow — a clickable row that copies a value
// ────────────────────────────────────────────────

type CopyableRowProps = {
  readonly label: string
  readonly value: string
  readonly sourceClipId: string
  readonly className?: string
}

export const CopyableRow = ({ label, value, sourceClipId, className = '' }: CopyableRowProps) => {
  const [copied, setCopied] = useState(false)
  const copyDerivedText = useClipboardStore(state => state.copyDerivedText)

  const handleCopy = async () => {
    await copyDerivedText(value, sourceClipId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      onClick={() => void handleCopy()}
      className={`flex items-center justify-between px-3 py-2 rounded-lg bg-slate-100/5 hover:bg-slate-100/10 border border-gray-100/10 cursor-pointer transition-all duration-150 group ${className}`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</span>
        <span className="text-sm font-mono font-medium text-white/90 break-all">{value}</span>
      </div>
      <div className="shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? (
          <Check size={14} className="text-green-400" />
        ) : (
          <Copy size={14} className="text-gray-400" />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// MetaChip — a small non-interactive label
// ────────────────────────────────────────────────

type MetaChipProps = {
  readonly children: ReactNode
  readonly className?: string
}

export const MetaChip = ({ children, className = '' }: MetaChipProps) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-slate-100/5 text-gray-400 border border-gray-100/10 ${className}`}
  >
    {children}
  </span>
)

// ────────────────────────────────────────────────
// PreviewHeader — compact title row with optional menu
// ────────────────────────────────────────────────

type PreviewHeaderProps = {
  readonly icon: ReactNode
  readonly title: string
  readonly meta?: ReactNode
  readonly menuActions?: SmartAction[]
  readonly content?: Content
}

export const PreviewHeader = ({ icon, title, meta, menuActions, content }: PreviewHeaderProps) => {
  const hasMenu = menuActions && menuActions.length > 0 && content

  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="p-1.5 rounded-lg ring-1 ring-white/10">{icon}</div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">
          {title}
        </span>
        {meta && <div className="flex items-center gap-1.5 flex-wrap mt-0.5">{meta}</div>}
      </div>
      {hasMenu && <PreviewLocalMenu actions={menuActions} content={content} />}
    </div>
  )
}

// ────────────────────────────────────────────────
// PreviewLocalMenu — dropdown trigger for preview-menu actions
// ────────────────────────────────────────────────

type PreviewLocalMenuProps = {
  readonly actions: SmartAction[]
  readonly content: Content
}

export const PreviewLocalMenu = ({ actions, content }: PreviewLocalMenuProps) => {
  if (actions.length === 0) return null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-slate-100/10 transition-colors focus:outline-none"
          aria-label="More actions"
        >
          <MoreHorizontal size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[160px] py-1 bg-slate-900 border border-white/10 rounded-lg shadow-xl animate-in fade-in-0 zoom-in-95"
          sideOffset={6}
          align="end"
        >
          {actions.map(action => (
            <DropdownMenu.Item
              key={action.id}
              onSelect={() => void action.execute(content)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-slate-100/10 cursor-pointer outline-none transition-colors"
            >
              <span className="w-4 h-4 flex items-center justify-center text-gray-400">
                {action.icon}
              </span>
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ────────────────────────────────────────────────
// InlineCTAButton — primary CTA inline in preview (e.g. Call, SMS, Open Path)
// ────────────────────────────────────────────────

type InlineCTAButtonProps = {
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly variant?: 'default' | 'primary' | 'danger'
}

export const InlineCTAButton = ({
  icon,
  label,
  onClick,
  variant = 'default',
}: InlineCTAButtonProps) => {
  const variantClass =
    variant === 'primary'
      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30 hover:bg-blue-500/25 hover:text-blue-200'
      : variant === 'danger'
        ? 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25'
        : 'bg-slate-100/5 text-gray-300 border-gray-100/10 hover:bg-slate-100/10 hover:text-white'

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${variantClass}`}
    >
      <span className="w-4 h-4">{icon}</span>
      {label}
    </button>
  )
}
