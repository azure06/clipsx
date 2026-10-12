/** Curated categories only: never surface provider bodies or user content. */
export function transportFailure(error: unknown): string {
  let current = error
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (
      ['context_limit', 'question_exceeds_context', 'context_compaction_failed'].includes(
        current.message
      )
    )
      return current.message
    const match =
      /^Recall transport: (request_timeout|connection_unavailable|provider_authentication|provider_rate_limited|provider_server_error|provider_rejected|invalid_response|receiver_timeout|response_limit|context_overflow)$/.exec(
        current.message
      )
    if (match) return match[1]!
    current = current.cause
  }
  return 'run_failed'
}
