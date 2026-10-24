import type { ModelMessage } from 'ai'
import type { ResolvedExecutionPolicy } from '../contracts.generated'
import { estimateRequest } from './estimator'
import { reduceDuplicateEvidence } from './evidence'
import type { RequestEstimator, RequestInput } from './estimator'

export type ContextPlan =
  | { kind: 'ready'; messages: ModelMessage[]; estimatedInput: number }
  | { kind: 'compact'; older: ModelMessage[]; retained: ModelMessage[]; estimatedInput: number }
  | {
      kind: 'blocked'
      reason: 'question_exceeds_context' | 'context_limit'
      estimatedInput: number
    }

/** Pure planning: never invokes models, edits messages, or prunes half a tool exchange. */
export function planContext(
  request: RequestInput,
  question: ModelMessage,
  policy: ResolvedExecutionPolicy,
  estimator: RequestEstimator = estimateRequest,
  reserveNextStep = true
): ContextPlan {
  const messages = reduceDuplicateEvidence(request.messages)
  const estimate = (value: ModelMessage[]) => estimator({ ...request, messages: value }).tokens
  const total = estimate(messages)
  const reserve = reserveNextStep ? Math.floor(policy.inputLimit / 4) : 0
  if (estimate([question]) > policy.inputLimit) {
    const questionOnly = estimator({ messages: [question], instructions: '', tools: [] }).tokens
    return {
      kind: 'blocked',
      reason: questionOnly > policy.inputLimit ? 'question_exceeds_context' : 'context_limit',
      estimatedInput: total,
    }
  }
  if (total + reserve <= policy.inputLimit)
    return { kind: 'ready', messages, estimatedInput: total }
  const questionIndex = messages.findLastIndex(
    message =>
      message === question ||
      (message.role === question.role &&
        JSON.stringify(message.content) === JSON.stringify(question.content))
  )
  if (questionIndex <= 0)
    return total <= policy.inputLimit
      ? { kind: 'ready', messages, estimatedInput: total }
      : { kind: 'blocked', reason: 'context_limit', estimatedInput: total }
  // Only completed prior conversation is summarizable. In-flight calls/results stay intact.
  let boundary = Math.max(0, questionIndex - 2)
  while (boundary > 0 && messages[boundary]?.role !== 'user') boundary--
  if (boundary === 0) boundary = questionIndex
  if (estimate(messages.slice(boundary)) + reserve > policy.inputLimit) boundary = questionIndex
  const retained = messages.slice(boundary)
  if (estimate(retained) > policy.inputLimit)
    return { kind: 'blocked', reason: 'context_limit', estimatedInput: total }
  return { kind: 'compact', older: messages.slice(0, boundary), retained, estimatedInput: total }
}

export function fallbackPolicy(contextLimit: number, outputLimit: number): ResolvedExecutionPolicy {
  return {
    contextLimit,
    outputLimit,
    inputLimit: contextLimit - outputLimit,
    estimated: true,
    source: 'unverified_configuration',
    reasoning: null,
    maxSteps: 8,
    maxCompactions: 2,
    deadlineMs: 600000,
  }
}
