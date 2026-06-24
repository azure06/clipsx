import type { ContentType, ActionPlacement } from './types'

export type PreviewInteractionMode = 'read_only' | 'inline_primary' | 'tabs'

export type ContentPresentationSpec = {
  readonly type: ContentType
  readonly interactionMode: PreviewInteractionMode
  readonly globalBarActions: readonly string[]
  readonly previewMenuActions: readonly string[]
  readonly previewInlineActions: readonly string[]
  readonly hiddenActions: readonly string[]
}

const GLOBAL_BAR_BASE = ['copy', 'favorite', 'pin', 'core.embeddings.generate', 'delete'] as const
const OPEN_IN_EDITOR = 'open-default-editor'

const SPECS: readonly ContentPresentationSpec[] = [
  {
    type: 'text',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE, OPEN_IN_EDITOR],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'url',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: ['search-url'],
    previewInlineActions: ['copy-domain'],
    hiddenActions: ['open-url'],
  },
  {
    type: 'email',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: ['copy-email-domain'],
    hiddenActions: ['send-email', 'copy-email'],
  },
  {
    type: 'color',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'code',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE, OPEN_IN_EDITOR],
    previewMenuActions: ['format-code'],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'json',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE, OPEN_IN_EDITOR],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'csv',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: ['csv-to-json', 'csv-to-markdown'],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'math',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: ['copy-math-result'],
    hiddenActions: ['copy-math-result'],
  },
  {
    type: 'image',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE, OPEN_IN_EDITOR],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'files',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'office',
    interactionMode: 'tabs',
    globalBarActions: [...GLOBAL_BAR_BASE, OPEN_IN_EDITOR],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'phone',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: ['call-phone', 'sms-phone'],
    hiddenActions: ['call-phone', 'sms-phone'],
  },
  {
    type: 'date',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: ['copy-iso-date', 'copy-timestamp'],
    hiddenActions: ['copy-iso-date', 'copy-timestamp'],
  },
  {
    type: 'timestamp',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: ['copy-iso-date'],
    hiddenActions: ['copy-iso-date', 'copy-timestamp'],
  },
  {
    type: 'path',
    interactionMode: 'inline_primary',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: ['open-path'],
    hiddenActions: [],
  },
  {
    type: 'jwt',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: [],
  },
  {
    type: 'secret',
    interactionMode: 'read_only',
    globalBarActions: [...GLOBAL_BAR_BASE],
    previewMenuActions: [],
    previewInlineActions: [],
    hiddenActions: ['reveal-secret'],
  },
]

const SPEC_MAP = new Map<ContentType, ContentPresentationSpec>(SPECS.map(s => [s.type, s]))

export const getPresentationSpec = (type: ContentType): ContentPresentationSpec =>
  SPEC_MAP.get(type) ?? SPECS[0]!

export const getPlacementForAction = (actionId: string, type: ContentType): ActionPlacement => {
  const spec = getPresentationSpec(type)
  if (spec.hiddenActions.includes(actionId)) return 'hidden'
  if (spec.previewInlineActions.includes(actionId)) return 'preview_inline'
  if (spec.previewMenuActions.includes(actionId)) return 'preview_menu'
  if (spec.globalBarActions.includes(actionId)) return 'global_bar'
  return 'hidden'
}
