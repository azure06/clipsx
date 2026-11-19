import { invoke } from '@tauri-apps/api/core'
import type { ExtensionJob } from '../clipboard/useClipExtensionJobs'

export type AutomationAttempt = {
  eventId: string
  packageId: string
  activationId: string
  ruleId: string
  status: 'pending' | 'completed' | 'skipped' | 'failed'
  reasonCode: string | null
  setupLabel: string
  capturedAt: number
  jobStatus: ExtensionJob['status'] | null
  jobReasonCode: string | null
}

const outcomes = [
  'scheduled',
  'no_match',
  'no_text',
  'privacy_restricted',
  'decision_unavailable',
  'decision_timeout',
  'decision_input_limit',
  'stale_context',
  'ineligible',
  'prepare_failed',
  'enqueue_failed',
  'detection_failed',
  'guest_skipped',
  'input_too_large',
] as const

export function automationOutcomeKey(reason: string | null, status: AutomationAttempt['status']) {
  const code = outcomes.find(key => key === reason) ?? status
  return `automationRules.outcome.${code}` as const
}

export function retryAutomation({ packageId, eventId, activationId }: AutomationAttempt) {
  return invoke<void>('retry_extension_automation', { packageId, eventId, activationId })
}
