import i18n from '../../i18n/index'
type FailureDescription = {
  message: string
  action?: 'generation' | 'permissions'
}

const unknownFailure: FailureDescription = {
  get message() {
    return i18n.t('desktopUi.theOperationFailedForAnUnknownReason')
  },
}

const reasons: Record<string, FailureDescription> = {
  input_limit: {
    get message() {
      return i18n.t('desktopUi.theInputExceedsTheSupportedRequestSizeShortenIt')
    },
  },
  context_overflow: {
    get message() {
      return i18n.t('desktopUi.theModelReportedInsufficientContextShortenTheInputOr')
    },
    action: 'generation',
  },
  provider_not_configured: {
    get message() {
      return i18n.t('desktopUi.localTextGenerationIsNotConfigured')
    },
    action: 'generation',
  },
  provider_disabled: {
    get message() {
      return i18n.t('desktopUi.localTextGenerationIsDisabled')
    },
    action: 'generation',
  },
  provider_configuration: {
    get message() {
      return i18n.t('desktopUi.theTextGenerationConfigurationIsInvalid')
    },
    action: 'generation',
  },
  model_unavailable: {
    get message() {
      return i18n.t('desktopUi.theSelectedModelIsUnavailableCheckOrInstallIt')
    },
    action: 'generation',
  },
  connection_unavailable: {
    get message() {
      return i18n.t('desktopUi.clipsxCannotReachTheModelProviderCheckThatOllama')
    },
    action: 'generation',
  },
  provider_timeout: {
    get message() {
      return i18n.t('desktopUi.theModelProviderDidNotFinishWithinTheAllowed')
    },
  },
  provider_rate_limited: {
    get message() {
      return i18n.t('desktopUi.theModelProviderIsTemporarilyLimitingRequests')
    },
  },
  provider_server_error: {
    get message() {
      return i18n.t('desktopUi.theModelProviderReportedATemporaryServerError')
    },
  },
  provider_rejected: {
    get message() {
      return i18n.t('desktopUi.theModelProviderRejectedTheRequestItsReasonWas')
    },
  },
  invalid_response: {
    get message() {
      return i18n.t('desktopUi.theModelProviderReturnedAnInvalidOrIncompleteResponse')
    },
  },
  invalid_output: {
    get message() {
      return i18n.t('desktopUi.theExtensionReturnedOutputThatClipsxCannotUse')
    },
  },
  permission_required: {
    get message() {
      return i18n.t('desktopUi.aRequiredExtensionPermissionIsMissingOrWasRevoked')
    },
    action: 'permissions',
  },
  unsupported_input: {
    get message() {
      return i18n.t('desktopUi.thisOperationDoesNotSupportTheSelectedInput')
    },
  },
  invalid_input: {
    get message() {
      return i18n.t('desktopUi.theSelectedInputIsNotValidForThisOperation')
    },
  },
  invalid_parameters: {
    get message() {
      return i18n.t('desktopUi.theOperationParametersAreInvalidReviewItsConfiguration')
    },
  },
  extension_failed: {
    get message() {
      return i18n.t('desktopUi.theExtensionCouldNotCompleteThisOperation')
    },
  },
  extension_timeout: {
    get message() {
      return i18n.t('desktopUi.theExtensionExceededItsExecutionDeadline')
    },
  },
  resource_limit: {
    get message() {
      return i18n.t('desktopUi.theExtensionExceededAHostResourceLimit')
    },
  },
  extension_trap: {
    get message() {
      return i18n.t('desktopUi.theExtensionStoppedUnexpectedlyDuringExecution')
    },
  },
  extension_failed_after_output_limit: {
    get message() {
      return i18n.t('desktopUi.theExtensionCouldNotCompleteAfterTheModelReached')
    },
  },
  provider_cancelled: {
    get message() {
      return i18n.t('desktopUi.generationWasCancelled')
    },
  },
  user_cancelled: {
    get message() {
      return i18n.t('desktopUi.youCancelledThisOperation')
    },
  },
  stale_context: {
    get message() {
      return i18n.t('desktopUi.theSourceOrAuthorizationChangedSoThisOperationWas')
    },
  },
  extension_updated: {
    get message() {
      return i18n.t('desktopUi.theExtensionWasUpdatedStartANewRunWith')
    },
  },
  extension_disabled: {
    get message() {
      return i18n.t('desktopUi.theExtensionWasDisabled')
    },
  },
  extension_uninstalled: {
    get message() {
      return i18n.t('desktopUi.theExtensionWasRemoved')
    },
  },
  interrupted_too_often: {
    get message() {
      return i18n.t('desktopUi.thisOperationWasInterruptedByRepeatedAppRestarts')
    },
  },
  restart_recovery: {
    get message() {
      return i18n.t('desktopUi.clipsxIsRecoveringThisOperationAfterARestart')
    },
  },
  provider_unavailable: {
    get message() {
      return i18n.t('desktopUi.theGenerationProviderIsUnavailableReviewLocalTextGeneration')
    },
    action: 'generation',
  },
  provider_retry: {
    get message() {
      return i18n.t('desktopUi.theGenerationProviderEncounteredATemporaryProblemARetry')
    },
  },
  provider_retries_exhausted: {
    get message() {
      return i18n.t('desktopUi.generationFailedAfterAutomaticRetriesTheOriginalReasonWas')
    },
  },
  execution_failed: {
    get message() {
      return i18n.t('desktopUi.theOperationFailedThisOlderResultDidNotRecord')
    },
  },
  unknown_failure: unknownFailure,
}

export function describeFailure(reason: string | null): FailureDescription {
  const exhausted = reason?.startsWith('retry_exhausted:') ?? false
  const code = exhausted ? reason!.slice('retry_exhausted:'.length) : reason
  const description =
    (code && Object.hasOwn(reasons, code) ? reasons[code] : null) ?? unknownFailure
  return exhausted
    ? { ...description, message: `${description.message} Automatic retries were exhausted.` }
    : description
}

// IPC errors are structured host failures. Never render arbitrary error strings or bodies.
export function failureCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(reasons, error.code)
  )
    return error.code
  return 'unknown_failure'
}

export function failureMessage(error: unknown): string {
  return describeFailure(failureCode(error)).message
}
