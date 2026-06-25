import { useState, type ReactNode } from 'react'
import { Copy, Check, MoreHorizontal } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { SmartAction, Content } from '../types'
import { useClipboardStore } from '../../../stores/clipboardStore'
import { cn } from '../../../shared/utils/cn'
import { previewTheme } from './previewTheme'

// ────────────────────────────────────────────────
// CopyableRow — a clickable row that copies a value
// ────────────────────────────────────────────────

type CopyableRowProps = {
  readonly label: string
  readonly value: string
  readonly sourceClipId?: string
  readonly className?: string
}

export const CopyableRow = ({ label, value, className = '' }: CopyableRowProps) => {
  const [copied, setCopied] = useState(false)
  const copyDerivedText = useClipboardStore(state => state.copyDerivedText)

  const handleCopy = async () => {
    await copyDerivedText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      onClick={() => void handleCopy()}
      className={cn(
        'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 group',
        previewTheme.surfaceMuted,
        'hover:bg-slate-100 dark:hover:bg-slate-100/10',
        className
      )}
    >
      <div className="flex flex-col min-w-0">
        <span className={cn('text-[10px] uppercase tracking-wider mb-0.5', previewTheme.textMuted)}>
          {label}
        </span>
        <span className={cn('text-sm font-mono font-medium break-all', previewTheme.textPrimary)}>
          {value}
        </span>
      </div>
      <div className="shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? (
          <Check size={14} className="text-green-400" />
        ) : (
          <Copy size={14} className={previewTheme.textMuted} />
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
    className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider',
      previewTheme.surfaceMuted,
      previewTheme.textMuted,
      className
    )}
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
      <div
        className={cn(
          'p-1.5 rounded-lg ring-1',
          'ring-slate-200/80 dark:ring-white/10 bg-white/50 dark:bg-transparent'
        )}
      >
        {icon}
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className={cn('text-xs font-semibold uppercase tracking-wider', previewTheme.textPrimary)}
        >
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
          className={cn(
            'p-1.5 rounded-md transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500/40',
            previewTheme.iconButton
          )}
          aria-label="More actions"
        >
          <MoreHorizontal size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            'z-50 min-w-[160px] py-1 rounded-lg animate-in fade-in-0 zoom-in-95',
            previewTheme.surfaceElevated
          )}
          sideOffset={6}
          align="end"
        >
          {actions.map(action => (
            <DropdownMenu.Item
              key={action.id}
              onSelect={() => void action.execute(content)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer outline-none transition-colors',
                previewTheme.menuItem
              )}
            >
              <span
                className={cn('w-4 h-4 flex items-center justify-center', previewTheme.textMuted)}
              >
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
      ? 'bg-blue-500/15 text-blue-700 border-blue-500/30 hover:bg-blue-500/20 dark:text-blue-300 dark:hover:bg-blue-500/25 dark:hover:text-blue-200'
      : variant === 'danger'
        ? 'bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/25'
        : 'bg-white/60 text-gray-700 border-slate-200/80 hover:bg-slate-100 dark:bg-slate-100/5 dark:text-gray-300 dark:border-gray-100/10 dark:hover:bg-slate-100/10 dark:hover:text-white'

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
