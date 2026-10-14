import type { ModelMessage } from 'ai'
import type {
  ContextStatus,
  RecallContextCoverage,
  RecallContextSummary,
  ResolvedExecutionPolicy,
} from '../contracts.generated'
import type { RequestEstimator, RequestInput } from './estimator'
import { estimateRequest } from './estimator'
import { compactConversation, summaryLabel } from './compactor'
import type { SummaryGenerator } from './compactor'
import { planContext } from './planner'

export interface ContextPersistence {
  load(coveredMessageId: string): Promise<RecallContextCoverage>
  save(summary: Omit<RecallContextSummary, 'threadId'>): Promise<void>
}
export interface ContextCoordinatorOptions {
  policy: ResolvedExecutionPolicy
  generate: SummaryGenerator
  signal: AbortSignal
  estimator?: RequestEstimator
  onStatus?: (status: ContextStatus) => void
  persistence?: ContextPersistence
  historyIds: string[]
  historyMessages?: ModelMessage[]
  attribution: { provider: string; model: string }
}

export class ContextCoordinator {
  private compactions = 0
  private readonly origins = new Map<string, string | undefined>()
  constructor(private readonly options: ContextCoordinatorOptions) {
    options.historyMessages?.forEach((message, index) => {
      const key = JSON.stringify(message)
      this.origins.set(key, this.origins.has(key) ? undefined : options.historyIds[index])
    })
  }

  async summarize(older: ModelMessage[]): Promise<ModelMessage> {
    if (this.compactions >= this.options.policy.maxCompactions)
      throw new Error('context_compaction_failed')
    this.compactions++
    return compactConversation(
      older,
      this.options.policy,
      this.options.generate,
      this.options.signal,
      this.options.estimator
    )
  }

  async prepare(
    request: RequestInput,
    question: ModelMessage,
    reserve = true
  ): Promise<ModelMessage[]> {
    const { policy, signal, onStatus, persistence } = this.options
    const estimator = this.options.estimator ?? estimateRequest
    signal.throwIfAborted()
    const plan = planContext(request, question, policy, estimator, reserve)
    const status = (state: string, reason: string | null = null) =>
      onStatus?.({
        state,
        estimatedInput: plan.estimatedInput,
        inputLimit: policy.inputLimit,
        reason,
      })
    if (plan.kind === 'blocked') {
      status('blocked', plan.reason)
      throw new Error(plan.reason)
    }
    if (plan.kind === 'ready') return plan.messages
    const lastOlder = plan.older.at(-1)
    const coveredId = this.options.historyMessages
      ? this.origins.get(JSON.stringify(lastOlder))
      : this.options.historyIds[plan.older.length - 1]
    let coverage: RecallContextCoverage | undefined
    let summary: ModelMessage | undefined
    const fits = (candidate: ModelMessage) =>
      estimator({ ...request, messages: [candidate, ...plan.retained] }).tokens <=
      policy.inputLimit - (reserve ? Math.floor(policy.inputLimit / 4) : 0)
    try {
      if (coveredId && persistence) coverage = await persistence.load(coveredId)
      let older = plan.older
      if (coverage?.summary) {
        const saved = coverage.summary
        const endpoint = plan.older.findLastIndex(
          message => this.origins.get(JSON.stringify(message)) === saved.coveredMessageId
        )
        if (saved.coveredMessageId === coveredId || endpoint >= 0) {
          const cached: ModelMessage = { role: 'user', content: summaryLabel + saved.text }
          const remaining = plan.older.slice(
            saved.coveredMessageId === coveredId ? plan.older.length : endpoint + 1
          )
          this.origins.set(JSON.stringify(cached), saved.coveredMessageId)
          older = [cached, ...remaining]
          if (
            estimator({ ...request, messages: [...older, ...plan.retained] }).tokens <=
            policy.inputLimit - (reserve ? Math.floor(policy.inputLimit / 4) : 0)
          ) {
            status('compacted')
            return [...older, ...plan.retained]
          }
        }
      }
      if (!summary) {
        status('compacting')
        summary = await this.summarize(older)
        if (!fits(summary)) throw new Error('summary_exceeds_context')
        if (coveredId && coverage && persistence && typeof summary.content === 'string')
          await persistence.save({
            coveredMessageId: coveredId,
            inputFingerprint: coverage.inputFingerprint,
            text: summary.content.startsWith(summaryLabel)
              ? summary.content.slice(summaryLabel.length)
              : summary.content,
            ...this.options.attribution,
            createdAt: Date.now(),
          })
      }
      if (coveredId) this.origins.set(JSON.stringify(summary), coveredId)
      status('compacted')
      return [summary, ...plan.retained]
    } catch (error) {
      signal.throwIfAborted()
      // Compaction is optional only when the unchanged request already fits safely.
      if (estimator(request).tokens <= policy.inputLimit) {
        status('unchanged', 'summary_unavailable')
        return [...request.messages]
      }
      status('blocked', 'context_compaction_failed')
      throw new Error('context_compaction_failed', { cause: error })
    }
  }
}
