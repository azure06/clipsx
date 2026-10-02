import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, assertIdentity, digest, encode, readJson } from './model.mjs'
import { checkFrontend } from './frontend.mjs'
import { currentRun, workflowArtifacts } from './github.mjs'

const platforms = {
  'macos-arm64': 'aarch64-apple-darwin',
  'macos-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'windows-x64': 'x86_64-pc-windows-msvc',
}

export function verifyCheckpoint(bytes, checkpoint, identity) {
  for (const [key, value] of Object.entries(identity))
    assert(checkpoint[key] === value, `Compiled checkpoint ${key} mismatch`)
  assert(checkpoint.sha256 === digest(bytes), 'Compiled executable changed')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const platform = process.env.PLATFORM
  const target = platforms[platform]
  assert(target, 'Unknown checkpoint platform')
  const candidate = readJson('.release/candidate.json')
  assertIdentity(candidate)
  const frontend = checkFrontend(process.cwd(), true)
  assert(frontend.sourceRevision === candidate.sourceRevision && frontend.sourceTree === candidate.sourceTree && frontend.runAttempt === candidate.runAttempt && frontend.runId === candidate.runId, 'Checkpoint candidate/frontend mismatch')
  const identity = { schemaVersion: 1, candidateId: candidate.id, platform, target, frontendSha256: digest(readFileSync('.release/frontend.json')) }
  const binary = `src-tauri/target/${target}/release/clipsx${platform === 'windows-x64' ? '.exe' : ''}`
  const path = '.release/compiled.json'
  if (process.argv[2] === 'lookup') {
    const current = currentRun(candidate)
    assert(current.sha === candidate.sourceRevision && String(current.run.id) === candidate.runId && current.run.preparation_attempt === candidate.runAttempt, 'Compiled checkpoint candidate has been superseded')
    const name = `compiled-${platform}-${candidate.runAttempt}`
    const artifact = workflowArtifacts(candidate.runId).find(item => item.name === name)
    assert(!artifact?.expired, 'Compiled checkpoint expired; start a new preparation run')
    appendFileSync(process.env.GITHUB_OUTPUT, `exists=${Boolean(artifact)}\n`)
  } else if (process.argv[2] === 'record') {
    const bytes = readFileSync(binary)
    writeFileSync(path, encode({ ...identity, sha256: digest(bytes), checksExecutionAttempt: process.env.GITHUB_RUN_ATTEMPT }))
  } else if (process.argv[2] === 'verify') verifyCheckpoint(readFileSync(binary), readJson(path), identity)
  else throw new Error('Use checkpoint.mjs lookup|record|verify')
}
