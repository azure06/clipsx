import { describe, expect, it } from 'vitest'
import { describeFailure, failureMessage } from './failures'
import { jobStatusLabel } from '../clipboard/ExtensionJobStatus'

describe('safe operation failures', () => {
  it('preserves the specific reason after retry exhaustion', () => {
    expect(describeFailure('retry_exhausted:connection_unavailable').message).toContain(
      'cannot reach'
    )
    expect(describeFailure('retry_exhausted:connection_unavailable').message).toContain(
      'retries were exhausted'
    )
    expect(jobStatusLabel({ status: 'pending', reasonCode: 'provider_timeout' })).toBe(
      'Retry scheduled'
    )
  })

  it('offers configuration and permission navigation for the appropriate causes', () => {
    expect(describeFailure('model_unavailable').action).toBe('generation')
    expect(describeFailure('permission_required').action).toBe('permissions')
    expect(describeFailure('input_limit').action).toBeUndefined()
  })

  it('handles legacy codes and never renders arbitrary errors or provider bodies', () => {
    expect(describeFailure('execution_failed').message).toContain('older result')
    expect(describeFailure('provider_retries_exhausted').message).toContain(
      'original reason was not recorded'
    )
    for (const error of [
      'private clipboard credential',
      new Error('secret'),
      { code: 'secret' },
      { code: '__proto__' },
    ]) {
      expect(failureMessage(error)).toBe('The operation failed for an unknown reason.')
    }
    expect(failureMessage({ code: 'input_limit', message: 'secret', recovery: 'stop' })).toContain(
      'supported request size'
    )
    expect(failureMessage({ code: 'input_limit', message: 'secret' })).not.toContain('secret')
  })
})
