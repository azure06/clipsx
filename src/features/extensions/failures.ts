type FailureDescription = {
  message: string
  action?: 'generation' | 'permissions'
}

const unknownFailure: FailureDescription = {
  message: 'The operation failed for an unknown reason.',
}

const reasons: Record<string, FailureDescription> = {
  input_limit: {
    message: 'The input exceeds the supported request size. Shorten it and try again.',
  },
  context_overflow: {
    message:
      'The model reported insufficient context. Shorten the input or choose a model with a larger context.',
    action: 'generation',
  },
  provider_not_configured: {
    message: 'Local Text Generation is not configured.',
    action: 'generation',
  },
  provider_disabled: { message: 'Local Text Generation is disabled.', action: 'generation' },
  provider_configuration: {
    message: 'The text generation configuration is invalid.',
    action: 'generation',
  },
  model_unavailable: {
    message: 'The selected model is unavailable. Check or install it.',
    action: 'generation',
  },
  connection_unavailable: {
    message: 'ClipsX cannot reach the model provider. Check that Ollama is running.',
    action: 'generation',
  },
  provider_timeout: {
    message: 'The model provider did not finish within the allowed time. Try shorter input.',
  },
  provider_rate_limited: { message: 'The model provider is temporarily limiting requests.' },
  provider_server_error: { message: 'The model provider reported a temporary server error.' },
  provider_rejected: {
    message: 'The model provider rejected the request. Its reason was not recognized.',
  },
  invalid_response: { message: 'The model provider returned an invalid or incomplete response.' },
  invalid_output: { message: 'The extension returned output that ClipsX cannot use.' },
  permission_required: {
    message: 'A required extension permission is missing or was revoked.',
    action: 'permissions',
  },
  unsupported_input: { message: 'This operation does not support the selected input.' },
  invalid_input: { message: 'The selected input is not valid for this operation.' },
  invalid_parameters: {
    message: 'The operation parameters are invalid. Review its configuration.',
  },
  extension_failed: { message: 'The extension could not complete this operation.' },
  extension_timeout: { message: 'The extension exceeded its execution deadline.' },
  resource_limit: { message: 'The extension exceeded a host resource limit.' },
  extension_trap: { message: 'The extension stopped unexpectedly during execution.' },
  extension_failed_after_output_limit: {
    message:
      'The extension could not complete after the model reached its output limit. Try shorter input.',
  },
  provider_cancelled: { message: 'Generation was cancelled.' },
  user_cancelled: { message: 'You cancelled this operation.' },
  stale_context: {
    message: 'The source or authorization changed, so this operation was cancelled.',
  },
  extension_updated: {
    message: 'The extension was updated. Start a new run with the current version.',
  },
  extension_disabled: { message: 'The extension was disabled.' },
  extension_uninstalled: { message: 'The extension was removed.' },
  interrupted_too_often: { message: 'This operation was interrupted by repeated app restarts.' },
  restart_recovery: { message: 'ClipsX is recovering this operation after a restart.' },
  provider_unavailable: {
    message: 'The generation provider is unavailable. Review Local Text Generation.',
    action: 'generation',
  },
  provider_retry: {
    message: 'The generation provider encountered a temporary problem. A retry is scheduled.',
  },
  provider_retries_exhausted: {
    message: 'Generation failed after automatic retries. The original reason was not recorded.',
  },
  execution_failed: {
    message: 'The operation failed. This older result did not record a specific reason.',
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
