import { invoke } from '@tauri-apps/api/core'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Check,
  Copy,
  Database,
  ExternalLink,
  Mail,
  Phone,
  Pin,
  PenLine,
  Star,
  Trash2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipPresentation } from '../../shared/types/v2'
import { useClipboardStore } from '../../stores/clipboardStore'
import { formatShortcut, getPlatform, type ShortcutDef } from '../../shared/keyboard/shortcuts'
import type { TransformControls } from './useTransformState'
import { useToast } from '../../shared/contexts/ToastContext'

const platform = getPlatform()

export interface PresentationActionContext {
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleFavorite: (id: string) => void
  onShowInspector?: () => void
}

type ToolbarAction = {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
  activeColor?: string
  shortcut?: ShortcutDef
  separator?: boolean
  run: () => Promise<void> | void
}

const scalar = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null

const editorExtension = (presentation: ClipPresentation): string | null => {
  const { model } = presentation
  if (model.kind === 'code') {
    const language = model.language?.toLowerCase()
    return (
      (
        { javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs', json: 'json' } as Record<
          string,
          string
        >
      )[language ?? ''] ??
      language ??
      'txt'
    )
  }
  if (model.kind === 'markdown') return 'md'
  if (model.kind === 'tree') return 'json'
  if (model.kind === 'table') return 'csv'
  if (['text', 'rich_text', 'semantic'].includes(model.kind)) return 'txt'
  return null
}

export const ClipActionsToolbar = ({
  presentation,
  context,
  transformControls,
}: {
  presentation: ClipPresentation
  context: PresentationActionContext
  transformControls?: TransformControls | null
}) => {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()
  const { t } = useTranslation()
  const performCopy = useClipboardStore(state => state.performCopy)
  const actions = useMemo<ToolbarAction[]>(() => {
    const values: ToolbarAction[] = [
      {
        id: 'copy',
        label: copied ? 'Copied!' : 'Copy',
        icon: copied ? Check : Copy,
        active: copied,
        activeColor:
          'bg-emerald-500/20 text-emerald-600 ring-1 ring-emerald-500/40 dark:text-emerald-400 dark:bg-emerald-500/15',
        shortcut: { modifiers: ['primary'], key: 'C' },
        run: async () => {
          try {
            await performCopy('', presentation.id)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          } catch (error) {
            toast({
              title: t('common.error'),
              description: String(error),
              type: 'error',
            })
          }
        },
      },
    ]
    const extension = editorExtension(presentation)
    if (extension) {
      values.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: PenLine,
        run: () => invoke('open_clip_text_in_editor', { clipId: presentation.id, extension }),
      })
    }
    if (presentation.model.kind === 'semantic') {
      const semantic = presentation.model
      const payload = semantic.payload
      const kind = presentation.activeView.presentationKind
      if (kind === 'url') {
        const url = scalar(payload['href']) ?? semantic.text
        values.push({
          id: 'open-url',
          label: 'Open Link',
          icon: ExternalLink,
          run: () => invoke('open_external_url', { url }),
        })
      } else if (kind === 'email') {
        const address = scalar(payload['address']) ?? semantic.text
        values.push({
          id: 'compose-email',
          label: 'Compose Email',
          icon: Mail,
          run: () => invoke('compose_email', { address }),
        })
      } else if (kind === 'phone') {
        values.push({
          id: 'call-phone',
          label: 'Call',
          icon: Phone,
          run: () => invoke('start_phone_action', { number: semantic.text, message: false }),
        })
      }
    }
    if (context.onShowInspector) {
      values.push({
        id: 'inspector',
        label: 'Representations',
        icon: Database,
        run: () => context.onShowInspector?.(),
      })
    }
    values.push(
      {
        id: 'favorite',
        label: 'Favorite',
        icon: Star,
        active: presentation.isFavorite,
        activeColor: 'bg-amber-500/10 text-amber-500 dark:text-amber-400',
        shortcut: { modifiers: ['primary'], key: 'F' },
        separator: true,
        run: () => context.onToggleFavorite(presentation.id),
      },
      {
        id: 'pin',
        label: 'Pin',
        icon: Pin,
        active: presentation.isPinned,
        activeColor: 'bg-amber-500/10 text-amber-500 dark:text-amber-400',
        shortcut: { modifiers: ['primary'], key: 'P' },
        run: () => context.onTogglePin(presentation.id),
      },
      { id: 'delete', label: 'Delete', icon: Trash2, run: () => context.onDelete(presentation.id) }
    )
    return values
  }, [context, copied, performCopy, presentation, t, toast])

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {actions.map(action => (
          <>
            {action.separator && (
              <div
                key={`sep-${action.id}`}
                className="mx-0.5 h-3.5 w-px bg-slate-300/60 dark:bg-white/10"
              />
            )}
            <ActionButton action={action} key={action.id} />
          </>
        ))}
        {transformControls && transformControls.items.length > 0 && (
          <TransformDropdown controls={transformControls} />
        )}
      </div>
    </Tooltip.Provider>
  )
}

const ActionButton = ({ action }: { action: ToolbarAction }) => {
  const Icon = action.icon
  const shortcutLabel = action.shortcut ? formatShortcut(action.shortcut, platform) : null
  const activeClass = action.active
    ? (action.activeColor ?? 'bg-amber-500/10 text-amber-500 dark:text-amber-400')
    : 'text-gray-500 hover:bg-slate-200/60 dark:hover:bg-white/10'
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          aria-label={action.label}
          className={`rounded-md p-1.5 transition-all duration-150 ${activeClass} ${action.active ? 'scale-110' : ''}`}
          onClick={() => void action.run()}
        >
          <Icon
            className={`h-4 w-4 ${action.id === 'favorite' && action.active ? 'fill-amber-500' : ''} ${action.id === 'copy' && action.active ? 'stroke-[2.5]' : ''}`}
          />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-100 flex items-center gap-1.5 rounded bg-white/95 px-2 py-1 text-[10px] text-gray-900 shadow dark:bg-slate-900/95 dark:text-white"
          sideOffset={5}
        >
          {action.label}
          {shortcutLabel && (
            <span className="rounded border border-gray-300/60 px-1 font-mono text-gray-400 dark:border-white/20">
              {shortcutLabel}
            </span>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

const TransformDropdown = ({ controls }: { controls: TransformControls }) => (
  <Tooltip.Root>
    <DropdownMenu.Root>
      <Tooltip.Trigger asChild>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Transform"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-slate-200/60 dark:hover:bg-white/10"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[160px] rounded-lg border border-slate-200/60 bg-white/95 py-1 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/95"
          sideOffset={6}
          align="end"
        >
          {controls.items.map(item => (
            <DropdownMenu.Item
              key={item.id}
              className="flex cursor-pointer select-none items-center px-3 py-1.5 text-sm text-gray-700 outline-none hover:bg-slate-100 dark:text-gray-300 dark:hover:bg-white/10"
              onSelect={() => void controls.run(item.id)}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <Tooltip.Portal>
      <Tooltip.Content
        className="z-100 rounded bg-white/95 px-2 py-1 text-[10px] text-gray-900 shadow dark:bg-slate-900/95 dark:text-white"
        sideOffset={5}
      >
        Transform
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
)
