import type { TFunction } from 'i18next'

export function connectionFailureMessage(failure: unknown, t: TFunction): string {
  const value = typeof failure === 'object' && failure !== null ? failure : {}
  const code = 'code' in value && typeof value.code === 'string' ? value.code : ''
  const status =
    'status' in value &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599
      ? value.status
      : null
  const reason = 'reason' in value && typeof value.reason === 'string' ? value.reason : ''
  const explanation = t(`modelsWorkspace.failures.${code}`, { defaultValue: t('aiConfig.error') })
  const httpStatus = status === null ? '' : `HTTP ${status}. `
  const providerReason = reason
    ? t(`modelsWorkspace.providerReasons.${reason}`, { defaultValue: '' })
    : ''
  return `${httpStatus}${providerReason || explanation}`
}
