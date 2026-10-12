/** Wake an adapter while prepareStep awaits compaction, without starting another model loop. */
export class StatusNotifications {
  private changed = false
  private wake: (() => void) | undefined
  notify(): void {
    this.changed = true
    this.wake?.()
  }
  async *merge<T>(source: AsyncIterable<T>): AsyncGenerator<T | { type: 'context-status' }> {
    const iterator = source[Symbol.asyncIterator]()
    let pending = iterator.next()
    try {
      while (true) {
        if (this.changed) {
          this.changed = false
          yield { type: 'context-status' }
          continue
        }
        const signal = new Promise<'changed'>(resolve => {
          this.wake = () => resolve('changed')
        })
        const result = await Promise.race([pending, signal])
        this.wake = undefined
        if (result === 'changed') continue
        if (result.done) break
        yield result.value
        pending = iterator.next()
      }
    } finally {
      this.wake = undefined
      await iterator.return?.()
    }
  }
}
