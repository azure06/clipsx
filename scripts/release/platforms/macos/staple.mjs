import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { command } from '../../core/github.mjs'
import { isTransientFailure, withTransientRetry } from '../../core/retry.mjs'

function missingTicket(error) {
  // Exit 65 also covers invalid tickets. Require the explicit missing-ticket diagnostic.
  return (
    error.status === 65 &&
    !isTransientFailure(error) &&
    /does not have a ticket stapled to it\./.test(
      [error.stdout, error.stderr].filter(Boolean).join('\n')
    )
  )
}

export function ensureStapled(
  path,
  { notarize = false, env = process.env, run = command, retryOptions } = {}
) {
  let signed = false
  let submitted = false
  return withTransientRetry(() => {
    try {
      return run('xcrun', ['stapler', 'validate', path])
    } catch (error) {
      if (!missingTicket(error)) throw error
    }
    if (notarize) {
      for (const name of [
        'APPLE_SIGNING_IDENTITY',
        'APPLE_API_KEY_PATH',
        'APPLE_API_KEY',
        'APPLE_API_ISSUER',
      ]) {
        if (!env[name]) throw new Error(`Missing ${name}`)
      }
      if (!signed) {
        run('codesign', ['--force', '--sign', env.APPLE_SIGNING_IDENTITY, path])
        signed = true
      }
      if (!submitted) {
        const response = run('xcrun', [
          'notarytool',
          'submit',
          path,
          '--key',
          env.APPLE_API_KEY_PATH,
          '--key-id',
          env.APPLE_API_KEY,
          '--issuer',
          env.APPLE_API_ISSUER,
          '--wait',
          '--timeout',
          '20m',
          '--output-format',
          'json',
        ])
        let status
        try {
          status = JSON.parse(response).status
        } catch {
          throw new Error('Invalid DMG notarization response')
        }
        if (status !== 'Accepted') throw new Error('DMG notarization was not accepted')
        submitted = true
      }
    }
    run('xcrun', ['stapler', 'staple', path])
    return run('xcrun', ['stapler', 'validate', path])
  }, retryOptions)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [path, mode, ...extra] = process.argv.slice(2)
    if (!path || extra.length || (mode && mode !== '--notarize-dmg'))
      throw new Error('Usage: staple.mjs <path> [--notarize-dmg]')
    if (mode && !path.endsWith('.dmg')) throw new Error('Notarization mode requires a DMG')
    ensureStapled(path, {
      notarize: Boolean(mode),
      run(program, args) {
        const output = command(program, args)
        if (output) process.stdout.write(output)
        return output
      },
    })
  } catch (error) {
    console.error([error.message, error.stdout, error.stderr].filter(Boolean).join('\n'))
    process.exitCode = 1
  }
}
