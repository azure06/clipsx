import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { command } from './github.mjs'

const transient =
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection (?:reset|lost|timed out)|network connection was lost|NSURLErrorDomain[^\n]*-100[159]|CloudKit[^\n]*(?:unavailable|network)|HTTP(?:\/\S+)?\s+(?:429|502|503|504)|HTTP (?:Error|error):? (?:429|502|503|504)|Could not resolve host|Failed to connect|curl: \((?:5|6|7|18|28|35|52|56)\)|ticket not yet available/i

export function withTransientRetry(
  operation,
  {
    wait = milliseconds =>
      globalThis.Atomics.wait(
        new Int32Array(new globalThis.SharedArrayBuffer(4)),
        0,
        0,
        milliseconds
      ),
    report = console.warn,
  } = {}
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation()
    } catch (error) {
      const detail = [error.message, error.stderr, error.stdout].filter(Boolean).join('\n')
      if (attempt >= 2 || !transient.test(detail)) throw error
      report(`Temporary network failure; retry ${attempt + 1}/2 in ${attempt ? 5 : 2} seconds.`)
      wait(attempt ? 5000 : 2000)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [program, ...args] = process.argv.slice(2)
    if (!program) throw new Error('Specify a command to retry')
    const result = withTransientRetry(() => command(program, args))
    if (result) process.stdout.write(result)
  } catch (error) {
    console.error(error.stderr?.toString() || error.message)
    process.exitCode = 1
  }
}
