import { useMemo } from 'react'
import type { Content, SmartAction, ActionContext } from '../types'

// Core Actions
import { useCopyAction } from './shared/CopyAction'
import { useCopyAsPlainTextAction } from './shared/CopyAsPlainTextAction'
import { useDeleteAction } from './shared/DeleteAction'
import { useFavoriteAction } from './shared/FavoriteAction'
import { usePinAction } from './shared/PinAction'
import { useOpenInDefaultEditorAction } from './shared/OpenInDefaultEditorAction'

// Type-Specific Actions
import {
  useOpenURLAction,
  useSearchURLAction,
  useCopyDomainAction,
} from './type-specific/URLActions'
import { useSendEmailAction } from './type-specific/EmailActions'

import { useFormatCodeAction } from './type-specific/CodeActions'

// New Actions
import { useCopyResultAction } from './type-specific/MathActions'
import { useCallPhoneAction, useSmsAction } from './type-specific/PhoneActions'
import { useCopyIsoDateAction, useCopyTimestampAction } from './type-specific/DateActions'
import { useCsvToJsonAction, useCsvToMarkdownAction } from './type-specific/CSVActions'
import { useRevealSecretAction } from './type-specific/SecretActions'

export const useActionRegistry = (context?: ActionContext) => {
  // 1. Initialize all action hooks
  // Core
  const copyAction = useCopyAction()
  const copyPlainText = useCopyAsPlainTextAction()
  const deleteAction = useDeleteAction(context?.onDelete)
  const favoriteAction = useFavoriteAction(context?.onToggleFavorite)
  const pinAction = usePinAction(context?.onTogglePin)
  const openDefaultEditor = useOpenInDefaultEditorAction()

  // Type Specific
  const openUrl = useOpenURLAction()
  const searchUrl = useSearchURLAction()
  const copyDomain = useCopyDomainAction()

  const sendEmail = useSendEmailAction()

  const formatCode = useFormatCodeAction()

  const copyMathResult = useCopyResultAction()

  const callPhone = useCallPhoneAction()
  const sms = useSmsAction()

  const copyIsoDate = useCopyIsoDateAction()
  const copyTimestamp = useCopyTimestampAction()

  const csvToJson = useCsvToJsonAction()
  const csvToMd = useCsvToMarkdownAction()

  const revealSecret = useRevealSecretAction()

  // 2. Define the master list of all available actions
  const allActions: SmartAction[] = useMemo(
    () => [
      // 1. Primary Copy (Result/Formatted)
      copyMathResult, // Math result takes precedence if it exists
      copyAction, // Standard copy

      // 2. Secondary Copy
      copyPlainText, // Explicit plain text copy

      // 3. Open / External
      openUrl,
      openDefaultEditor, // Generic open action

      // 4. Specific Actions
      searchUrl,
      sendEmail,
      callPhone,
      sms,

      // 5. Transforms & Utilities
      copyDomain,
      copyIsoDate,
      copyTimestamp,
      csvToJson,
      csvToMd,
      formatCode,
      revealSecret,

      favoriteAction,
      pinAction,
      deleteAction,
    ],
    [
      openUrl,
      searchUrl,
      sendEmail,
      callPhone,
      sms,
      copyMathResult,
      csvToJson,
      csvToMd,
      formatCode,
      copyDomain,
      copyIsoDate,
      copyTimestamp,
      revealSecret,
      openDefaultEditor,
      copyPlainText,
      copyAction,
      favoriteAction,
      pinAction,
      deleteAction,
    ]
  )

  // 3. Helper to get actions for specific content
  const getActionsForContent = (content: Content | null): SmartAction[] => {
    if (!content) return []
    return allActions.filter(action => action.check(content))
  }

  return {
    getActionsForContent,
    allActions,
  }
}
