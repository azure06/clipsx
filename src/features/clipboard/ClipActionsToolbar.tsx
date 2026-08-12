import { invoke } from '@tauri-apps/api/core'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Check,
  Copy,
  ExternalLink,
  Mail,
  Phone,
  Pin,
  SquareArrowOutUpRight,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ClipPresentation } from '../../shared/types/v2'
import { useClipboardStore } from '../../stores/clipboardStore'
import { formatShortcut, getPlatform, type ShortcutDef } from '../../shared/keyboard/shortcuts'

const platform = getPlatform()

export interface PresentationActionContext {
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleFavorite: (id: string) => void
}

type ToolbarAction = {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
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
}: {
  presentation: ClipPresentation
  context: PresentationActionContext
}) => {
  const [copied, setCopied] = useState(false)
  const performCopy = useClipboardStore(state => state.performCopy)
  const actions = useMemo<ToolbarAction[]>(() => {
    const values: ToolbarAction[] = [
      {
        id: 'copy',
        label: copied ? 'Copied!' : 'Copy',
        icon: copied ? Check : Copy,
        shortcut: { modifiers: ['primary'], key: 'C' },
        run: async () => {
          await performCopy('', presentation.id)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        },
      },
    ]
    const extension = editorExtension(presentation)
    if (extension) {
      values.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: SquareArrowOutUpRight,
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
    values.push(
      {
        id: 'favorite',
        label: 'Favorite',
        icon: Star,
        active: presentation.isFavorite,
        shortcut: { modifiers: ['primary'], key: 'F' },
        separator: true,
        run: () => context.onToggleFavorite(presentation.id),
      },
      {
        id: 'pin',
        label: 'Pin',
        icon: Pin,
        active: presentation.isPinned,
        shortcut: { modifiers: ['primary'], key: 'P' },
        run: () => context.onTogglePin(presentation.id),
      },
      { id: 'delete', label: 'Delete', icon: Trash2, run: () => context.onDelete(presentation.id) }
    )
    return values
  }, [context, copied, performCopy, presentation])

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
      </div>
    </Tooltip.Provider>
  )
}

const ActionButton = ({ action }: { action: ToolbarAction }) => {
  const Icon = action.icon
  const shortcutLabel = action.shortcut ? formatShortcut(action.shortcut, platform) : null
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          aria-label={action.label}
          className={`rounded-md p-1.5 transition-colors ${action.active ? 'bg-amber-500/10 text-amber-500 dark:text-amber-400' : 'text-gray-500 hover:bg-slate-200/60 dark:hover:bg-white/10'}`}
          onClick={() => void action.run()}
        >
          <Icon
            className={`h-4 w-4 ${action.id === 'favorite' && action.active ? 'fill-amber-500' : ''}`}
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
