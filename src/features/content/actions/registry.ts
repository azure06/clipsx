import { useMemo } from 'react'
import type { Content, SmartAction, ActionContext } from '../types'

// Core Actions
import { useCopyAction } from './shared/CopyAction'
import { useDeleteAction } from './shared/DeleteAction'
import { useFavoriteAction } from './shared/FavoriteAction'
import { usePinAction } from './shared/PinAction'

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
  const deleteAction = useDeleteAction(context?.onDelete)
  const favoriteAction = useFavoriteAction(context?.onToggleFavorite)
  const pinAction = usePinAction(context?.onTogglePin)

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
      // Transform/External - High Priority
      openUrl,
      searchUrl,
      sendEmail,
      callPhone,
      sms,
      copyMathResult,

      // Data Transforms
      csvToJson,
      csvToMd,
      formatCode,

      // Copy Utilities
      copyDomain,
      copyIsoDate,
      copyTimestamp,

      // Secrets
      revealSecret,

      // Core (fallback/always available)
      copyAction,
      favoriteAction,
      pinAction,
      deleteAction
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
      copyAction,
      favoriteAction,
      pinAction,
      deleteAction
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
