import { useMemo } from 'react'
import type { Content, SmartAction, ActionContext, ActionPlacement } from '../types'
import { getPlacementForAction } from '../presentationSpec'
import { useSettingsStore } from '../../../stores/settingsStore'

// Core Actions
import { useCopyAction } from './shared/CopyAction'
import { usePasteAction } from './shared/PasteAction'
import { useDeleteAction } from './shared/DeleteAction'
import { useFavoriteAction } from './shared/FavoriteAction'
import { usePinAction } from './shared/PinAction'
import { useOpenInDefaultEditorAction } from './shared/OpenInDefaultEditorAction'
import { useGenerateEmbeddingAction } from './shared/GenerateEmbeddingAction'

// Type-Specific Actions
import {
  useOpenURLAction,
  useSearchURLAction,
  useCopyDomainAction,
} from './type-specific/URLActions'
import { useSendEmailAction, useCopyDomainFromEmailAction } from './type-specific/EmailActions'

import { useFormatCodeAction } from './type-specific/CodeActions'

import { useCopyResultAction } from './type-specific/MathActions'
import { useCallPhoneAction, useSmsAction } from './type-specific/PhoneActions'
import { useCopyIsoDateAction, useCopyTimestampAction } from './type-specific/DateActions'
import { useCsvToJsonAction, useCsvToMarkdownAction } from './type-specific/CSVActions'
import { useRevealSecretAction } from './type-specific/SecretActions'

export const useActionRegistry = (context?: ActionContext) => {
  const pasteOnEnter = useSettingsStore(s => s.settings?.paste_on_enter ?? true)

  // Core
  const copyAction = useCopyAction()
  const pasteAction = usePasteAction()
  const deleteAction = useDeleteAction(context?.onDelete)
  const favoriteAction = useFavoriteAction(context?.onToggleFavorite)
  const pinAction = usePinAction(context?.onTogglePin)
  const openDefaultEditor = useOpenInDefaultEditorAction()
  const generateEmbedding = useGenerateEmbeddingAction(
    context?.canGenerateEmbedding ? context.onGenerateEmbedding : undefined
  )

  // Type Specific
  const openUrl = useOpenURLAction()
  const searchUrl = useSearchURLAction()
  const copyDomain = useCopyDomainAction()

  const sendEmail = useSendEmailAction()
  const copyEmailDomain = useCopyDomainFromEmailAction()

  const formatCode = useFormatCodeAction()

  const copyMathResult = useCopyResultAction()

  const callPhone = useCallPhoneAction()
  const sms = useSmsAction()

  const copyIsoDate = useCopyIsoDateAction()
  const copyTimestamp = useCopyTimestampAction()

  const csvToJson = useCsvToJsonAction()
  const csvToMd = useCsvToMarkdownAction()

  const revealSecret = useRevealSecretAction()

  const allActions = useMemo(
    () => [
      pasteOnEnter ? pasteAction : copyAction,
      openDefaultEditor,
      favoriteAction,
      pinAction,
      generateEmbedding,
      deleteAction,
      openUrl,
      searchUrl,
      copyDomain,
      sendEmail,
      copyEmailDomain,
      formatCode,
      copyMathResult,
      callPhone,
      sms,
      copyIsoDate,
      copyTimestamp,
      csvToJson,
      csvToMd,
      revealSecret,
    ],
    [
      pasteOnEnter,
      pasteAction,
      copyAction,
      openDefaultEditor,
      favoriteAction,
      pinAction,
      generateEmbedding,
      deleteAction,
      openUrl,
      searchUrl,
      copyDomain,
      sendEmail,
      copyEmailDomain,
      formatCode,
      copyMathResult,
      callPhone,
      sms,
      copyIsoDate,
      copyTimestamp,
      csvToJson,
      csvToMd,
      revealSecret,
    ]
  )

  const getActionsByPlacement = (
    content: Content | null,
    placement: ActionPlacement
  ): SmartAction[] => {
    if (!content) return []
    return allActions
      .filter(action => action.check(content))
      .filter(action => getPlacementForAction(action.id, content.type) === placement)
  }

  // Returns actions for the global toolbar (global_bar placement only)
  const getGlobalBarActions = (content: Content | null): SmartAction[] =>
    getActionsByPlacement(content, 'global_bar')

  // Returns actions for preview-local menu
  const getPreviewMenuActions = (content: Content | null): SmartAction[] =>
    getActionsByPlacement(content, 'preview_menu')

  // Returns actions for inline preview interaction
  const getPreviewInlineActions = (content: Content | null): SmartAction[] =>
    getActionsByPlacement(content, 'preview_inline')

  // Legacy grouped accessor kept for backwards compatibility
  type ActionGroups = {
    standard: SmartAction[]
    smart: SmartAction[]
    meta: SmartAction[]
  }

  const getActionGroups = (content: Content | null): ActionGroups => {
    const bar = getGlobalBarActions(content)
    const coreIds = new Set(['copy', 'open-default-editor'])
    const metaIds = new Set(['favorite', 'pin', 'core.embeddings.generate', 'delete'])
    return {
      standard: bar.filter(a => coreIds.has(a.id)),
      smart: bar.filter(a => !coreIds.has(a.id) && !metaIds.has(a.id)),
      meta: bar.filter(a => metaIds.has(a.id)),
    }
  }

  const getActionsForContent = (content: Content | null): SmartAction[] =>
    getGlobalBarActions(content)

  return {
    getActionGroups,
    getActionsForContent,
    getGlobalBarActions,
    getPreviewMenuActions,
    getPreviewInlineActions,
    allActions,
  }
}
