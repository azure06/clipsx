import { invoke } from '@tauri-apps/api/core'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Blocks,
  Braces,
  Check,
  Code2,
  Copy,
  ClipboardType,
  Database,
  ExternalLink,
  File,
  Globe2,
  Hash,
  KeyRound,
  Link,
  Mail,
  Palette,
  Phone,
  Pin,
  PenLine,
  Star,
  Share2,
  Table2,
  Terminal,
  Text,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipPresentation } from '../../shared/types/v2'
import { useClipboardStore } from '../../stores/clipboardStore'
import {
  formatShortcut,
  getDeleteShortcut,
  getPlatform,
  type ShortcutDef,
} from '../../shared/keyboard/shortcuts'
import { useToast } from '../../shared/contexts/ToastContext'
import { copyClipboardOutput } from '../../shared/clipboardOutput'

const platform = getPlatform()
const representationsShortcut: ShortcutDef = { modifiers: ['primary'], key: 'I' }

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
  disabled?: boolean
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

export const ExtensionIcon = ({
  name,
  light,
  dark,
  scale,
}: {
  name: string | null
  light: string | null
  dark: string | null
  scale: number
}) => {
  if (!light) {
    const Icon =
      (
        {
          braces: Braces,
          code: Code2,
          database: Database,
          file: File,
          globe: Globe2,
          hash: Hash,
          key: KeyRound,
          link: Link,
          palette: Palette,
          table: Table2,
          terminal: Terminal,
          text: Text,
        } as Record<string, LucideIcon>
      )[name ?? ''] ?? Blocks
    return <Icon className="h-4 w-4" />
  }
  const style = scale === 1 ? undefined : { transform: `scale(${scale})` }
  if (!dark) return <img src={light} alt="" className="h-4 w-4" style={style} />
  return (
    <>
      <img src={light} alt="" className="h-4 w-4 dark:hidden" style={style} />
      <img src={dark} alt="" className="hidden h-4 w-4 dark:block" style={style} />
    </>
  )
}

export const ClipActionsToolbar = ({
  presentation,
  context,
}: {
  presentation: ClipPresentation
  context: PresentationActionContext
}) => {
  const [copied, setCopied] = useState(false)
  const [plainCopied, setPlainCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const { toast } = useToast()
  const { t } = useTranslation()
  const performCopy = useClipboardStore(state => state.performCopy)
  useEffect(() => {
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ level: string; message: string }>).detail
      if (detail) {
        toast({
          title: 'Extension action',
          description: detail.message,
          type: detail.level === 'error' ? 'error' : 'success',
        })
      }
    }
    window.addEventListener('clipsx-extension-action-notification', onNotification)
    return () => window.removeEventListener('clipsx-extension-action-notification', onNotification)
  }, [toast])
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
    if (presentation.hasPlainText) {
      values.push({
        id: 'copy-plain-text',
        label: plainCopied ? 'Plain text copied!' : 'Copy plain text',
        icon: plainCopied ? Check : ClipboardType,
        active: plainCopied,
        activeColor:
          'bg-emerald-500/20 text-emerald-600 ring-1 ring-emerald-500/40 dark:text-emerald-400 dark:bg-emerald-500/15',
        run: async () => {
          try {
            await copyClipboardOutput({ kind: 'plain_text', clipId: presentation.id })
            setPlainCopied(true)
            window.setTimeout(() => setPlainCopied(false), 2000)
          } catch (error) {
            toast({
              title: t('common.error'),
              description: String(error),
              type: 'error',
            })
          }
        },
      })
    }
    if (presentation.shareable) {
      values.push({
        id: 'share',
        label: sharing ? 'Opening share…' : 'Share',
        icon: Share2,
        disabled: sharing,
        run: async () => {
          if (sharing) return
          setSharing(true)
          try {
            await invoke('share_clip', { clipId: presentation.id })
          } catch (error) {
            toast({
              title: 'Could not share clip',
              description: String(error),
              type: 'error',
            })
          } finally {
            setSharing(false)
          }
        },
      })
    }
    const contentActions: ToolbarAction[] = []
    const extension = editorExtension(presentation)
    if (extension) {
      contentActions.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: PenLine,
        shortcut: { modifiers: ['primary', 'shift'], key: 'O' },
        run: () => invoke('open_clip_text_in_editor', { clipId: presentation.id, extension }),
      })
    }
    if (presentation.model.kind === 'semantic') {
      const semantic = presentation.model
      const payload = semantic.payload
      const kind = presentation.activeView.presentationKind
      if (kind === 'url') {
        const url = scalar(payload['href']) ?? semantic.text
        contentActions.push({
          id: 'open-url',
          label: 'Open Link',
          icon: ExternalLink,
          run: () => invoke('open_external_url', { url }),
        })
      } else if (kind === 'email') {
        const address = scalar(payload['address']) ?? semantic.text
        contentActions.push({
          id: 'compose-email',
          label: 'Compose Email',
          icon: Mail,
          run: () => invoke('compose_email', { address }),
        })
      } else if (kind === 'phone') {
        contentActions.push({
          id: 'call-phone',
          label: 'Call',
          icon: Phone,
          run: () => invoke('start_phone_action', { number: semantic.text, message: false }),
        })
      }
    }
    if (context.onShowInspector) {
      contentActions.push({
        id: 'inspector',
        label: 'Representations',
        icon: Database,
        shortcut: representationsShortcut,
        run: () => context.onShowInspector?.(),
      })
    }
    if (contentActions.length > 0) {
      contentActions[0]!.separator = true
      values.push(...contentActions)
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
        label: 'Pin / Unpin',
        icon: Pin,
        active: presentation.isPinned,
        activeColor: 'bg-amber-500/10 text-amber-500 dark:text-amber-400',
        shortcut: { modifiers: ['primary'], key: 'P' },
        run: () => context.onTogglePin(presentation.id),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash2,
        shortcut: getDeleteShortcut(platform),
        separator: true,
        run: () => context.onDelete(presentation.id),
      }
    )
    return values
  }, [context, copied, performCopy, plainCopied, presentation, sharing, t, toast])
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {actions.map(action => (
          <Fragment key={action.id}>
            {action.separator && (
              <div
                aria-hidden="true"
                data-separator-before={action.id}
                className="mx-0.5 h-3.5 w-px bg-slate-300/60 dark:bg-white/10"
              />
            )}
            <ActionButton action={action} />
          </Fragment>
        ))}
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
          data-action-id={action.id}
          disabled={action.disabled}
          className={`rounded-md p-1.5 transition-all duration-150 disabled:cursor-wait disabled:opacity-50 ${activeClass} ${action.active ? 'scale-110' : ''}`}
          onClick={() => void action.run()}
        >
          <Icon
            className={`h-4 w-4 ${action.id === 'favorite' && action.active ? 'fill-amber-500' : ''} ${action.id === 'copy' && action.active ? 'stroke-[2.5]' : ''}`}
          />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-100 rounded bg-white/95 px-2 py-1 text-[10px] text-gray-900 shadow dark:bg-slate-900/95 dark:text-white"
          sideOffset={5}
        >
          {action.label}
          {shortcutLabel && <span className="ml-1.5 font-mono text-gray-400">{shortcutLabel}</span>}
          <Tooltip.Arrow className="fill-white dark:fill-slate-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
