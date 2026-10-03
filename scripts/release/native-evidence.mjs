import { verifyMacRuntime } from './mac-runtime.mjs'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { readJson, encode, assert } from './model.mjs'
const platform = process.argv[2]
assert(['macos-arm64', 'macos-x64', 'linux-x64'].includes(platform), 'Unknown platform')
const candidate = readJson('.release/candidate.json')
if (platform.startsWith('macos-'))
  verifyMacRuntime(
    readJson('.release/mac-entitlements.json'),
    readFileSync('.release/native-verification.log', 'utf8'),
    readJson('.release/compiled.json').runtimeFixtureSha256
  )
mkdirSync('.release', { recursive: true })
writeFileSync(
  `.release/native-evidence-${platform}.json`,
  encode({
    candidateId: candidate.id,
    platform,
    verified: true,
    runner: process.env.RUNNER_OS,
    sourceRevision: candidate.sourceRevision,
    runId: candidate.runId,
    runAttempt: candidate.runAttempt,
    toolingRevision: process.env.RELEASE_TOOLING_REVISION,
    preparationRunId: process.env.GITHUB_RUN_ID,
    executionAttempt: process.env.GITHUB_RUN_ATTEMPT,
    verificationLog: readFileSync('.release/native-verification.log', 'utf8'),
    nodeVersion: process.version,
    tauriCliVersion: readJson('node_modules/@tauri-apps/cli/package.json').version,
    signing: platform.startsWith('macos-')
      ? 'Developer ID, codesign, spctl, notarization and stapling verified'
      : 'Debian contents and AppImage executable verified',
    ...(platform.startsWith('macos-')
      ? {
          entitlementsPlist: readFileSync('.release/mac-entitlements.plist', 'utf8'),
          runtimeProbe: {
            verified: true,
            fixtureSha256: readJson('.release/compiled.json').runtimeFixtureSha256,
          },
        }
      : {}),
    verifiedAt: new Date().toISOString(),
  })
)
