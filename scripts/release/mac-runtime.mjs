import { assert } from './model.mjs'

export function verifyMacRuntime(entitlements, log, fixtureSha256) {
  assert(
    entitlements['com.apple.security.cs.allow-unsigned-executable-memory'] === true,
    'Mac executable-memory entitlement is missing'
  )
  for (const key of [
    'com.apple.security.get-task-allow',
    'com.apple.security.cs.disable-library-validation',
    'com.apple.security.cs.allow-dyld-environment-variables',
  ])
    assert(entitlements[key] !== true, `Unsafe production Mac entitlement: ${key}`)
  assert(/^[a-f0-9]{64}$/.test(fixtureSha256), 'Runtime fixture hash is missing')
  assert(
    log.includes(`extension-runtime verified sha256=${fixtureSha256} cold_cache=true`),
    'Signed cold-cache runtime probe did not pass'
  )
}
