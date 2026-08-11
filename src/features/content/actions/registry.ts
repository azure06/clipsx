import { useMemo } from 'react'
import type { Content, SmartAction, ActionContext, ActionPlacement } from '../types'
import { getPlacementForAction } from '../presentationSpec'

// Core Actions
import { useCopyAction } from './shared/CopyAction'
import { useDeleteAction } from './shared/DeleteAction'
import { useFavoriteAction } from './shared/FavoriteAction'
import { usePinAction } from './shared/PinAction'
import { useOpenInDefaultEditorAction } from './shared/OpenInDefaultEditorAction'
import { useVaultAction } from './shared/VaultAction'

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
import { useTranslation } from 'react-i18next'

export const useActionRegistry = (context?: ActionContext) => {
  const { t } = useTranslation()
  // Core
  const copyAction = useCopyAction()
  const deleteAction = useDeleteAction(context?.onDelete)
  const favoriteAction = useFavoriteAction(context?.onToggleFavorite)
  const pinAction = usePinAction(context?.onTogglePin)
  const openDefaultEditor = useOpenInDefaultEditorAction()
  const vaultAction = useVaultAction()

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

  const allActions = useMemo(() => {
    const actions = [
      copyAction,
      openDefaultEditor,
      vaultAction,
      favoriteAction,
      pinAction,
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
    const labels: Record<string, string> = {
      copy: copyAction.label === 'Copied!' ? t('actions.copied') : t('actions.copy'),
      delete: t('actions.delete'),
      favorite: t('actions.favorite'),
      pin: t('actions.pin'),
      'open-default-editor': t('actions.openEditor'),
      paste: t('actions.paste'),
      'csv-to-json': t('actions.csvJson'),
      'csv-to-markdown': t('actions.csvMarkdown'),
      'format-code': t('actions.formatCode'),
      'copy-code': t('actions.copyCode'),
      'download-code': t('actions.downloadFile'),
      'copy-iso-date': t('actions.copyIso'),
      'copy-timestamp': t('actions.copyTimestamp'),
      'send-email': t('actions.composeEmail'),
      'copy-email': t('actions.copyAddress'),
      'copy-email-domain': t('actions.copyDomain'),
      'copy-math-result': t('actions.copyResult'),
      'copy-equation': t('actions.copyEquation'),
      'call-phone': t('actions.call'),
      'sms-phone': t('actions.sendSms'),
      'reveal-secret': t('actions.reveal'),
      'open-url': t('actions.openLink'),
      'search-url': t('actions.searchDomain'),
      'copy-domain': t('actions.copyDomain'),
    }
    return actions.map(action => ({ ...action, label: labels[action.id] ?? action.label }))
  }, [
    copyAction,
    openDefaultEditor,
    vaultAction,
    favoriteAction,
    pinAction,
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
    t,
  ])

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
    const metaIds = new Set(['favorite', 'pin', 'delete'])
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
