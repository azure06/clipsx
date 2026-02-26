import { useMemo } from 'react'
import type { Content, SmartAction, ActionContext } from '../types'

// Core Actions
import { useCopyAction } from './shared/CopyAction'
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
  // Group 1: Standard Actions (Copy, Open)
  const standardActions = useMemo(
    () => [copyAction, openDefaultEditor],
    [copyAction, openDefaultEditor]
  )

  // Group 2: Meta Actions (Fav, Pin, Delete)
  const metaActions = useMemo(
    () => [favoriteAction, pinAction, deleteAction],
    [favoriteAction, pinAction, deleteAction]
  )

  // Group 3: Smart Actions (Type-specific)
  const smartActions = useMemo(
    () => [
      // Primary Copy (Result/Formatted)
      copyMathResult, // Math result takes precedence if it exists

      // Open / External
      openUrl,

      // Specific Actions
      searchUrl,
      sendEmail,
      callPhone,
      sms,

      // Transforms & Utilities
      copyDomain,
      copyIsoDate,
      copyTimestamp,
      csvToJson,
      csvToMd,
      formatCode,
      revealSecret,
    ],
    [
      copyMathResult,
      openUrl,
      searchUrl,
      sendEmail,
      callPhone,
      sms,
      copyDomain,
      copyIsoDate,
      copyTimestamp,
      csvToJson,
      csvToMd,
      formatCode,
      revealSecret,
    ]
  )

  const allActions = useMemo(
    () => [...standardActions, ...smartActions, ...metaActions],
    [standardActions, smartActions, metaActions]
  )

  // Helper types for grouped return
  type ActionGroups = {
    standard: SmartAction[]
    smart: SmartAction[]
    meta: SmartAction[]
  }

  // 3. Helper to get actions for specific content
  // Returns grouped actions
  const getActionGroups = (content: Content | null): ActionGroups => {
    if (!content) return { standard: [], smart: [], meta: [] }

    return {
      standard: standardActions.filter(action => action.check(content)),
      smart: smartActions.filter(action => action.check(content)),
      meta: metaActions.filter(action => action.check(content)),
    }
  }

  // Legacy helper for flat list (if needed elsewhere)
  const getActionsForContent = (content: Content | null): SmartAction[] => {
    const groups = getActionGroups(content)
    return [...groups.standard, ...groups.smart, ...groups.meta]
  }

  return {
    getActionGroups,
    getActionsForContent,
    allActions,
  }
}
