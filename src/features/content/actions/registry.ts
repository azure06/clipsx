import { useMemo } from 'react'
import type { Content, SmartAction } from '../types'

// Core Actions
import { useCopyAction } from './shared/CopyAction'

// Type-Specific Actions
import {
  useOpenURLAction,
  useSearchURLAction,
  useCopyDomainAction,
} from './type-specific/URLActions'
import { useSendEmailAction } from './type-specific/EmailActions'
import { useCopyHexAction, useCopyRGBAction } from './type-specific/ColorActions'
import { useFormatCodeAction } from './type-specific/CodeActions'

// New Actions
import { useCalculateAction } from './type-specific/MathActions'
import { useCallPhoneAction, useSmsAction } from './type-specific/PhoneActions'
import { useCopyIsoDateAction, useCopyTimestampAction } from './type-specific/DateActions'
import { useCsvToJsonAction, useCsvToMarkdownAction } from './type-specific/CSVActions'
import { useRevealSecretAction } from './type-specific/SecretActions'

export const useActionRegistry = () => {
  // 1. Initialize all action hooks
  // Core
  const copyAction = useCopyAction()
  // const deleteAction = useDeleteAction() // TODO: Implement delete logic
  // const favoriteAction = useFavoriteAction() // TODO: Implement favorite logic

  // Type Specific
  const openUrl = useOpenURLAction()
  const searchUrl = useSearchURLAction()
  const copyDomain = useCopyDomainAction()

  const sendEmail = useSendEmailAction()

  const copyHex = useCopyHexAction()
  const copyRgb = useCopyRGBAction()

  const formatCode = useFormatCodeAction()

  const calculate = useCalculateAction()

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
      calculate,

      // Data Transforms
      csvToJson,
      csvToMd,
      formatCode,

      // Copy Utilities
      copyDomain,
      copyHex,
      copyRgb,
      copyIsoDate,
      copyTimestamp,

      // Secrets
      revealSecret,

      // Core (fallback/always available)
      copyAction,
      // favoriteAction,
      // deleteAction
    ],
    [
      openUrl,
      searchUrl,
      sendEmail,
      callPhone,
      sms,
      calculate,
      csvToJson,
      csvToMd,
      formatCode,
      copyDomain,
      copyHex,
      copyRgb,
      copyIsoDate,
      copyTimestamp,
      revealSecret,
      copyAction,
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
